'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { DownloadManager, safeName, atomicJSON } = require('../src/downloads.cjs');

const fixtureRoot = path.resolve(__dirname, '.download-fixtures');
fs.mkdirSync(fixtureRoot, { recursive: true });
const link = (id, filename = 'part01.rar', extra = {}) => ({
  status: 'ready', url: `https://files.example.com/${id}`, sourceUrl: `https://host.example.com/${id}`,
  filename, ...extra,
});
const response = (body, headers = {}, status = 200) => new Response(body, {
  status, headers: { 'content-type': 'application/octet-stream', ...headers },
});
async function until(predicate, description = 'condition', timeout = 4000) {
  const deadline = Date.now() + timeout;
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error(`Timed out waiting for ${description}`);
    await new Promise(resolve => setTimeout(resolve, 5));
  }
}
function fixture(t, fetcher, stored) {
  const root = fs.mkdtempSync(path.join(fixtureRoot, 'run-'));
  const stateFile = path.join(root, 'state.json');
  const downloadDir = path.join(root, 'downloads');
  if (stored) fs.writeFileSync(stateFile, JSON.stringify(stored(root, downloadDir)));
  const manager = new DownloadManager({ stateFile, downloadDir, fetcher });
  t.after(async () => {
    await manager.stop();
    await until(() => manager.running.size === 0, 'test downloads to stop');
    const resolved = path.resolve(root);
    assert.ok(resolved.startsWith(fixtureRoot + path.sep), 'cleanup remains in test workspace');
    fs.rmSync(resolved, { recursive: true, force: true });
  });
  return { manager, root, stateFile, downloadDir };
}
function seedPartial({ status = 'paused', etag = '"revision-1"', lastModified = null, content = 'abc' } = {}) {
  return (_root, downloadDir) => {
    const folder = path.join(downloadDir, 'Game');
    fs.mkdirSync(folder, { recursive: true });
    fs.writeFileSync(path.join(folder, 'part01.rar.atlas-part'), content);
    return { settings: { downloadDir, concurrency: 1, favorites: [] }, downloads: [{
      id: 'partial', name: 'part01.rar', folder, gameTitle: 'Game', status,
      url: 'https://files.example.com/partial', sourceUrl: 'https://host.example.com/partial',
      received: content.length, total: 6, etag, lastModified, lastModifiedVerified:Boolean(lastModified), speed: 99, headers: {}, error: '',
    }] };
  };
}
async function finished(manager) {
  await until(() => manager.running.size === 0 && manager.downloads.every(d => d.status !== 'queued'), 'download completion');
}

test('complete transfer writes exact bytes and removes its partial file', async t => {
  const payload = Buffer.from([0, 82, 97, 114, 255, 17, 128]);
  const { manager } = fixture(t, async () => response(payload, { 'content-length': String(payload.length), etag: '"one"' }));
  assert.equal(manager.add({ gameTitle: 'Game', links: [link('one')] }).added, 1);
  await finished(manager);
  const d = manager.downloads[0];
  assert.equal(d.status, 'completed');
  assert.deepEqual(fs.readFileSync(path.join(d.folder, d.name)), payload);
  assert.equal(fs.existsSync(path.join(d.folder, d.name + '.atlas-part')), false);
  assert.equal(d.received, payload.length);
});

test('validated resume sends Range and If-Range and appends only remaining bytes', async t => {
  let requestedHeaders;
  const { manager } = fixture(t, async (_url, options) => {
    requestedHeaders = options.headers;
    return response('def', { 'content-length': '3', 'content-range': 'bytes 3-5/6', etag: '"revision-1"' }, 206);
  }, seedPartial());
  manager.action('partial', 'resume');
  await finished(manager);
  const d = manager.downloads[0];
  assert.equal(requestedHeaders.Range, 'bytes=3-');
  assert.equal(requestedHeaders['If-Range'], '"revision-1"');
  assert.equal(d.status, 'completed');
  assert.equal(fs.readFileSync(path.join(d.folder, d.name), 'utf8'), 'abcdef');
});

test('server ignoring Range restarts safely instead of appending duplicate bytes', async t => {
  const { manager } = fixture(t, async () => response('uvwxyz', { 'content-length': '6', etag: '"revision-2"' }), seedPartial());
  manager.action('partial', 'resume');
  await finished(manager);
  const d = manager.downloads[0];
  assert.equal(d.status, 'completed');
  assert.equal(fs.readFileSync(path.join(d.folder, d.name), 'utf8'), 'uvwxyz');
});

test('partial file without a resource validator restarts rather than mixing versions', async t => {
  let headers;
  const { manager } = fixture(t, async (_url, options) => {
    headers = options.headers;
    return response('uvwxyz', { 'content-length': '6' });
  }, seedPartial({ etag: null }));
  manager.action('partial', 'resume');
  await finished(manager);
  const d = manager.downloads[0];
  assert.equal(headers.Range, undefined);
  assert.equal(d.status, 'completed');
  assert.equal(fs.readFileSync(path.join(d.folder, d.name), 'utf8'), 'uvwxyz');
});

test('incorrect resume start is rejected without modifying existing bytes', async t => {
  const { manager } = fixture(t, async () => response('abc', { 'content-length': '3', 'content-range': 'bytes 0-2/6' }, 206), seedPartial());
  manager.action('partial', 'resume');
  await finished(manager);
  const d = manager.downloads[0];
  assert.equal(d.status, 'error');
  assert.match(d.error, /range/i);
  assert.equal(fs.readFileSync(path.join(d.folder, d.name + '.atlas-part'), 'utf8'), 'abc');
  assert.equal(fs.existsSync(path.join(d.folder, d.name)), false);
});

test('206 body length must agree with its declared Content-Range segment', async t => {
  const { manager } = fixture(t, async () => response('def', {
    'content-length': '3', 'content-range': 'bytes 3-3/6', etag: '"revision-1"',
  }, 206), seedPartial());
  manager.action('partial', 'resume');
  await finished(manager);
  const d = manager.downloads[0];
  assert.equal(d.status, 'error');
  assert.equal(fs.existsSync(path.join(d.folder, d.name)), false);
});

test('changed ETag on a resumed response is rejected before appending', async t => {
  const { manager } = fixture(t, async () => response('def', { 'content-range': 'bytes 3-5/6', etag: '"revision-2"' }, 206), seedPartial());
  manager.action('partial', 'resume');
  await finished(manager);
  const d = manager.downloads[0];
  assert.equal(d.status, 'error');
  assert.equal(fs.readFileSync(path.join(d.folder, d.name + '.atlas-part'), 'utf8'), 'abc');
});

test('changed Last-Modified on a resumed response does not mix file revisions', async t => {
  const { manager } = fixture(t, async () => response('XYZ', {
    'content-range': 'bytes 3-5/6', 'last-modified': 'Fri, 06 Nov 2026 11:00:00 GMT',
  }, 206), seedPartial({ etag: null, lastModified: 'Fri, 06 Nov 2026 10:00:00 GMT' }));
  manager.action('partial', 'resume');
  await finished(manager);
  const d = manager.downloads[0];
  assert.equal(d.status, 'error');
  assert.equal(fs.readFileSync(path.join(d.folder, d.name + '.atlas-part'), 'utf8'), 'abc');
  assert.equal(fs.existsSync(path.join(d.folder, d.name)), false);
});

test('HTTP 416 is not silently declared complete', async t => {
  const { manager } = fixture(t, async () => response('', { 'content-range': 'bytes */6' }, 416), seedPartial());
  manager.action('partial', 'resume');
  await finished(manager);
  const d = manager.downloads[0];
  assert.equal(d.status, 'error');
  assert.match(d.error, /416/);
  assert.equal(fs.existsSync(path.join(d.folder, d.name)), false);
});

test('HTML challenge pages are rejected and never stored as completed archives', async t => {
  const { manager } = fixture(t, async () => response('<html>captcha</html>', { 'content-type': 'text/html; charset=UTF-8' }));
  manager.add({ gameTitle: 'Game', links: [link('html')] });
  await finished(manager);
  const d = manager.downloads[0];
  assert.equal(d.status, 'error');
  assert.match(d.error, /web page/i);
  assert.equal(fs.existsSync(path.join(d.folder, d.name)), false);
  assert.equal(fs.existsSync(path.join(d.folder, d.name + '.atlas-part')), false);
});

test('expired direct-link refresh uses fresh headers and does not leak old-origin cookies', async t => {
  const requests = [];
  const { manager } = fixture(t, async (url, options) => {
    requests.push({ url, headers: { ...options.headers } });
    if (url.endsWith('/old')) return response('', {}, 403);
    return response('abc', { 'content-length': '3' });
  });
  manager.resolveLink = async () => ({
    status: 'ready', url: 'https://new-files.example.net/refreshed',
    headers: { Referer: 'https://host.example.com/current-page' },
  });
  manager.add({ gameTitle: 'Game', links: [link('old', 'part01.rar', {
    headers: { Cookie: 'test_cookie=not-a-real-secret', Authorization: 'Bearer test-not-real', Referer: 'https://host.example.com/old-page' },
  })] });
  await finished(manager);
  assert.equal(manager.downloads[0].status, 'completed');
  assert.equal(requests.length, 2);
  const freshHeaders = new Headers(requests[1].headers);
  assert.equal(freshHeaders.get('cookie'), null);
  assert.equal(freshHeaders.get('authorization'), null);
  assert.equal(freshHeaders.get('referer'), 'https://host.example.com/current-page');
});

test('short transfer retains partial bytes and reports an error', async t => {
  const { manager } = fixture(t, async () => response('abc', { 'content-length': '6', etag: '"one"' }));
  manager.add({ gameTitle: 'Game', links: [link('short')] });
  await finished(manager);
  const d = manager.downloads[0];
  assert.equal(d.status, 'error');
  assert.match(d.error, /early/i);
  assert.equal(fs.readFileSync(path.join(d.folder, d.name + '.atlas-part'), 'utf8'), 'abc');
  assert.equal(fs.existsSync(path.join(d.folder, d.name)), false);
});

test('duplicate output names get distinct files, including case-only Windows collisions', async t => {
  const { manager } = fixture(t, async url => response(url.endsWith('/first') ? 'abc' : 'def', { 'content-length': '3' }));
  manager.add({ gameTitle: 'Game', links: [link('first', 'Part01.rar'), link('second', 'part01.rar')] });
  assert.equal(new Set(manager.downloads.map(d => d.name.toLowerCase())).size, 2, 'Windows output names must be unique ignoring case');
  await finished(manager);
  assert.deepEqual(manager.downloads.map(d => d.status), ['completed', 'completed']);
  assert.deepEqual(manager.downloads.map(d => fs.readFileSync(path.join(d.folder, d.name), 'utf8')), ['abc', 'def']);
});

test('same source is deduplicated within the same destination', async t => {
  const { manager } = fixture(t, async () => response('abc', { 'content-length': '3' }));
  const result = manager.add({ gameTitle: 'Game', links: [link('one'), link('one')] });
  assert.equal(result.added, 1);
  await finished(manager);
  assert.equal(manager.downloads.length, 1);
});

test('a game whose folder was made by an earlier version keeps it, and a new game gets a tidy folder name', async t => {
  // Before 0.7.0 a folder name was cut at 100 characters and left as it was. This made-up title is cut right after a space.
  const title = 'Example Quest: Legends of the Northern Kingdom \u2013 Complete Edition, v4.04 Hotfix 2 + 22 DLCs + Bonus Content + Windows 7 Fix';
  const earlierName = safeName(title, 'Imported files').slice(0, 100), tidyName = earlierName.trimEnd();
  assert.equal(earlierName.at(-1), ' ');
  const part = n => link(`part-${n}`, `game.part0${n}.rar`);
  // The queue as the earlier version saved it: part 1 is finished, in the folder with the space at its end.
  const { manager, downloadDir } = fixture(t, async () => response('abc', { 'content-length': '3' }), (_root, dir) => {
    const folder = path.join(dir, earlierName);
    fs.mkdirSync(folder, { recursive: true });
    fs.writeFileSync(path.join(folder, 'game.part01.rar'), 'abc');
    return { settings: { downloadDir: dir, concurrency: 1, favorites: [] }, downloads: [{
      id: 'earlier', name: 'game.part01.rar', folder, gameTitle: title, status: 'completed', url: part(1).url, sourceUrl: part(1).sourceUrl, received: 3, total: 3, etag: null, lastModified: null, speed: 0, headers: {}, error: '',
    }] };
  });
  // The same game again, with one part more: the part that is there is recognised, and the new one joins it.
  const result = manager.add({ gameTitle: title, links: [part(1), part(2)] });
  assert.equal(result.added, 1, 'the finished part is not downloaded a second time');
  await finished(manager);
  assert.deepEqual(manager.downloads.map(d => [d.name, d.status, path.basename(d.folder)]), [['game.part01.rar', 'completed', earlierName], ['game.part02.rar', 'completed', earlierName]]);
  assert.deepEqual(fs.readdirSync(downloadDir), [earlierName], 'no second folder appears beside the first');
  // The list alone is enough too, when the folder itself is gone, however the title's letters are cased now.
  fs.rmSync(path.join(downloadDir, earlierName), { recursive: true });
  const shouted = title.toUpperCase(), shoutedName = safeName(shouted, 'Imported files').slice(0, 100);
  assert.equal(shoutedName.at(-1), ' ');assert.notEqual(shoutedName, earlierName);
  assert.equal(manager.add({ gameTitle: shouted, links: [part(1), part(2)] }).added, 0, 'both parts are still recognised');
  assert.deepEqual(fs.readdirSync(downloadDir), [shoutedName], 'the folder comes back under the earlier kind of name');
  fs.rmSync(path.join(downloadDir, shoutedName), { recursive: true });
  fs.mkdirSync(path.join(downloadDir, earlierName));
  // The folder alone is enough, even after its entries were removed from the list.
  manager.downloads.length = 0;
  manager.add({ gameTitle: title, links: [part(3)] });
  assert.equal(path.basename(manager.downloads[0].folder), earlierName);
  await finished(manager);
  // A game with no earlier folder gets the tidy name, and so do folders inside a group such as Mods.
  const other = title.replace('Example Quest', 'Another Quest');
  manager.add({ gameTitle: other, links: [part(4)] });
  const fresh = path.basename(manager.downloads.at(-1).folder);
  assert.equal(fresh, safeName(other, 'Imported files').slice(0, 100).trimEnd());assert.notEqual(fresh.at(-1), ' ');assert.equal(fresh.length, 99);
  manager.add({ gameTitle: title, group: 'Mods', links: [part(5)] });
  assert.equal(manager.downloads.at(-1).folder, path.join(downloadDir, 'Mods', tidyName));
  // So does the same long title where nothing is on disk or in the list yet.
  const empty = fixture(t, async () => response('abc', { 'content-length': '3' }));
  assert.equal(empty.manager.downloads.length, 0);
  empty.manager.add({ gameTitle: title, links: [part(1)] });
  assert.equal(path.basename(empty.manager.downloads[0].folder), tidyName);
  // Files without a game go to Imported files, whatever other folders happen to be there.
  fs.mkdirSync(path.join(empty.downloadDir, 'download'));
  empty.manager.add({ links: [part(2)] });
  assert.equal(path.basename(empty.manager.downloads[1].folder), 'Imported files');
  await finished(empty.manager);
  assert.deepEqual(fs.readdirSync(path.join(empty.downloadDir, 'download')), []);
  // A title whose cut needs no tidying is unchanged from the earlier version.
  manager.add({ gameTitle: 'Short Game \u2013 v1.0', links: [part(6)] });
  assert.equal(path.basename(manager.downloads.at(-1).folder), 'Short Game \u2013 v1.0');
  await finished(manager);
  assert.deepEqual(fs.readdirSync(downloadDir).sort(), [fresh, earlierName, 'Mods', 'Short Game \u2013 v1.0'].sort());
});

test('queued final names cannot collide with another job\'s temporary partial path', async t => {
  const { manager } = fixture(t, async url => response(url.endsWith('/first') ? 'abc' : 'def', { 'content-length': '3' }));
  manager.add({ gameTitle: 'Game', links: [link('first', 'file.rar'), link('second', 'file.rar.atlas-part')] });
  const paths = manager.downloads.flatMap(d => [path.join(d.folder, d.name).toLowerCase(), path.join(d.folder, d.name + '.atlas-part').toLowerCase()]);
  assert.equal(new Set(paths).size, paths.length, 'all final and temporary paths must be distinct');
  await finished(manager);
  assert.deepEqual(manager.downloads.map(d => d.status), ['completed', 'completed']);
  assert.deepEqual(manager.downloads.map(d => fs.readFileSync(path.join(d.folder, d.name), 'utf8')), ['abc', 'def']);
});

test('stop waits for stream cancellation and persists a resumable paused job', async t => {
  let cancelled = false;
  const { manager, stateFile } = fixture(t, async (_url, { signal }) => response(new ReadableStream({
    start(controller) {
      controller.enqueue(Buffer.from('abc'));
      signal.addEventListener('abort', () => {
        setTimeout(() => { cancelled = true; controller.error(signal.reason || new Error('Stopped')); }, 20);
      }, { once: true });
    },
  }), { 'content-length': '6', etag: '"one"' }));
  manager.add({ gameTitle: 'Game', links: [link('stop')] });
  await until(() => manager.downloads[0].received === 3, 'partial write');
  await manager.stop();
  assert.equal(cancelled, true);
  assert.equal(manager.running.size, 0);
  const persisted = JSON.parse(fs.readFileSync(stateFile, 'utf8'));
  assert.equal(persisted.downloads[0].status, 'paused');
  assert.equal(persisted.downloads[0].received, 3);
});

test('pausing an active transfer aborts it, and cancelling the paused item preserves bytes', async t => {
  let fetchAborted = false;
  const { manager } = fixture(t, async (_url, { signal }) => {
    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(Buffer.from('abc'));
        signal.addEventListener('abort', () => {
          fetchAborted = true;
          controller.error(signal.reason || new Error('Aborted'));
        }, { once: true });
      },
    });
    return response(stream, { 'content-length': '6', etag: '"one"' });
  });
  manager.add({ gameTitle: 'Game', links: [link('pause')] });
  const d = manager.downloads[0];
  await until(() => d.received === 3, 'first bytes');
  manager.action(d.id, 'pause');
  await finished(manager);
  assert.equal(fetchAborted, true);
  assert.equal(d.status, 'paused');
  manager.action(d.id, 'cancel');
  assert.equal(d.status, 'cancelled');
  assert.equal(fs.readFileSync(path.join(d.folder, d.name + '.atlas-part'), 'utf8'), 'abc');
  assert.equal(fs.existsSync(path.join(d.folder, d.name)), false);
});

test('persisted active jobs reopen paused and can resume from saved bytes', async t => {
  const { manager, stateFile } = fixture(t, async () => response('def', { 'content-range': 'bytes 3-5/6', etag: '"revision-1"' }, 206), seedPartial({ status: 'downloading' }));
  assert.equal(manager.downloads[0].status, 'paused');
  assert.equal(manager.downloads[0].speed, 0);
  assert.equal(manager.running.size, 0);
  manager.action('partial', 'resume');
  await finished(manager);
  const persisted = JSON.parse(fs.readFileSync(stateFile, 'utf8'));
  assert.equal(persisted.downloads[0].status, 'completed');
  assert.equal(persisted.downloads[0].received, 6);
});

test('completion refuses to overwrite a file created after the job was queued', async t => {
  let release;
  const waiting = new Promise(resolve => { release = resolve; });
  const { manager } = fixture(t, async () => { await waiting; return response('new', { 'content-length': '3' }); });
  manager.add({ gameTitle: 'Game', links: [link('race')] });
  const d = manager.downloads[0];
  fs.writeFileSync(path.join(d.folder, d.name), 'existing user file');
  release();
  await finished(manager);
  assert.equal(d.status, 'error');
  assert.equal(fs.readFileSync(path.join(d.folder, d.name), 'utf8'), 'existing user file');
  assert.equal(fs.readFileSync(path.join(d.folder, d.name + '.atlas-part'), 'utf8'), 'new');
});

test('safe filenames remove path separators, reserved devices, and trailing Windows dots', () => {
  assert.equal(/[\\/:]/.test(safeName('../../outside.rar')), false);
  assert.match(safeName('CON.rar'), /^_/);
  assert.equal(/[. ]$/.test(safeName('a'.repeat(179) + '.more')), false, 'truncation must not leave a trailing dot');
});

test('the cleaning of file names is pinned, name by name: it has not changed since 0.6.1', () => {
  const wide=text=>text.split('').map(char=>char==='.'?char:String.fromCharCode(char.charCodeAt(0)+0xfee0)).join('');
  const cases=[['a .','a'],['a. . .','a'],['part01.rar .','part01.rar'],['  spaced.zip  ','spaced.zip'],['x.rar. ','x.rar'],['x'.repeat(179)+' y','x'.repeat(179)],['a'.repeat(200),'a'.repeat(180)],
    ['../../outside.rar','.._.._outside.rar'],['a\\b.rar','a_b.rar'],['a/b:c*d?e"f<g>h|i.rar','a_b_c_d_e_f_g_h_i.rar'],['tab'+String.fromCharCode(9)+'here.zip','tab_here.zip'],
    ['CON','_CON'],['con.txt','_con.txt'],['COM1.rar','_COM1.rar'],['lpt9','_lpt9'],['NUL.tar.gz','_NUL.tar.gz'],['aux','_aux'],['prn.','_prn'],['conx','conx'],['com10.txt','com10.txt'],
    ['.','download'],['..','download'],['...','download'],['','download'],[' ','download'],
    [wide('setup.exe'),'setup.exe'],['photo.jpg'+String.fromCharCode(0xff0e)+'exe','photo.jpg.exe'],['game.zip','game.zip'],['My Mod v1.2-12604-1-2.7z','My Mod v1.2-12604-1-2.7z']];
  for(const [input,expected] of cases)assert.equal(safeName(input),expected,JSON.stringify(input));
  assert.equal(safeName(undefined),'download');assert.equal(safeName(null),'download');
  assert.equal(safeName('','Imported files'),'Imported files');assert.equal(safeName('..','Imported files'),'Imported files');assert.equal(safeName('Game: Title','Imported files'),'Game_ Title');
});

test('a device name with spaces before its dot is still the device on Windows, so it gets the prefix too', () => {
  // Windows drops the spaces between a device name and its extension, so
  // "con .txt" opens the console, not a file. Names that are not devices stay.
  const {folderName}=require('../src/safe-name.cjs');
  const cases=[['con .txt','_con .txt'],['NUL   .tar.gz','_NUL   .tar.gz'],['com1 .rar','_com1 .rar'],['aux .x','_aux .x'],['Prn  .','_Prn'],['LPT0 .7z','_LPT0 .7z'],
    ['con x.txt','con x.txt'],['conx .txt','conx .txt'],['com10 .txt','com10 .txt'],['my con .txt','my con .txt'],['con-file .txt','con-file .txt']];
  for(const [input,expected] of cases)assert.equal(safeName(input),expected,JSON.stringify(input));
  for(const [input] of cases)assert.equal(safeName(safeName(input)),safeName(input),'cleaning twice changes nothing: '+JSON.stringify(input));
  assert.equal(folderName('Con .Game'),'_Con .Game');assert.equal(folderName('Con Game'),'Con Game');
  // A long one is handled like a long "con." name: the queue is handed the name as it arrived and cleans it once.
  const long='con .'+'a'.repeat(170)+'.exex';assert.equal(long.length,180);assert.equal(safeName(long),'_'+long);
});

test('the queue cleans every file name it is handed, so no name can put a file outside its folder', async t => {
  const {manager}=fixture(t,async()=>response('no',{'content-type':'text/html'},500));
  const unsafe=['../../escaped.rar','..'+String.fromCharCode(92,46,46,92)+'escaped2.rar','a'+String.fromCharCode(92)+'b.rar','sub/dir/file.rar','CON','x.rar. ','C:'+String.fromCharCode(92)+'Windows'+String.fromCharCode(92)+'evil.dll','nul.7z','..','con .rar','wide'+String.fromCharCode(0xff0e,0xff45,0xff58,0xff45)];
  const {ids}=manager.add({gameTitle:'Game',links:unsafe.map((filename,index)=>link(`unsafe-${index}`,filename))});
  assert.equal(ids.length,unsafe.length);
  for(const [index,id] of ids.entries()){
    const d=manager.downloads.find(item=>item.id===id),label=JSON.stringify(unsafe[index]);
    assert.equal(d.name,safeName(unsafe[index]),label);
    assert.equal(path.dirname(path.resolve(d.folder,d.name)),d.folder,label);
    assert.doesNotMatch(d.name,/[\\/:]/,label);assert.doesNotMatch(d.name,/[. ]$/,label);assert.doesNotMatch(d.name,/^(con|nul) *(?:\.|$)/i,label);
  }
  assert.deepEqual(manager.downloads.slice(0,4).map(d=>d.name),['.._.._escaped.rar','.._.._escaped2.rar','a_b.rar','sub_dir_file.rar']);
  assert.equal(manager.downloads.at(-2).name,'_con .rar');
  assert.equal(manager.downloads.at(-1).name,'wide.exe','and it is the cleaned name that gets the file');
  // With no name at all, the name comes from the address and is cleaned the same way.
  const {ids:[bare]}=manager.add({gameTitle:'Game',links:[{status:'ready',url:'https://files.example.com/dir/aux'}]});
  assert.equal(manager.downloads.find(item=>item.id===bare).name,'_aux');
  await finished(manager);
  const folder=manager.downloads[0].folder;
  assert.deepEqual(fs.readdirSync(path.dirname(folder)),[path.basename(folder)],'nothing was written beside the game folder');
});

test('an ordinary download is known by the address it was found at, not by the direct address behind it', async t => {
  const {manager}=fixture(t,async()=>response('no',{'content-type':'text/html'},500));
  const first={status:'ready',url:'https://files.example.com/direct-1',sourceUrl:'https://host.example.com/page',filename:'part01.rar'};
  assert.equal(manager.add({gameTitle:'Game',links:[first]}).added,1);
  assert.equal(manager.add({gameTitle:'Game',links:[{...first,url:'https://files.example.com/direct-2'}]}).added,0,'the same page, with a new direct address');
  assert.equal(manager.add({gameTitle:'Game',links:[{...first,sourceUrl:'https://host.example.com/other-page',filename:'part02.rar'}]}).added,1,'the same direct address, found at another page');
  // A link that has no address of its own page is known by its own address.
  const plain={status:'ready',url:'https://files.example.com/plain',filename:'plain.rar'};
  assert.equal(manager.add({gameTitle:'Game',links:[plain]}).added,1);assert.equal(manager.add({gameTitle:'Game',links:[plain]}).added,0);
  assert.equal(manager.add({gameTitle:'Game',links:[{...plain,sourceUrl:'https://host.example.com/page'}]}).added,0,'and that address is the first one again');
  assert.equal(manager.downloads.length,3);
  await finished(manager);
});

test('a partial created during a network wait is never truncated or overwritten', async t => {
  let release,requested=false,cancelled=false;
  const gate=new Promise(resolve=>{release=resolve;});
  const {manager}=fixture(t,async()=>{requested=true;await gate;return response(new ReadableStream({cancel(){cancelled=true;}}),{'content-length':'3'});});
  manager.add({gameTitle:'Game',links:[link('local-race')]});
  await until(()=>requested,'host request');
  const d=manager.downloads[0],partial=path.join(d.folder,d.name+'.atlas-part');
  fs.writeFileSync(partial,'keep this file');release();await finished(manager);
  assert.equal(d.status,'error');assert.equal(fs.readFileSync(partial,'utf8'),'keep this file');
  assert.equal(cancelled,true,'unconsumed host response is cancelled after a file error');
});

test('replacing a saved partial during a request neither writes the replacement nor commits a new validator',async t=>{
  let release,requested=false;
  const gate=new Promise(resolve=>{release=resolve;});
  const {manager}=fixture(t,async()=>{requested=true;await gate;return response('uvwxyz',{'content-length':'6',etag:'"revision-2"'});},seedPartial());
  manager.action('partial','resume');await until(()=>requested,'resume request');
  const d=manager.downloads[0],partial=path.join(d.folder,d.name+'.atlas-part'),old=partial+'.original';
  fs.renameSync(partial,old);fs.writeFileSync(partial,'private replacement');
  release();await finished(manager);
  assert.equal(d.status,'error');assert.equal(d.etag,'"revision-1"');
  assert.equal(fs.readFileSync(partial,'utf8'),'private replacement');assert.equal(fs.readFileSync(old,'utf8'),'abc');
  assert.equal(fs.existsSync(path.join(d.folder,d.name)),false);
});

test('a resumed partial changed in place during the request is rejected before appending',async t=>{
  let release,requested=false;
  const gate=new Promise(resolve=>{release=resolve;});
  const {manager}=fixture(t,async()=>{requested=true;await gate;return response('def',{'content-range':'bytes 3-5/6',etag:'"revision-1"'},206);},seedPartial());
  manager.action('partial','resume');await until(()=>requested,'resume request');
  const d=manager.downloads[0],partial=path.join(d.folder,d.name+'.atlas-part');
  fs.appendFileSync(partial,'X');release();await finished(manager);
  assert.equal(d.status,'error');assert.equal(fs.readFileSync(partial,'utf8'),'abcX');
});

test('hard-linked partial files are refused before a download can modify another name',async t=>{
  let requested=false;
  const {manager}=fixture(t,async()=>{requested=true;return response('def',{'content-range':'bytes 3-5/6',etag:'"revision-1"'},206);},(root,dir)=>{
    const stored=seedPartial()(root,dir),partial=path.join(dir,'Game','part01.rar.atlas-part');
    fs.linkSync(partial,path.join(root,'other-file'));return stored;
  });
  manager.action('partial','resume');await finished(manager);
  assert.equal(manager.downloads[0].status,'error');assert.equal(requested,false);
  assert.equal(fs.readFileSync(path.join(manager.downloads[0].folder,'part01.rar.atlas-part'),'utf8'),'abc');
});

for(const type of ['application/javascript','text/javascript','application/xml','text/xml'])test(`single downloads reject ${type} before creating an archive`,async t=>{
  const {manager}=fixture(t,async()=>response('unexpected active page',{'content-type':type}));
  manager.add({gameTitle:'Game',links:[link('active-page')]});await finished(manager);
  const d=manager.downloads[0];assert.equal(d.status,'error');
  assert.equal(fs.existsSync(path.join(d.folder,d.name+'.atlas-part')),false);
});

test('a recent Last-Modified value does not authorize resuming a different same-second revision',async t=>{
  const requests=[];let first=true;
  const {manager}=fixture(t,async(_url,options)=>{
    requests.push(options.headers);
    if(first){first=false;return response('abc',{'content-length':'6','last-modified':'Fri, 06 Nov 2026 10:00:00 GMT',date:'Fri, 06 Nov 2026 10:00:01 GMT'});}
    return response('UVWXYZ',{'content-length':'6','last-modified':'Fri, 06 Nov 2026 10:00:00 GMT',date:'Fri, 06 Nov 2026 10:00:02 GMT'});
  });
  manager.add({gameTitle:'Game',links:[link('recent-version')]});await finished(manager);
  const d=manager.downloads[0];assert.equal(d.status,'error');assert.equal(d.lastModified,null);
  manager.action(d.id,'retry');await finished(manager);
  assert.equal(requests[1].Range,undefined);assert.equal(d.status,'completed');
  assert.equal(fs.readFileSync(path.join(d.folder,d.name),'utf8'),'UVWXYZ');
});

test('old unverified Last-Modified checkpoints restart instead of being trusted on upgrade',async t=>{
  let sent;
  const {manager}=fixture(t,async(_url,options)=>{sent=options.headers;return response('UVWXYZ',{'content-length':'6'});},(root,dir)=>{
    const stored=seedPartial({etag:null,lastModified:'Fri, 06 Nov 2026 10:00:00 GMT'})(root,dir);delete stored.downloads[0].lastModifiedVerified;return stored;
  });
  manager.action('partial','resume');await finished(manager);
  assert.equal(sent.Range,undefined);assert.equal(manager.downloads[0].status,'completed');
});

test('queue saves never follow a preexisting predictable temporary-file hard link',async t=>{
  const {root,stateFile}=fixture(t,async()=>response('unused'));
  const victim=path.join(root,'other-data.txt');fs.writeFileSync(victim,'preserve existing data');
  fs.linkSync(victim,stateFile+'.tmp');atomicJSON(stateFile,{downloads:[]});
  assert.equal(fs.readFileSync(victim,'utf8'),'preserve existing data');
  assert.deepEqual(JSON.parse(fs.readFileSync(stateFile,'utf8')),{downloads:[]});
});

test('unexpected download exceptions do not leak paths or signed links through saved/UI errors',async t=>{
  const secret='C:\\Users\\FixturePrivate\\secret.txt https://files.example.com/file?token=private-fixture';
  const {manager,stateFile}=fixture(t,async()=>{throw new Error(secret);});
  manager.add({gameTitle:'Game',links:[link('private-failure')]});await finished(manager);
  assert.equal(manager.downloads[0].status,'error');
  assert.doesNotMatch(JSON.stringify(manager.state()),/FixturePrivate|private-fixture/);
  assert.doesNotMatch(fs.readFileSync(stateFile,'utf8'),/FixturePrivate|private-fixture/);
});

'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { DownloadManager, safeName } = require('../src/downloads.cjs');

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
      received: content.length, total: 6, etag, lastModified, speed: 99, headers: {}, error: '',
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

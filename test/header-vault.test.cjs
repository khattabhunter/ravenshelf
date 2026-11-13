'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { createHeaderVault, PREFIX } = require('../src/header-vault.cjs');
const { DownloadManager } = require('../src/downloads.cjs');

// Stand-in for Electron safeStorage: real encryption with a per-"account" key.
function fakeStorage({ available = true, key = crypto.randomBytes(32) } = {}) {
  return {
    isEncryptionAvailable: () => available,
    encryptString(text) {
      const iv = crypto.randomBytes(12), cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
      const body = Buffer.concat([cipher.update(text, 'utf8'), cipher.final()]);
      return Buffer.concat([iv, cipher.getAuthTag(), body]);
    },
    decryptString(buffer) {
      const decipher = crypto.createDecipheriv('aes-256-gcm', key, buffer.subarray(0, 12));
      decipher.setAuthTag(buffer.subarray(12, 28));
      return Buffer.concat([decipher.update(buffer.subarray(28)), decipher.final()]).toString('utf8');
    },
  };
}
const SECRET = 'host_session=not-a-real-secret-7f3a';
const HEADERS = { Cookie: SECRET, Referer: 'https://host.example.com/file', 'User-Agent': 'AtlasTest' };

test('sealed headers round-trip and never contain the cookie text', () => {
  const vault = createHeaderVault(fakeStorage());
  const sealed = vault.seal(HEADERS);
  assert.ok(sealed.startsWith(PREFIX));
  assert.equal(sealed.includes('not-a-real-secret'), false);
  assert.equal(Buffer.from(sealed.slice(PREFIX.length), 'base64').toString('latin1').includes('not-a-real-secret'), false);
  assert.deepEqual(vault.open(sealed), HEADERS);
});

test('unavailable encryption seals nothing and opens nothing', () => {
  const working = createHeaderVault(fakeStorage());
  const off = createHeaderVault(fakeStorage({ available: false }));
  assert.equal(off.available(), false);
  assert.equal(off.seal(HEADERS), null);
  assert.equal(off.open(working.seal(HEADERS)), null);
  assert.equal(createHeaderVault(null).seal(HEADERS), null);
  assert.equal(createHeaderVault({ isEncryptionAvailable() { throw new Error('locked'); } }).available(), false);
});

test('headers sealed by another account or tampered data are rejected', () => {
  const mine = createHeaderVault(fakeStorage()), other = createHeaderVault(fakeStorage());
  const sealed = mine.seal(HEADERS);
  assert.equal(other.open(sealed), null);
  const bytes = Buffer.from(sealed.slice(PREFIX.length), 'base64'); bytes[bytes.length - 1] ^= 1;
  for (const value of [PREFIX + bytes.toString('base64'), 'plain', PREFIX, PREFIX + '***', 42, null, PREFIX + 'A'.repeat(1024 * 1024)])
    assert.equal(mine.open(value), null, String(value).slice(0, 40));
});

test('only valid header names and single-line string values are kept', () => {
  const storage = fakeStorage(), vault = createHeaderVault(storage);
  const json = '{"Cookie":"a=b","Bad Name":"x","Injected":"a\\r\\nHost: evil","Number":5,"__proto__":{"polluted":"yes"}}';
  const raw = PREFIX + storage.encryptString(json).toString('base64');
  assert.deepEqual(vault.open(raw), { Cookie: 'a=b' });
  assert.equal({}.polluted, undefined);
  assert.equal(vault.seal({}), null);
  assert.equal(vault.seal(['Cookie']), null);
  const notObject = PREFIX + storage.encryptString('["Cookie"]').toString('base64');
  assert.equal(vault.open(notObject), null);
});

const fixtureRoot = path.resolve(__dirname, '.vault-fixtures');
fs.mkdirSync(fixtureRoot, { recursive: true });
function workspace(t) {
  const root = fs.mkdtempSync(path.join(fixtureRoot, 'run-'));
  const managers = [];
  t.after(async () => {
    for (const manager of managers) await manager.stop();
    const resolved = path.resolve(root);
    assert.ok(resolved.startsWith(fixtureRoot + path.sep), 'cleanup remains in test workspace');
    fs.rmSync(resolved, { recursive: true, force: true });
  });
  const stateFile = path.join(root, 'library.json'), downloadDir = path.join(root, 'downloads');
  const open = options => { const manager = new DownloadManager({ stateFile, downloadDir, ...options }); managers.push(manager); return manager; };
  return { root, stateFile, downloadDir, open };
}
async function until(predicate, description) {
  const deadline = Date.now() + 4000;
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error(`Timed out waiting for ${description}`);
    await new Promise(resolve => setTimeout(resolve, 5));
  }
}
const pausedJob = (downloadDir, extra) => ({
  id: 'job', name: 'part01.rar', folder: path.join(downloadDir, 'Game'), gameTitle: 'Game', status: 'paused',
  url: 'https://files.example.com/job', sourceUrl: 'https://host.example.com/job', received: 0, total: 3,
  etag: null, lastModified: null, speed: 0, error: '', ...extra,
});
function saveJobs(w, jobs) {
  fs.writeFileSync(w.stateFile, JSON.stringify({ settings: { downloadDir: w.downloadDir, connectionsPerFile: 1 }, downloads: jobs }));
}
const fileResponse = () => new Response('abc', { headers: { 'content-type': 'application/octet-stream', 'content-length': '3', etag: '"one"' } });
function assertNoSecrets(value) {
  const text = typeof value === 'string' ? value : JSON.stringify(value);
  assert.equal(text.includes(SECRET), false);
  assert.equal(text.includes(PREFIX), false);
}

test('library.json stores sealed headers and a fresh session sends the original cookie', async t => {
  const storage = fakeStorage(), w = workspace(t), sent = [];
  const fetcher = async (_url, options) => {
    sent.push(new Headers(options.headers).get('cookie'));
    return new Response('abc', { headers: { 'content-type': 'application/octet-stream', 'content-length': '3', etag: '"one"' } });
  };
  const first = w.open({ fetcher, vault: createHeaderVault(storage) });
  first.pump = () => {}; // Persist the queued job without starting a file request.
  first.add({ gameTitle: 'Game', links: [{ status: 'ready', url: 'https://files.example.com/one', sourceUrl: 'https://host.example.com/one', filename: 'part01.rar', headers: HEADERS }] });
  await first.stop();
  const text = fs.readFileSync(w.stateFile, 'utf8'), saved = JSON.parse(text);
  assert.equal(text.includes('not-a-real-secret'), false);
  assert.equal(saved.downloads[0].headers, undefined);
  assert.ok(saved.downloads[0].sealedHeaders.startsWith(PREFIX));
  assert.deepEqual(sent, []);

  const second = w.open({ fetcher, vault: createHeaderVault(storage) });
  assert.deepEqual(second.downloads[0].headers, HEADERS);
  assert.equal('sealedHeaders' in second.downloads[0], false);
  assert.equal(JSON.stringify(second.state()).includes('not-a-real-secret'), false);
  assert.equal(JSON.stringify(second.state()).includes(PREFIX), false);
  assert.equal(second.state().headerStorageWarning, '');
  second.action(second.downloads[0].id, 'resume');
  await until(() => second.downloads[0].status === 'completed', 'resumed encrypted download');
  assert.deepEqual(sent, [SECRET]);
});

test('plain-text cookies from older versions are sealed when Atlas opens', t => {
  const w = workspace(t);
  fs.mkdirSync(path.dirname(w.stateFile), { recursive: true });
  fs.writeFileSync(w.stateFile, JSON.stringify({ settings: { downloadDir: w.downloadDir }, downloads: [pausedJob(w.downloadDir, { headers: HEADERS })] }));
  const manager = w.open({ vault: createHeaderVault(fakeStorage()) });
  assert.deepEqual(manager.downloads[0].headers, HEADERS);
  const text = fs.readFileSync(w.stateFile, 'utf8');
  assert.equal(text.includes('not-a-real-secret'), false);
  assert.ok(JSON.parse(text).downloads[0].sealedHeaders.startsWith(PREFIX));
});

for (const [label, makeVault] of [
  ['unavailable encryption', () => createHeaderVault(fakeStorage({ available: false }))],
  ['no vault', () => null],
  ['missing seal method', () => ({})],
  ['throwing seal method', () => ({ seal() { throw new Error('Encryption failed'); } })],
  ['throwing encryption service', () => createHeaderVault({ ...fakeStorage(), encryptString() { throw new Error('Key unavailable'); } })],
]) {
  test(`legacy plaintext is scrubbed on startup with ${label}, while the session keeps its headers`, async t => {
    const w = workspace(t), sent = [];
    saveJobs(w, [pausedJob(w.downloadDir, { headers: HEADERS })]);
    const manager = w.open({
      vault: makeVault(),
      fetcher: async (_url, options) => { sent.push(new Headers(options.headers).get('cookie')); return fileResponse(); },
      resolveLink: async () => { throw new Error('The live session should not need to resolve the link again'); },
    });
    // Constructor migration must scrub immediately, before an explicit save.
    const text = fs.readFileSync(w.stateFile, 'utf8'), saved = JSON.parse(text).downloads[0];
    assertNoSecrets(text);
    assert.deepEqual(saved.headers, {});
    assert.equal(saved.headersNeedRefresh, true);
    assert.equal('sealedHeaders' in saved, false);
    assert.deepEqual(manager.downloads[0].headers, HEADERS);
    assert.notEqual(manager.downloads[0].headersNeedRefresh, true);
    assert.match(manager.state().headerStorageWarning, /could not be saved securely/i);
    assertNoSecrets(manager.state());
    manager.action('job', 'resume');
    await until(() => manager.downloads[0].status === 'completed', 'in-memory authenticated download');
    assert.deepEqual(sent, [SECRET]);
    await manager.stop();
    assertNoSecrets(fs.readFileSync(w.stateFile, 'utf8'));
  });
}

test('new credentials never reach disk if sealing throws', t => {
  const w = workspace(t), manager = w.open({ vault: { seal() { throw new Error('No key'); } } });
  manager.pump = () => {}; // Keep the job queued without starting a file request.
  manager.add({ gameTitle: 'Game', links: [{ status: 'ready', url: 'https://files.example.com/one', sourceUrl: 'https://host.example.com/one', filename: 'part01.rar', headers: HEADERS }] });
  const text = fs.readFileSync(w.stateFile, 'utf8'), saved = JSON.parse(text).downloads[0];
  assertNoSecrets(text);
  assert.deepEqual(saved.headers, {});
  assert.equal(saved.headersNeedRefresh, true);
  assert.deepEqual(manager.downloads[0].headers, HEADERS);
  assert.match(manager.state().headerStorageWarning, /could not be saved securely/i);
  assertNoSecrets(manager.state());
});

for (const [label, resolveLink] of [
  ['no resolver', undefined],
  ['resolver throws', async () => { throw new Error('Source page unavailable'); }],
  ['resolver requires a browser check', async () => ({ status: 'browser', message: 'Browser check required' })],
]) {
  test(`a restarted job with lost credentials makes no file request when ${label}`, async t => {
    const w = workspace(t), sent = [];
    saveJobs(w, [pausedJob(w.downloadDir, { headers: HEADERS })]);
    const first = w.open({ vault: createHeaderVault(fakeStorage({ available: false })) });
    await first.stop();
    const second = w.open({
      resolveLink,
      fetcher: async url => { sent.push(url); return fileResponse(); },
    });
    assert.equal(second.downloads[0].headersNeedRefresh, true);
    second.action('job', 'resume');
    await until(() => second.downloads[0].status === 'error', 'blocked stale authenticated download');
    assert.deepEqual(sent, []);
    assert.equal(second.downloads[0].headersNeedRefresh, true);
    assert.ok(second.downloads[0].error);
    assert.equal(fs.existsSync(path.join(second.downloads[0].folder, second.downloads[0].name)), false);
    assertNoSecrets(second.state());
  });
}

test('a restarted job resolves before any GET and uses fresh cookies, then clears the refresh flag', async t => {
  const w = workspace(t), events = [], freshCookie = 'host_session=fresh-synthetic-cookie';
  saveJobs(w, [pausedJob(w.downloadDir, { headers: HEADERS })]);
  const first = w.open({ vault: null });
  await first.stop();
  const second = w.open({
    vault: createHeaderVault(fakeStorage()),
    resolveLink: async source => {
      events.push(['resolve', source]);
      return { status: 'ready', url: 'https://files.example.com/refreshed', headers: { Cookie: freshCookie }, referer: 'https://host.example.com/fresh' };
    },
    fetcher: async (url, options) => {
      const headers = new Headers(options.headers);
      events.push(['GET', url, headers.get('cookie'), headers.get('referer')]);
      assert.equal(second.downloads[0].headersNeedRefresh, undefined, 'refresh completes before the GET');
      return fileResponse();
    },
  });
  second.action('job', 'resume');
  await until(() => second.downloads[0].status === 'completed', 'refreshed download');
  await second.stop();
  assert.deepEqual(events, [
    ['resolve', 'https://host.example.com/job'],
    ['GET', 'https://files.example.com/refreshed', freshCookie, 'https://host.example.com/fresh'],
  ]);
  assert.equal(second.downloads[0].headersNeedRefresh, undefined);
  const text = fs.readFileSync(w.stateFile, 'utf8'), saved = JSON.parse(text).downloads[0];
  assert.equal(saved.headersNeedRefresh, undefined);
  assert.equal(saved.headers, undefined);
  assert.ok(saved.sealedHeaders.startsWith(PREFIX));
  assert.equal(text.includes(freshCookie), false);
  assert.equal(second.state().headerStorageWarning, '');
  assertNoSecrets(second.state());
  assert.equal(JSON.stringify(second.state()).includes(freshCookie), false);
});

test('headers sealed on another account are dropped without losing the job', t => {
  const w = workspace(t);
  const sealed = createHeaderVault(fakeStorage()).seal(HEADERS);
  fs.mkdirSync(path.dirname(w.stateFile), { recursive: true });
  fs.writeFileSync(w.stateFile, JSON.stringify({ settings: { downloadDir: w.downloadDir }, downloads: [pausedJob(w.downloadDir, { sealedHeaders: sealed }), pausedJob(w.downloadDir, { id: 'second', sealedHeaders: 'garbage' })] }));
  const manager = w.open({ vault: createHeaderVault(fakeStorage()) });
  assert.equal(manager.downloads.length, 2);
  for (const d of manager.downloads) { assert.deepEqual(d.headers, {}); assert.equal('sealedHeaders' in d, false); assert.equal(d.headersNeedRefresh, true); }
  assert.match(manager.state().headerStorageWarning, /could not be saved securely/i);
  assertNoSecrets(manager.state());
  // A build without a vault also opens the profile instead of failing.
  const noVault = w.open({});
  assert.deepEqual(noVault.downloads.map(d => d.headers), [{}, {}]);
});

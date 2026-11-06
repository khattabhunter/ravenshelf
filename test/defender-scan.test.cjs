'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createDefenderScanner, findMpCmdRun, interpretScan, compareVersions } = require('../src/defender-scan.cjs');
const { DownloadManager } = require('../src/downloads.cjs');

const FILE = 'C:\\Games\\Example\\part01.rar';
const dirent = name => ({ name, isDirectory: () => true });
function fakeFs({ files = [], platformDirs = null } = {}) {
  const set = new Set(files);
  return {
    readdirSync(dir) { if (!platformDirs) throw Object.assign(new Error('missing'), { code: 'ENOENT' }); return platformDirs.map(dirent); },
    statSync(file) { if (!set.has(file)) throw Object.assign(new Error('missing'), { code: 'ENOENT' }); return { isFile: () => true }; },
    remove(file) { set.delete(file); },
  };
}
const env = { ProgramData: 'C:\\ProgramData', ProgramFiles: 'C:\\Program Files' };
const platformTool = version => `C:\\ProgramData\\Microsoft\\Windows Defender\\Platform\\${version}\\MpCmdRun.exe`;
const inboxTool = 'C:\\Program Files\\Windows Defender\\MpCmdRun.exe';

test('the newest Defender platform build is preferred, with Program Files as fallback', () => {
  assert.ok(compareVersions('4.18.25010.11-0', '4.18.9000.1-0') > 0);
  const dirs = ['4.18.24090.11-0', 'not-a-version', '4.18.25010.11-0', '4.18.9000.1-0'];
  assert.equal(findMpCmdRun({ env, fsApi: fakeFs({ platformDirs: dirs, files: [platformTool('4.18.24090.11-0'), platformTool('4.18.25010.11-0'), inboxTool] }) }), platformTool('4.18.25010.11-0'));
  assert.equal(findMpCmdRun({ env, fsApi: fakeFs({ platformDirs: dirs, files: [inboxTool] }) }), inboxTool);
  assert.equal(findMpCmdRun({ env, fsApi: fakeFs({ files: [] }) }), null);
});

test('scan output is interpreted without trusting the exit code alone', () => {
  assert.equal(interpretScan({ code: 0, stdout: 'Scan starting...\nScan finished.\nScanning C:\\x.rar found no threats.', fileExists: true }).status, 'clean');
  assert.equal(interpretScan({ code: 0, stdout: '', fileExists: true }).status, 'clean');
  const remediated = interpretScan({ code: 0, stdout: 'Scanning C:\\x.rar found 1 threats.', fileExists: false });
  assert.equal(remediated.status, 'threat'); assert.match(remediated.message, /removed or quarantined/);
  assert.equal(interpretScan({ code: 0, stdout: 'Scan finished.', fileExists: false }).status, 'threat');
  const action = interpretScan({ code: 2, stdout: '<===========================LIST OF DETECTED THREATS==========================>\nThreat : Trojan:Win32/Test', fileExists: true });
  assert.equal(action.status, 'threat'); assert.match(action.message, /Do not open it/);
  assert.equal(interpretScan({ code: 2, stdout: 'CmdTool: Failed with hr = 0x800106BA', fileExists: true }).status, 'error');
  assert.equal(interpretScan({ code: null, stdout: '', fileExists: true }).status, 'error');
  assert.equal(interpretScan({ code: null, timedOut: true, fileExists: true }).status, 'error');
});

test('the scanner runs a custom Defender file scan with a hidden window and a time limit', async () => {
  const fsApi = fakeFs({ files: [FILE] }), calls = [];
  const scan = createDefenderScanner({ platform: 'win32', fsApi, findTool: () => inboxTool, timeoutMs: 5000,
    now: () => new Date('2026-11-06T12:00:00Z'),
    execFileImpl(tool, args, options, done) { calls.push({ tool, args, options }); done(null, 'Scanning found no threats.'); } });
  const result = await scan(FILE);
  assert.deepEqual(result, { status: 'clean', message: 'Microsoft Defender found no threats.', scannedAt: '2026-11-06T12:00:00.000Z' });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].tool, inboxTool);
  assert.deepEqual(calls[0].args, ['-Scan', '-ScanType', '3', '-File', FILE]);
  assert.equal(calls[0].options.windowsHide, true);
  assert.equal(calls[0].options.timeout, 5000);
});

test('the scanner reports a threat when Defender removes the file, and handles failures', async () => {
  const fsApi = fakeFs({ files: [FILE] });
  const removing = createDefenderScanner({ platform: 'win32', fsApi, findTool: () => inboxTool,
    execFileImpl(_tool, _args, _options, done) { fsApi.remove(FILE); done(null, 'Scanning found 1 threats.'); } });
  assert.equal((await removing(FILE)).status, 'threat');

  const failing = createDefenderScanner({ platform: 'win32', fsApi: fakeFs({ files: [FILE] }), findTool: () => inboxTool,
    execFileImpl(_tool, _args, _options, done) { done(Object.assign(new Error('spawn failed'), { code: 'ENOENT' }), ''); } });
  assert.equal((await failing(FILE)).status, 'error');
  const throwing = createDefenderScanner({ platform: 'win32', fsApi: fakeFs({ files: [FILE] }), findTool: () => inboxTool, execFileImpl() { throw new Error('blocked'); } });
  assert.equal((await throwing(FILE)).status, 'error');
  const slow = createDefenderScanner({ platform: 'win32', fsApi: fakeFs({ files: [FILE] }), findTool: () => inboxTool,
    execFileImpl(_tool, _args, _options, done) { done(Object.assign(new Error('timeout'), { killed: true, signal: 'SIGTERM' }), ''); } });
  assert.match((await slow(FILE)).message, /took too long/);
});

test('the scanner never runs a tool for unsupported platforms, missing files or missing Defender', async () => {
  let ran = false; const execFileImpl = () => { ran = true; };
  assert.equal((await createDefenderScanner({ platform: 'linux', execFileImpl })(FILE)).status, 'unavailable');
  assert.equal((await createDefenderScanner({ platform: 'win32', fsApi: fakeFs(), findTool: () => inboxTool, execFileImpl })(FILE)).status, 'missing');
  assert.equal((await createDefenderScanner({ platform: 'win32', fsApi: fakeFs({ files: ['part01.rar'] }), findTool: () => inboxTool, execFileImpl })('part01.rar')).status, 'missing');
  assert.equal((await createDefenderScanner({ platform: 'win32', fsApi: fakeFs({ files: [FILE] }), findTool: () => null, execFileImpl })(FILE)).status, 'unavailable');
  assert.equal(ran, false);
});

// Download-manager integration
const fixtureRoot = path.resolve(__dirname, '.scan-fixtures');
fs.mkdirSync(fixtureRoot, { recursive: true });
const fileResponse = () => new Response('abc', { headers: { 'content-type': 'application/octet-stream', 'content-length': '3', etag: '"one"' } });
const link = (id, filename = `${id}.rar`) => ({ status: 'ready', url: `https://files.example.com/${id}`, sourceUrl: `https://host.example.com/${id}`, filename });
async function until(predicate, description) {
  const deadline = Date.now() + 4000;
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error(`Timed out waiting for ${description}`);
    await new Promise(resolve => setTimeout(resolve, 5));
  }
}
function workspace(t) {
  const root = fs.mkdtempSync(path.join(fixtureRoot, 'run-')), managers = [];
  t.after(async () => {
    for (const manager of managers) await manager.stop();
    const resolved = path.resolve(root);
    assert.ok(resolved.startsWith(fixtureRoot + path.sep), 'cleanup remains in test workspace');
    fs.rmSync(resolved, { recursive: true, force: true });
  });
  const stateFile = path.join(root, 'library.json'), downloadDir = path.join(root, 'downloads');
  return { stateFile, downloadDir, open(options) { const m = new DownloadManager({ stateFile, downloadDir, fetcher: fileResponse, ...options }); managers.push(m); return m; } };
}

test('finished downloads are scanned one at a time and the result is saved', async t => {
  const w = workspace(t), scanned = []; let active = 0, peak = 0;
  const scanFile = async file => {
    active++; peak = Math.max(peak, active); scanned.push(file);
    await new Promise(resolve => setTimeout(resolve, 20)); active--;
    return { status: 'clean', message: 'Microsoft Defender found no threats.', scannedAt: '2026-11-06T12:00:00.000Z' };
  };
  const manager = w.open({ scanFile });
  manager.add({ gameTitle: 'Game', links: [link('one'), link('two')] });
  await until(() => manager.downloads.length === 2 && manager.downloads.every(d => d.scan?.status === 'clean'), 'both scans');
  assert.equal(peak, 1);
  assert.deepEqual(scanned.map(file => path.basename(file)).sort(), ['one.rar', 'two.rar']);
  for (const file of scanned) assert.ok(fs.existsSync(file), 'the scanned path is the published file');
  const saved = JSON.parse(fs.readFileSync(w.stateFile, 'utf8'));
  assert.deepEqual(saved.downloads.map(d => d.scan.status), ['clean', 'clean']);
  assert.equal(manager.state().downloads[0].scan.status, 'clean');
});

test('automatic scans can be turned off, and Scan again still works', async t => {
  const w = workspace(t); let count = 0;
  const manager = w.open({ scanFile: async () => { count++; return { status: 'threat', message: 'Microsoft Defender found a threat in this file. Do not open it.' }; } });
  manager.updateSettings({ defenderScan: false });
  manager.add({ gameTitle: 'Game', links: [link('quiet')] });
  await until(() => manager.downloads[0]?.status === 'completed', 'download');
  await new Promise(resolve => setTimeout(resolve, 30));
  assert.equal(count, 0); assert.equal(manager.downloads[0].scan, undefined);
  manager.action(manager.downloads[0].id, 'scan');
  await until(() => manager.downloads[0].scan?.status === 'threat', 'manual scan');
  assert.equal(count, 1);
  assert.throws(() => manager.action('missing-id', 'scan'), /not found/);
});

test('Scan again is refused for unfinished files or when scanning is unavailable', async t => {
  const w = workspace(t);
  const manager = w.open({ fetcher: (_url, { signal }) => new Promise((_resolve, reject) => signal.addEventListener('abort', () => reject(signal.reason || new Error('aborted')), { once: true })), scanFile: async () => ({ status: 'clean' }) });
  manager.add({ gameTitle: 'Game', links: [link('pending')] });
  assert.throws(() => manager.action(manager.downloads[0].id, 'scan'), /Only finished downloads/);
  manager.action(manager.downloads[0].id, 'cancel');
  const plain = w.open({ stateFile: path.join(path.dirname(w.stateFile), 'other.json') });
  plain.downloads.push({ id: 'done', status: 'completed', folder: w.downloadDir, name: 'x.rar', headers: {} });
  assert.throws(() => plain.action('done', 'scan'), /not available/);
});

test('scans interrupted by closing the app run again on the next start', async t => {
  const w = workspace(t);
  const folder = path.join(w.downloadDir, 'Game'); fs.mkdirSync(folder, { recursive: true });
  fs.writeFileSync(path.join(folder, 'part01.rar'), 'abc');
  fs.writeFileSync(w.stateFile, JSON.stringify({ settings: { downloadDir: w.downloadDir }, downloads: [
    { id: 'interrupted', status: 'completed', folder, name: 'part01.rar', headers: {}, scan: { status: 'scanning' } },
    { id: 'finished', status: 'completed', folder, name: 'part01.rar', headers: {}, scan: { status: 'clean', message: 'ok' } },
  ] }));
  const scanned = [];
  const manager = w.open({ scanFile: async file => { scanned.push(file); return { status: 'clean', message: 'Microsoft Defender found no threats.' }; } });
  await until(() => manager.downloads[0].scan?.status === 'clean', 'resumed scan');
  assert.equal(scanned.length, 1);
  assert.equal(manager.downloads[1].scan.message, 'ok');
});

test('an unexpected scanner failure is recorded as a scan error', async t => {
  const w = workspace(t);
  const manager = w.open({ scanFile: async () => { throw new Error('boom'); } });
  manager.add({ gameTitle: 'Game', links: [link('broken')] });
  await until(() => manager.downloads[0]?.scan?.status === 'error', 'scan error');
  assert.match(manager.downloads[0].scan.message, /could not finish/);
});

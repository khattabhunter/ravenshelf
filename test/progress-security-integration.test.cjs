'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createRequire } = require('node:module');
const { DownloadManager } = require('../src/downloads.cjs');
const { CompletionAction } = require('../src/completion-action.cjs');
const { assertCompletionReady } = require('../src/completion-policy.cjs');

const fixtureRoot = path.resolve(__dirname, '.progress-security-fixtures');
fs.mkdirSync(fixtureRoot, { recursive: true });
const HEADERS = { Cookie: 'fixture-cookie-value', Authorization: 'Bearer fixture-token' };
const progressKeys = ['activeConnections', 'id', 'received', 'speed', 'total'];
const flush = () => new Promise(resolve => setImmediate(resolve));
async function until(predicate, description) {
  const deadline = Date.now() + 4000;
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error(`Timed out waiting for ${description}`);
    await new Promise(resolve => setTimeout(resolve, 5));
  }
}
function fixture(t) {
  const root = fs.mkdtempSync(path.join(fixtureRoot, 'run-')), managers = [];
  t.after(async () => {
    for (const manager of managers) await manager.stop();
    const resolved = path.resolve(root);
    assert.ok(resolved.startsWith(fixtureRoot + path.sep), 'cleanup remains in test workspace');
    fs.rmSync(resolved, { recursive: true, force: true });
  });
  return {
    root, stateFile: path.join(root, 'state.json'), downloadDir: path.join(root, 'downloads'),
    open(options = {}, Manager = DownloadManager) {
      const manager = new Manager({ stateFile: path.join(root, 'state.json'), downloadDir: path.join(root, 'downloads'), ...options });
      managers.push(manager); return manager;
    },
  };
}
function link(id, extra = {}) {
  return { status: 'ready', url: `https://files.example.com/${id}`, sourceUrl: `https://host.example.com/${id}`,
    filename: `${id}.rar`, headers: HEADERS, ...extra };
}
function response(body, headers = {}, status = 200) {
  return new Response(body, { status, headers: { 'content-type': 'application/octet-stream', ...headers } });
}
function heldBody(signal, initial) {
  let stream;
  const body = new ReadableStream({ start(controller) { stream = controller; if (initial) controller.enqueue(initial); } });
  signal.addEventListener('abort', () => { try { stream.error(signal.reason || new Error('Aborted')); } catch {} }, { once: true });
  return { body, finish: () => stream.close() };
}
function record(manager) {
  const events = [];
  manager.on('state', value => events.push({ type: 'state', value: structuredClone(value) }));
  manager.on('progress', value => events.push({ type: 'progress', value: structuredClone(value) }));
  return events;
}

test('one progress tick batches live transfers without carrying credentials or historical records', async t => {
  const f = fixture(t), bodies = [];
  const manager = f.open({ fetcher: async (_url, { signal }) => {
    const held = heldBody(signal, Buffer.from('abc')); bodies.push(held);
    return response(held.body, { 'content-length': '3', etag: '"revision-1"' });
  } });
  manager.updateSettings({ concurrency: 4, connectionsPerFile: 1 });
  const modeUpdates = [];
  manager.on('state', value => modeUpdates.push(structuredClone(value)));
  manager.add({ gameTitle: 'Fixture game', links: [link('one'), link('two'), link('three'), link('four')] });
  await until(() => manager.downloads.every(item => item.received === 3), 'four active streams');
  for (const item of manager.downloads) {
    assert.ok(modeUpdates.some(state => state.downloads.some(update => update.id === item.id &&
      update.connectionMode === 'single' && update.connectionNote === 'One connection selected.')),
    'connection mode and explanation reach the UI without waiting for numeric progress');
  }
  manager.downloads.push({ id: 'history', status: 'completed', received: 10, total: 10, speed: 0,
    url: 'https://files.example.com/history?secret=fixture', folder: f.downloadDir, headers: HEADERS });
  const events = record(manager);
  manager.publishProgress();
  assert.equal(events.length, 1, 'one batch is emitted instead of one full-state message per file');
  assert.equal(events[0].type, 'progress'); assert.equal(events[0].value.length, 4);
  for (const item of events[0].value) {
    assert.deepEqual(Object.keys(item).sort(), progressKeys);
    assert.equal(item.received, 3); assert.equal(item.total, 3);
    assert.ok(Number.isFinite(item.speed)); assert.ok(Number.isFinite(item.activeConnections));
    assert.notEqual(item.id, 'history');
  }
  const serialized = JSON.stringify(events[0].value);
  for (const forbidden of ['fixture-cookie-value', 'fixture-token', 'files.example.com', 'host.example.com', f.downloadDir,
    'headers', 'sealedHeaders', 'headersNeedRefresh', 'scan', 'settings', 'folder', 'sourceUrl']) {
    assert.ok(!serialized.includes(forbidden), `progress must not contain ${forbidden}`);
  }
  bodies.forEach(body => body.finish());
  await until(() => manager.running.size === 0, 'finished streams');
  const terminalEvents = events.length; manager.publishProgress();
  assert.equal(events.length, terminalEvents, 'completed history produces no progress event');
});

test('progress updates preserve byte-identical pause/resume and cannot restore a paused or completed transfer', async t => {
  const f = fixture(t), payload = Buffer.from([0, 1, 2, 3, 82, 97, 114, 255, 4, 5, 6, 7, 8, 9, 10]);
  let requests = 0, resumeHeaders, finishResume, sampleTime = 0;
  const controlled = managerWithControlledTimers(() => sampleTime);
  const manager = f.open({ fetcher: async (_url, { signal, headers }) => {
    requests++;
    if (requests === 1) {
      const held = heldBody(signal, payload.subarray(0, 6));
      return response(held.body, { 'content-length': String(payload.length), etag: '"revision-1"' });
    }
    resumeHeaders = headers;
    const held = heldBody(signal, payload.subarray(6)); finishResume = held.finish;
    return response(held.body, { 'content-length': String(payload.length - 6),
      'content-range': `bytes 6-${payload.length - 1}/${payload.length}`, etag: '"revision-1"' }, 206);
  } }, controlled.Manager);
  manager.updateSettings({ connectionsPerFile: 1 });
  const events = record(manager);
  manager.add({ gameTitle: 'Fixture game', links: [link('resume')] });
  const item = manager.downloads[0];
  await until(() => item.received === 6, 'first saved bytes');
  sampleTime = 500;
  manager.publishProgress();
  assert.equal(events.at(-1).type, 'progress'); assert.equal(events.at(-1).value[0].received, 6);
  assert.equal(events.at(-1).value[0].speed, 12);
  manager.action(item.id, 'pause');
  assert.equal(events.at(-1).type, 'state'); assert.equal(events.at(-1).value.downloads[0].status, 'paused');
  const pausedEvents = events.length; manager.publishProgress();
  assert.equal(events.length, pausedEvents, 'a timer tick cannot overwrite the immediate pause');
  await until(() => manager.running.size === 0, 'paused stream cleanup');
  assert.equal(manager.progressMeters.size, 0);
  sampleTime = 60500;
  manager.action(item.id, 'resume');
  await until(() => item.received === payload.length, 'resumed bytes');
  sampleTime += 500; manager.publishProgress();
  assert.equal(events.at(-1).value[0].speed, 18, 'resumed rate excludes old bytes and paused time');
  finishResume();
  await until(() => manager.running.size === 0 && item.status === 'completed', 'resumed transfer');
  assert.equal(requests, 2); assert.equal(resumeHeaders.Range, 'bytes=6-'); assert.equal(resumeHeaders['If-Range'], '"revision-1"');
  assert.equal(resumeHeaders.Cookie, HEADERS.Cookie, 'progress must not alter request credentials');
  assert.deepEqual(fs.readFileSync(path.join(item.folder, item.name)), payload);
  assert.equal(fs.existsSync(path.join(item.folder, item.name + '.atlas-part')), false);
  assert.equal(events.at(-1).type, 'state'); assert.equal(events.at(-1).value.downloads[0].status, 'completed');
  const completedEvents = events.length; manager.publishProgress();
  assert.equal(events.length, completedEvents); assert.equal(item.speed, 0); assert.equal(item.activeConnections, 0);
  assert.equal(manager.progressMeters.size, 0);
});

test('completion observes scans immediately without progress and remains blocked on review results', async t => {
  const f = fixture(t), scanResolvers = [], executions = []; let releaseFile, time = 0;
  const manager = f.open({ fetcher: () => new Promise(resolve => { releaseFile = resolve; }),
    scanFile: () => new Promise(resolve => scanResolvers.push(resolve)) });
  const completion = new CompletionAction({ getDownloads: () => manager.downloads, clock: () => time, autoTick: false,
    onExecute: (mode, details) => { assertCompletionReady(manager.downloads, details.ids); executions.push(mode); } });
  t.after(() => completion.dispose());
  manager.on('state', () => completion.refresh());
  const events = record(manager);
  manager.add({ gameTitle: 'Fixture game', links: [link('scan')] });
  completion.arm('close');
  manager.publishProgress();
  await until(()=>typeof releaseFile==='function','file request after local validation');
  releaseFile(response('abc', { 'content-length': '3', etag: '"revision-1"' }));
  await until(() => scanResolvers.length === 1, 'pending scan');
  assert.ok(events.some(event => event.type === 'state' && event.value.downloads[0]?.scan?.status === 'queued'));
  assert.equal(completion.snapshot().phase, 'armed'); assert.match(completion.snapshot().message, /scan/i);
  time = 120000; completion.tick(); manager.publishProgress(); await flush();
  assert.deepEqual(executions, []);
  scanResolvers.shift()({ status: 'review', message: 'Fixture scan needs review.' });
  await until(() => manager.downloads[0].scan?.status === 'review', 'review result');
  assert.ok(events.some(event => event.type === 'state' && event.value.downloads[0]?.scan?.status === 'review'));
  time = 240000; completion.tick(); manager.publishProgress(); await flush();
  assert.equal(completion.snapshot().phase, 'armed'); assert.deepEqual(executions, []);
  manager.action(manager.downloads[0].id, 'scan');
  await until(() => scanResolvers.length === 1, 'rescan');
  scanResolvers.shift()({ status: 'clean', message: 'Fixture explicit clean result.' });
  await until(() => completion.snapshot().phase === 'countdown', 'fresh completion countdown');
  assert.equal(completion.snapshot().remainingSeconds, 60);
  time += 59999; completion.tick(); await flush(); assert.deepEqual(executions, []);
  time++; completion.tick(); await flush(); assert.deepEqual(executions, ['close']);
});

function managerWithControlledTimers(clock) {
  const filename = path.resolve(__dirname, '../src/downloads.cjs'), timers = [], exported = { exports: {} };
  const localRequire = createRequire(filename);
  const RateMeter = localRequire('./rate-meter.cjs').RateMeter;
  vm.runInNewContext(fs.readFileSync(filename, 'utf8'), {
    require: request => request === './rate-meter.cjs' && clock
      ? { RateMeter: class extends RateMeter { constructor(options) { super({ ...options, clock }); } } } : localRequire(request),
    module: exported, exports: exported.exports, __dirname: path.dirname(filename),
    Buffer, URL, Headers, AbortController, setImmediate,
    setInterval(callback, milliseconds) { const timer = { callback, milliseconds, cleared: false, unref() {} }; timers.push(timer); return timer; },
    clearInterval(timer) { if (timer) timer.cleared = true; },
  }, { filename });
  return { Manager: exported.exports.DownloadManager, timers };
}

test('failed transfers and shutdown cleanup remove samplers and stop the global progress timer', async t => {
  const failedFixture = fixture(t), failed = failedFixture.open({ fetcher: async () => response('abc', { 'content-length': '10' }) });
  failed.add({ gameTitle: 'Fixture game', links: [link('truncated')] });
  await until(() => failed.running.size === 0, 'failed transfer cleanup');
  assert.equal(failed.downloads[0].status, 'error'); assert.match(failed.downloads[0].error, /ended early/);
  assert.equal(failed.progressMeters.size, 0);
  const failedEvents = record(failed); failed.publishProgress(); assert.equal(failedEvents.length, 0);

  const stoppedFixture = fixture(t), controlled = managerWithControlledTimers();
  const stopped = stoppedFixture.open({ fetcher: async (_url, { signal }) => {
    const held = heldBody(signal, Buffer.from('abc'));
    return response(held.body, { 'content-length': '10', etag: '"revision-1"' });
  } }, controlled.Manager);
  stopped.add({ gameTitle: 'Fixture game', links: [link('stopped')] });
  await until(() => stopped.downloads[0].received === 3, 'active transfer before stopping');
  assert.equal(stopped.progressMeters.size, 1);
  assert.equal(controlled.timers.filter(timer => timer.milliseconds === 500).length, 1, 'only one queue-level progress timer exists');
  await stopped.stop();
  assert.equal(stopped.progressMeters.size, 0); assert.equal(stopped.running.size, 0);
  assert.equal(stopped.downloads[0].status, 'paused');
  assert.ok(controlled.timers.filter(timer => [500, 2000].includes(timer.milliseconds)).every(timer => timer.cleared));
  const stoppedEvents = record(stopped); stopped.publishProgress(); assert.equal(stoppedEvents.length, 0);
});

test('periodic-save encryption failure and recovery notify immediately even when progress is separate', async t => {
  const f = fixture(t), controlled = managerWithControlledTimers(); let encryptionWorks = true;
  const manager = f.open({ vault: { seal: () => encryptionWorks ? 'fixture-sealed-headers' : null } }, controlled.Manager);
  manager.downloads.push({ id: 'active', status: 'downloading', name: 'active.rar', folder: f.downloadDir, headers: { ...HEADERS },
    received: 1, total: 3, speed: 1, activeConnections: 1 });
  manager.running.set('active', new AbortController()); manager.save();
  const events = record(manager), saveTimer = controlled.timers.find(timer => timer.milliseconds === 2000);
  assert.ok(saveTimer, 'the persistence schedule remains two seconds');
  saveTimer.callback(); assert.equal(events.length, 0, 'unchanged persistence metadata needs no full-state update');
  encryptionWorks = false; saveTimer.callback();
  assert.equal(events.length, 1); assert.equal(events[0].type, 'state');
  assert.match(events[0].value.headerStorageWarning, /could not be saved securely/i);
  let saved = JSON.parse(fs.readFileSync(f.stateFile, 'utf8'));
  assert.deepEqual(saved.downloads[0].headers, {}); assert.equal(saved.downloads[0].headersNeedRefresh, true);
  assert.ok(!JSON.stringify(saved).includes(HEADERS.Cookie)); assert.equal(manager.downloads[0].headers.Cookie, HEADERS.Cookie);
  saveTimer.callback(); assert.equal(events.length, 1, 'the same warning is not resent at every save');
  encryptionWorks = true; saveTimer.callback();
  assert.equal(events.length, 2); assert.equal(events[1].type, 'state'); assert.equal(events[1].value.headerStorageWarning, '');
  saved = JSON.parse(fs.readFileSync(f.stateFile, 'utf8'));
  assert.equal(saved.downloads[0].sealedHeaders, 'fixture-sealed-headers'); assert.equal(saved.downloads[0].headers, undefined);
  for (const event of events) {
    assert.ok(!JSON.stringify(event.value).includes(HEADERS.Cookie));
    assert.ok(!JSON.stringify(event.value).includes('fixture-sealed-headers'));
  }
});

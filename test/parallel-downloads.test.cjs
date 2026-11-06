'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const vm = require('node:vm');
const { createRequire } = require('node:module');
const { DownloadManager } = require('../src/downloads.cjs');

// Different bytes at different positions catch missing, duplicated and misplaced ranges.
const MiB = 1024 * 1024;
const payload = Buffer.alloc(24 * MiB + 137);
for (let i = 0; i < payload.length; i++) payload[i] = (i * 31 + (i >>> 11) + (i >>> 19)) & 255;
const digest = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const expectedDigest = digest(payload);
const fixtureRoot = path.resolve(__dirname, '.parallel-fixtures');
fs.mkdirSync(fixtureRoot, { recursive: true });
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

async function until(predicate, label = 'condition', timeout = 15000) {
  const deadline = Date.now() + timeout;
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error(`Timed out waiting for ${label}`);
    await delay(3);
  }
}

// An HTTP-like host with observable request lifetimes and real streaming bodies.
// Rules alter the server, never the download manager or its filesystem operations.
function rangeHost(rule = () => ({}), { chunkDelay = 1, validators = true } = {}) {
  const host = { requests: [], active: 0, maxActive: 0, cancelled: 0, completed: [], revision: 1 };
  host.fetch = async (url, options = {}) => {
    const headers = new Headers(options.headers);
    const range = headers.get('range');
    const match = range && /^bytes=(\d+)-(\d*)$/.exec(range);
    const start = match ? Number(match[1]) : 0;
    const end = match && match[2] ? Math.min(Number(match[2]), payload.length - 1) : payload.length - 1;
    const request = { url, headers, range, start, end, bounded: Boolean(match?.[2]), signal: options.signal, sent: 0 };
    host.requests.push(request);
    const change = rule(request, host) || {};
    if (change.throw) throw change.throw;
    const status = change.status ?? (match ? 206 : 200);
    const actualStart = change.start ?? (status === 200 ? 0 : start);
    const actualEnd = change.end ?? (status === 200 ? payload.length - 1 : end);
    const length = Math.max(0, actualEnd - actualStart + 1);
    const revision = change.revision ?? host.revision;
    const responseHeaders = {
      'content-type': 'application/octet-stream',
      'content-length': String(length),
      ...(validators ? { etag: `"revision-${revision}"` } : {}),
      ...(status === 206 ? { 'content-range': `bytes ${actualStart}-${actualEnd}/${payload.length}` } : {}),
      ...change.headers,
    };
    for (const key of Object.keys(responseHeaders)) if (responseHeaders[key] === null) delete responseHeaders[key];
    const tracked = Boolean(request.range) && end - start > MiB && status === 206;
    let controller, closed = false, offset = actualStart;
    const limit = Math.min(actualEnd + 1, change.truncateAt === undefined ? Infinity : actualStart + change.truncateAt);
    const closeTracking = cancelled => {
      if (closed) return;
      closed = true;
      options.signal?.removeEventListener('abort', abort);
      if (tracked) host.active--;
      if (cancelled) host.cancelled++;
    };
    const abort = () => {
      if (closed) return;
      closeTracking(true);
      controller.error(options.signal.reason || new Error('Aborted'));
    };
    const body = new ReadableStream({
      start(c) {
        controller = c;
        if (tracked) { host.active++; host.maxActive = Math.max(host.maxActive, host.active); }
        if (options.signal?.aborted) abort();
        else options.signal?.addEventListener('abort', abort, { once: true });
      },
      async pull(c) {
        if (change.stall) {
          await new Promise(resolve => options.signal?.addEventListener('abort', resolve, { once: true }));
          return;
        }
        await delay(change.chunkDelay ?? chunkDelay);
        if (closed) return;
        if (offset >= limit) {
          closeTracking(false);
          host.completed.push(request);
          c.close();
          return;
        }
        const next = Math.min(offset + 128 * 1024, limit);
        const bytes = payload.subarray(offset, next);
        let output = bytes;
        if (revision !== 1) {
          output = Buffer.allocUnsafe(bytes.length);
          for (let i = 0; i < bytes.length; i++) output[i] = bytes[i] ^ 0xa5;
        }
        c.enqueue(output);
        request.sent += output.length;
        offset = next;
      },
      cancel() { closeTracking(true); },
    });
    return new Response(body, { status, headers: responseHeaders });
  };
  return host;
}

function fixture(t, host, settings = {}, Manager = DownloadManager) {
  const root = fs.mkdtempSync(path.join(fixtureRoot, 'run-'));
  const options = { stateFile: path.join(root, 'state.json'), downloadDir: path.join(root, 'downloads'), fetcher: host.fetch };
  let manager = new Manager(options);
  manager.updateSettings({ concurrency: 1, connectionsPerFile: 4, ...settings });
  t.after(async () => {
    await manager.stop();
    const target = path.resolve(root);
    assert.ok(target.startsWith(fixtureRoot + path.sep));
    fs.rmSync(target, { recursive: true, force: true });
  });
  return {
    root, options, get manager() { return manager; },
    async reopen() { await manager.stop(); manager = new Manager(options); return manager; },
    add(extra = {}) {
      manager.add({ gameTitle: 'Parallel fixture', links: [{
        status: 'ready', url: 'https://files.example.com/game', sourceUrl: 'https://host.example.com/game',
        filename: 'fixture.part01.rar', size: payload.length, ...extra,
      }] });
      return manager.downloads.at(-1);
    },
  };
}

async function finished(manager) {
  await until(() => !manager.running.size && manager.downloads.every(d => d.status !== 'queued'), 'download completion');
}

function assertComplete(d, expected = expectedDigest) {
  assert.equal(d.status, 'completed', d.error);
  const finalPath = path.join(d.folder, d.name);
  const actual=fs.readFileSync(finalPath);
  assert.equal(actual.length, payload.length);
  assert.equal(digest(actual), expected, 'every output byte must match the source');
  assert.equal(d.received, payload.length);
  assert.equal(d.activeConnections, 0);
}

test('parallel requests finish out of order but publish one byte-exact archive', async t => {
  const host = rangeHost(req => ({ chunkDelay: req.start === 0 ? 3 : 1 }));
  const f = fixture(t, host);
  const d = f.add();
  await finished(f.manager);
  assertComplete(d);
  assert.ok(host.maxActive > 1, 'several ranges must overlap in flight');
  assert.ok(host.maxActive <= 4, 'four is the connection ceiling');
  assert.equal(d.connectionMode, 'parallel');
  const completed = host.completed.filter(req => req.bounded && req.end - req.start > MiB);
  assert.ok(completed.some((req, i) => i && req.start < completed[i - 1].start), 'fixture really completes ranges out of order');
});

test('one-connection preference uses the ordinary stream and writes identical bytes', async t => {
  const host = rangeHost();
  const f = fixture(t, host, { connectionsPerFile: 1 });
  const d = f.add();
  await finished(f.manager);
  assertComplete(d);
  assert.equal(host.maxActive, 0);
  assert.equal(d.connectionMode, 'single');
  assert.equal(host.requests.filter(req => req.bounded).length, 0);
});

test('server ignoring range requests falls back to one stream without duplication', async t => {
  const host = rangeHost(() => ({ status: 200 }));
  const f = fixture(t, host);
  const d = f.add();
  await finished(f.manager);
  assertComplete(d);
  assert.equal(d.connectionMode, 'single');
  assert.ok(d.connectionNote, 'fallback is explained to the user');
});

test('unverifiable resources stay on one connection', async t => {
  const host = rangeHost(undefined, { validators: false });
  const f = fixture(t, host);
  const d = f.add();
  await finished(f.manager);
  assertComplete(d);
  assert.equal(d.connectionMode, 'single');
  assert.equal(host.maxActive, 0);
});

test('malformed Content-Range triggers safe fallback and no misplaced bytes', async t => {
  let injected = false;
  const host = rangeHost(req => {
    if (!injected && req.bounded && req.end - req.start > MiB) {
      injected = true;
      return { headers: { 'content-range': `bytes ${req.start + 1}-${req.end}/${payload.length}` } };
    }
  });
  const f = fixture(t, host);
  const d = f.add();
  await finished(f.manager);
  assert.ok(injected);
  assertComplete(d);
  assert.equal(d.connectionMode, 'single');
  assert.equal(host.active, 0);
});

test('truncated parallel response falls back without publishing a short file', async t => {
  let injected = false;
  const host = rangeHost(req => {
    if (!injected && req.bounded && req.end - req.start > MiB) {
      injected = true;
      return { truncateAt: 1024 * 1024 };
    }
  });
  const f = fixture(t, host);
  const d = f.add();
  await finished(f.manager);
  assert.ok(injected);
  assertComplete(d);
  assert.equal(d.connectionMode, 'single');
  assert.equal(host.active, 0);
});

test('rate-limited range workers stop before the single-connection fallback starts', async t => {
  let injected = false, fallbackWhileActive = false;
  const host = rangeHost((req, server) => {
    if (injected && !req.bounded && server.active) fallbackWhileActive = true;
    if (!injected && req.bounded && req.start >= 8 * MiB) {
      injected = true;
      return { status: 429, start: 0, end: -1, headers: { 'retry-after': '1' } };
    }
  });
  const f = fixture(t, host);
  const d = f.add();
  await finished(f.manager);
  assert.ok(injected);
  assertComplete(d);
  assert.equal(d.connectionMode, 'single');
  assert.equal(fallbackWhileActive, false);
  assert.equal(host.active, 0);
});

test('pause and restart retain resumable range data and never publish sparse holes', async t => {
  const host = rangeHost(undefined, { chunkDelay: 3 });
  const f = fixture(t, host);
  const d = f.add();
  await until(() => host.maxActive > 1 && d.received >= MiB, 'parallel progress');
  f.manager.action(d.id, 'pause');
  await finished(f.manager);
  assert.equal(d.status, 'paused');
  assert.equal(d.activeConnections, 0);
  assert.equal(host.active, 0);
  assert.equal(fs.existsSync(path.join(d.folder, d.name)), false);
  const saved = d.received;
  assert.ok(saved > 0 && saved < payload.length);
  const requestBoundary = host.requests.length;
  const resumed = await f.reopen();
  const next = resumed.downloads[0];
  assert.equal(next.status, 'paused');
  assert.equal(next.activeConnections, 0);
  resumed.action(next.id, 'resume');
  await finished(resumed);
  assertComplete(next);
  assert.ok(host.requests.slice(requestBoundary).some(req => req.start > 0), 'saved positions are used after reopening');
  const resumedBytes = host.requests.slice(requestBoundary).reduce((sum, req) => sum + req.sent, 0);
  assert.ok(resumedBytes < payload.length, 'restart reuses saved bytes instead of downloading the whole file again');
});

test('unknown-size large downloads can discover and use parallel ranges', async t => {
  const host = rangeHost();
  const f = fixture(t, host);
  const d = f.add({ size: 0 });
  await finished(f.manager);
  assertComplete(d);
  assert.ok(host.maxActive > 1);
});

test('host with malformed bounded ranges but valid open-ended ranges still downloads exact bytes in parallel', async t => {
  const host = rangeHost(req => req.bounded ? {
    // This reproduces the live host quirk: its reported end exceeds the bounded body.
    headers: { 'content-range': `bytes ${req.start}-${payload.length - 1}/${payload.length}` },
  } : {});
  const f = fixture(t, host);
  const d = f.add();
  await finished(f.manager);
  assertComplete(d);
  assert.equal(d.connectionMode, 'parallel');
  assert.ok(host.requests.some(req => req.range && !req.bounded && req.start > 0), 'valid open-ended sections are used');
  assert.ok(host.maxActive > 1);
  assert.ok(host.maxActive <= 4);
  assert.equal(host.active, 0);
});

for(const type of ['text/html; charset=UTF-8','text/javascript','text/xml'])test(`${type} responses are rejected even when a large file was expected`, async t => {
  const host = rangeHost(() => ({ headers: { 'content-type': type } }));
  const f = fixture(t, host);
  const d = f.add();
  await finished(f.manager);
  assert.equal(d.status, 'error');
  assert.equal(fs.existsSync(path.join(d.folder, d.name)), false);
  assert.equal(d.activeConnections, 0);
  assert.equal(host.active, 0);
});

test('expired direct link resolves once and parallel requests only use refreshed credentials', async t => {
  let resolves = 0;
  const host = rangeHost(req => req.url.endsWith('/expired') ? { status: 403, start: 0, end: -1 } : {});
  const f = fixture(t, host);
  f.manager.resolveLink = async () => {
    resolves++;
    return { status: 'ready', url: 'https://fresh.example.net/game', headers: { Referer: 'https://host.example.com/new' } };
  };
  const d = f.add({ url: 'https://files.example.com/expired', headers: { Cookie: 'fake-cookie', Authorization: 'fake-token' } });
  await finished(f.manager);
  assertComplete(d);
  assert.equal(resolves, 1);
  const refreshed = host.requests.filter(req => req.url.startsWith('https://fresh.example.net/'));
  assert.ok(refreshed.some(req => req.bounded));
  for (const req of refreshed) {
    assert.equal(req.headers.get('cookie'), null);
    assert.equal(req.headers.get('authorization'), null);
    assert.equal(req.headers.get('referer'), 'https://host.example.com/new');
  }
});

test('changed ETag during parallel requests never produces a mixed-version archive', async t => {
  let changed = false;
  const host = rangeHost((req, server) => {
    if (req.bounded && req.start >= 8 * MiB) { changed = true; server.revision = 2; }
  });
  const f = fixture(t, host);
  const d = f.add();
  await finished(f.manager);
  assert.ok(changed);
  if (d.status === 'completed') {
    const revised = Buffer.allocUnsafe(payload.length);
    for (let i = 0; i < payload.length; i++) revised[i] = payload[i] ^ 0xa5;
    assertComplete(d, digest(revised));
  } else {
    assert.equal(d.status, 'error');
    assert.equal(fs.existsSync(path.join(d.folder, d.name)), false);
  }
  assert.equal(host.active, 0);
});

test('two-connection preference bounds the number of simultaneous ranges', async t => {
  const host = rangeHost();
  const f = fixture(t, host, { connectionsPerFile: 2 });
  const d = f.add();
  await finished(f.manager);
  assertComplete(d);
  assert.equal(host.maxActive, 2);
});

test('cancelling parallel work settles every request and does not initiate fallback', async t => {
  const host = rangeHost(undefined, { chunkDelay: 3 });
  const f = fixture(t, host);
  const d = f.add();
  await until(() => host.maxActive > 1 && d.received >= MiB, 'parallel progress');
  f.manager.action(d.id, 'cancel');
  await finished(f.manager);
  const requestsAfterCancel = host.requests.length;
  await delay(30);
  assert.equal(d.status, 'cancelled');
  assert.equal(d.activeConnections, 0);
  assert.equal(host.active, 0);
  assert.equal(host.requests.length, requestsAfterCancel);
  assert.equal(fs.existsSync(path.join(d.folder, d.name)), false);
  assert.ok(d.received > 0, 'cancellation preserves resumable work');
});

test('missing validator on a fallback resume cannot splice a different file onto saved bytes', async t => {
  let interrupted = false;
  const host = rangeHost(req => {
    if (!interrupted && req.bounded && req.start === 0 && req.end > MiB) {
      interrupted = true;
      return { truncateAt: MiB };
    }
    if (interrupted && req.range && !req.bounded && req.start > 0) {
      return { revision: 2, headers: { etag: null } };
    }
  });
  const f = fixture(t, host);
  const d = f.add();
  await finished(f.manager);
  assert.ok(interrupted);
  if (d.status === 'completed') assertComplete(d);
  else {
    assert.equal(d.status, 'error');
    assert.equal(fs.existsSync(path.join(d.folder, d.name)), false);
  }
  assert.equal(host.active, 0);
});

test('a damaged checkpoint never turns sparse file length into completed download progress', async t => {
  const host = rangeHost(undefined, { chunkDelay: 3 });
  const f = fixture(t, host);
  const d = f.add();
  await until(() => host.maxActive > 1 && d.received >= MiB, 'parallel progress');
  f.manager.action(d.id, 'pause');
  await finished(f.manager);
  const workspace = fs.readdirSync(d.folder, { withFileTypes: true }).find(entry => entry.isDirectory() && entry.name.startsWith('.atlas-segments-'));
  assert.ok(workspace, 'the interrupted sections have a separate workspace');
  fs.writeFileSync(path.join(d.folder, workspace.name, 'state.json'), '{damaged checkpoint');
  const reopened = await f.reopen();
  const next = reopened.downloads[0];
  reopened.action(next.id, 'resume');
  await finished(reopened);
  assertComplete(next);
  assert.equal(next.connectionMode, 'single');
});

test('an interrupted parallel download can resume with the one-connection setting', async t => {
  const host = rangeHost(undefined, { chunkDelay: 3 });
  const f = fixture(t, host);
  const d = f.add();
  await until(() => host.maxActive > 1 && d.received >= MiB, 'parallel progress');
  f.manager.action(d.id, 'pause');
  await finished(f.manager);
  host.maxActive = 0;
  f.manager.updateSettings({ connectionsPerFile: 1 });
  f.manager.action(d.id, 'resume');
  await finished(f.manager);
  assertComplete(d);
  assert.equal(d.connectionMode, 'single');
  assert.equal(host.maxActive, 1);
});

test('a sufficiently old Last-Modified validator supports reliable parallel ranges', async t => {
  const modified = 'Fri, 06 Nov 2026 10:00:00 GMT';
  const host = rangeHost(() => ({ headers: { 'last-modified': modified, date: 'Fri, 06 Nov 2026 11:00:00 GMT' } }), { validators: false });
  const f = fixture(t, host);
  const d = f.add();
  await finished(f.manager);
  assertComplete(d);
  assert.ok(host.maxActive > 1);
  for (const req of host.requests.filter(req => req.range && req.end - req.start > MiB)) assert.equal(req.headers.get('if-range'), modified);
});

test('a recently modified resource without a strong ETag stays on one connection', async t => {
  const host = rangeHost(() => ({ headers: {
    'last-modified': 'Fri, 06 Nov 2026 10:00:00 GMT', date: 'Fri, 06 Nov 2026 10:00:30 GMT',
  } }), { validators: false });
  const f = fixture(t, host);
  const d = f.add();
  await finished(f.manager);
  assertComplete(d);
  assert.equal(host.maxActive, 0);
  assert.equal(d.connectionMode, 'single');
});

test('an oversized range response cannot write into the neighboring section', async t => {
  let injected = false;
  const host = rangeHost(req => {
    if (!injected && req.bounded && req.end - req.start > MiB) {
      injected = true;
      return { end: req.end + 1, headers: {
        'content-range': `bytes ${req.start}-${req.end}/${payload.length}`,
        'content-length': String(req.end - req.start + 1),
      } };
    }
  });
  const f = fixture(t, host);
  const d = f.add();
  await finished(f.manager);
  assert.ok(injected);
  assertComplete(d);
  assert.equal(d.connectionMode, 'single');
});

test('stalled parallel workers fall back before the overall transfer watchdog aborts the job', async t => {
  // Accelerate only the downloader modules' clocks; network streams and the test
  // retain real time. This exercises watchdog ordering without a minute-long wait.
  const origin = Date.now();
  class AcceleratedDate extends Date { static now() { return origin + (Date.now() - origin) * 100; } }
  const load = (filename, helper) => {
    const absolute = path.resolve(__dirname, '../src', filename);
    const nativeRequire = createRequire(absolute);
    const module = { exports: {} };
    const context = {
      module, exports: module.exports, __filename: absolute, __dirname: path.dirname(absolute),
      require: name => name === './parallel-download.cjs' && helper ? helper : nativeRequire(name),
      Date: AcceleratedDate, Buffer, AbortController, Headers, console,
      setInterval: (fn, ms) => setInterval(fn, Math.max(1, ms / 100)), clearInterval,
    };
    vm.runInNewContext(fs.readFileSync(absolute, 'utf8'), context, { filename: absolute });
    return module.exports;
  };
  const helper = load('parallel-download.cjs');
  const { DownloadManager: AcceleratedManager } = load('downloads.cjs', helper);
  const host = rangeHost(req => req.bounded && req.end - req.start > MiB ? { stall: true } : {});
  const f = fixture(t, host, {}, AcceleratedManager);
  const d = f.add();
  await finished(f.manager);
  assertComplete(d);
  assert.equal(d.connectionMode, 'single');
  assert.equal(host.active, 0);
  assert.ok(host.cancelled > 1, 'stalled requests are cancelled before fallback');
});

const assert = require('node:assert/strict');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const fs = require('node:fs');
const { spawnSync } = require('node:child_process');
const { test } = require('node:test');

const { BlazeJob } = require('../dist');

const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));

function completion(jobs) {
  return new Promise(resolve => jobs.onAllTasksEnded(resolve));
}

function listen(handler) {
  const server = http.createServer(handler);
  return new Promise(resolve => {
    server.listen(0, '127.0.0.1', () => resolve(server));
  });
}

test('runs deferred work in priority order and closes cleanly', async () => {
  const jobs = new BlazeJob({ concurrency: 1 });
  const order = [];
  const done = completion(jobs);
  const runAt = new Date(Date.now() + 75);
  jobs.schedule(async () => order.push('low'), { runAt, priority: 1, type: 'custom' });
  jobs.schedule(async () => order.push('high'), { runAt, priority: 10, type: 'custom' });

  await jobs.start();
  await done;
  assert.deepEqual(order, ['high', 'low']);
  assert.equal(jobs.getTasks().every(task => task.status === 'success'), true);
  jobs.close();
});

test('runs recurring async work up to maxRuns', async () => {
  const jobs = new BlazeJob();
  let calls = 0;
  const ended = new Promise(resolve => {
    jobs.schedule(async () => { await delay(5); calls++; }, {
      runAt: new Date(), interval: 10, maxRuns: 3, type: 'custom', onEnd: resolve
    });
  });
  await jobs.start();
  const stats = await ended;
  assert.deepEqual(stats, { runCount: 3, errorCount: 0 });
  assert.equal(calls, 3);
  jobs.close();
});

test('retries failures then records terminal errors', async () => {
  const jobs = new BlazeJob();
  let attempts = 0;
  const done = completion(jobs);
  jobs.schedule(async () => {
    attempts++;
    throw new Error(`failure ${attempts}`);
  }, { runAt: new Date(), retriesLeft: 2, type: 'custom', retry: { backoffMs: 5, jitter: 0 } });

  await jobs.start();
  await done;
  const [task] = jobs.getTasks();
  assert.equal(attempts, 3);
  assert.equal(task.status, 'failed');
  assert.equal(task.retriesLeft, 0);
  assert.equal(task.lastError, 'failure 3');
  jobs.close();
});

test('success with public result retrieval', async () => {
  const jobs = new BlazeJob();
  const id = jobs.schedule(async () => ({ hello: 'world' }), { runAt: new Date(), type: 'custom' });
  await jobs.start();
  const snap = await jobs.waitFor(id);
  assert.equal(snap.status, 'success');
  assert.deepEqual(snap.result, { hello: 'world' });
  assert.equal(jobs.getTaskResult(id).id, id);
  jobs.close();
});

test('does not retry permanent HTTP errors', async () => {
  let requests = 0;
  const server = await listen((_req, res) => {
    requests++;
    res.writeHead(400, { 'content-type': 'application/json' });
    res.end('{"error":"bad"}');
  });
  const port = server.address().port;
  const jobs = new BlazeJob();
  const id = jobs.scheduleHttp(
    { url: `http://127.0.0.1:${port}/bad`, method: 'GET' },
    { runAt: new Date(), retriesLeft: 3, retry: { backoffMs: 5, jitter: 0, policy: 'transient' } }
  );
  await jobs.start();
  const snap = await jobs.waitFor(id);
  assert.equal(snap.status, 'failed');
  assert.equal(requests, 1);
  assert.equal(snap.error.statusCode, 400);
  assert.equal(snap.error.permanent, true);
  jobs.close();
  await new Promise(r => server.close(r));
});

test('respects Retry-After on HTTP 429', async () => {
  let requests = 0;
  const server = await listen((_req, res) => {
    requests++;
    if (requests === 1) {
      res.writeHead(429, { 'Retry-After': '0' });
      res.end('slow');
      return;
    }
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end('{"ok":true}');
  });
  const port = server.address().port;
  const jobs = new BlazeJob();
  const id = jobs.scheduleHttp(
    { url: `http://127.0.0.1:${port}/rate`, method: 'GET' },
    { runAt: new Date(), retriesLeft: 2, retry: { backoffMs: 5000, jitter: 0, policy: 'transient' } }
  );
  await jobs.start();
  const snap = await jobs.waitFor(id, { timeoutMs: 3000 });
  assert.equal(snap.status, 'success');
  assert.equal(requests, 2);
  assert.deepEqual(snap.result.body, { ok: true });
  jobs.close();
  await new Promise(r => server.close(r));
});

test('HTTP timeout and cancellation against a local server', async () => {
  const server = await listen((_req, res) => {
    // hang until client disconnects
    _req.on('close', () => {});
  });
  const port = server.address().port;
  const jobs = new BlazeJob();
  const timeoutId = jobs.scheduleHttp(
    { url: `http://127.0.0.1:${port}/hang`, method: 'GET' },
    { runAt: new Date(), timeoutMs: 40, retriesLeft: 0 }
  );
  await jobs.start();
  const timed = await jobs.waitFor(timeoutId, { timeoutMs: 2000 });
  assert.equal(timed.status, 'failed');
  assert.equal(timed.error.code, 'TIMEOUT');

  const cancelId = jobs.scheduleHttp(
    { url: `http://127.0.0.1:${port}/hang`, method: 'GET' },
    { runAt: new Date(), timeoutMs: 5000, retriesLeft: 0 }
  );
  await delay(20);
  jobs.cancel(cancelId);
  const cancelled = await jobs.waitFor(cancelId, { timeoutMs: 2000 });
  assert.equal(cancelled.status, 'cancelled');
  jobs.close();
  await new Promise(r => server.close(r));
});

test('enforces process-local concurrency and rate limits', async () => {
  const jobs = new BlazeJob({ concurrency: 1, rate: { maxStarts: 2, intervalMs: 150 } });
  let active = 0;
  let maxActive = 0;
  const startedAt = [];
  const ids = [];
  for (let i = 0; i < 4; i++) {
    ids.push(jobs.schedule(async () => {
      active++;
      maxActive = Math.max(maxActive, active);
      startedAt.push(Date.now());
      await delay(40);
      active--;
    }, { runAt: new Date(), type: 'custom' }));
  }
  await jobs.start();
  await Promise.all(ids.map(id => jobs.waitFor(id)));
  assert.equal(maxActive, 1);
  const firstWindow = startedAt.filter(t => t - startedAt[0] < 140).length;
  assert.ok(firstWindow <= 2, `expected <=2 starts in window, got ${firstWindow}`);
  jobs.close();
});

test('restart with persistent named handler and JSON payload', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'blazerjob-'));
  const dbPath = path.join(directory, 'tasks.db');
  const writer = new BlazeJob({ storage: 'sqlite', dbPath });
  writer.schedule(undefined, {
    runAt: new Date(Date.now() + 20),
    handler: 'add',
    payload: { a: 2, b: 3 }
  });
  writer.close();

  const script = `
    const { BlazeJob } = require(${JSON.stringify(path.join(__dirname, '../dist'))});
    (async () => {
      const jobs = new BlazeJob({ storage: 'sqlite', dbPath: ${JSON.stringify(dbPath)} });
      jobs.registerHandler('add', async (payload) => ({ sum: payload.a + payload.b }));
      await jobs.start();
      const snap = await jobs.waitFor(1, { timeoutMs: 4000 });
      if (snap.status !== 'success' || snap.result.sum !== 5) process.exit(3);
      jobs.close();
    })().catch(() => process.exit(4));
  `;
  const result = spawnSync(process.execPath, ['-e', script], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr + result.stdout);
  fs.rmSync(directory, { recursive: true, force: true });
});

test('missing named handler does not fake success', async () => {
  const jobs = new BlazeJob();
  const id = jobs.schedule(undefined, { runAt: new Date(), handler: 'later', payload: { n: 1 } });
  await jobs.start();
  await delay(80);
  const blocked = jobs.getTask(id);
  assert.equal(blocked.status, 'blocked');
  assert.notEqual(blocked.status, 'success');
  assert.match(blocked.error.message, /later/);
  jobs.registerHandler('later', async (payload) => ({ n: payload.n * 2 }));
  const snap = await jobs.waitFor(id, { timeoutMs: 2000 });
  assert.equal(snap.status, 'success');
  assert.deepEqual(snap.result, { n: 2 });
  jobs.close();
});

test('reclaims interrupted running task when lease expired', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'blazerjob-'));
  const dbPath = path.join(directory, 'tasks.db');
  const writer = new BlazeJob({ storage: 'sqlite', dbPath, leaseMs: 50 });
  const id = writer.schedule(undefined, { runAt: new Date(), handler: 'work', payload: { ok: true } });
  writer.close();

  const Database = require('better-sqlite3');
  const db = new Database(dbPath);
  db.prepare(`UPDATE tasks SET status = 'running', lease_until = ? WHERE id = ?`).run(new Date(Date.now() - 1000).toISOString(), id);
  db.close();

  const reader = new BlazeJob({ storage: 'sqlite', dbPath, leaseMs: 50 });
  reader.registerHandler('work', async (payload) => payload);
  await reader.start();
  const snap = await reader.waitFor(id, { timeoutMs: 3000 });
  assert.equal(snap.status, 'success');
  assert.deepEqual(snap.result, { ok: true });
  reader.close();
  fs.rmSync(directory, { recursive: true, force: true });
});

test('cancels a pending task so it never starts', async () => {
  const jobs = new BlazeJob();
  let ran = 0;
  const id = jobs.schedule(async () => { ran++; }, { runAt: new Date(Date.now() + 5000), type: 'custom' });
  await jobs.start();
  assert.equal(jobs.cancel(id), true);
  await delay(80);
  assert.equal(ran, 0);
  assert.equal(jobs.getTask(id).status, 'cancelled');
  jobs.close();
});

test('shutdown waits for an active task then closes SQLite', async () => {
  const jobs = new BlazeJob();
  let finished = false;
  jobs.schedule(async () => { await delay(80); finished = true; return 1; }, { runAt: new Date(), type: 'custom' });
  await jobs.start();
  await delay(20);
  await jobs.shutdown({ timeoutMs: 2000 });
  assert.equal(finished, true);
});

test('README HTTP example actually performs the request', async () => {
  let requests = 0;
  let body = '';
  const server = await listen((req, res) => {
    requests++;
    req.on('data', c => { body += c; });
    req.on('end', () => {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end('{"ok":true}');
    });
  });
  const port = server.address().port;
  const jobs = new BlazeJob();
  const id = jobs.schedule(undefined, {
    runAt: new Date(),
    type: 'http',
    config: {
      url: `http://127.0.0.1:${port}/post`,
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: { hello: 'world' }
    }
  });
  await jobs.start();
  const snap = await jobs.waitFor(id);
  assert.equal(requests, 1);
  assert.match(body, /hello/);
  assert.equal(snap.status, 'success');
  assert.equal(snap.result.status, 200);
  jobs.close();
  await new Promise(r => server.close(r));
});

test('observer exception does not re-run a successful task', async () => {
  const jobs = new BlazeJob();
  let runs = 0;
  jobs.on('task', () => { throw new Error('observer boom'); });
  const id = jobs.schedule(async () => { runs++; return 'ok'; }, { runAt: new Date(), type: 'custom' });
  await jobs.start();
  const snap = await jobs.waitFor(id);
  await delay(50);
  assert.equal(snap.status, 'success');
  assert.equal(runs, 1);
  jobs.close();
});

test('importing the library does not install SIGINT/SIGTERM handlers', () => {
  const script = `
    const beforeI = process.listenerCount('SIGINT');
    const beforeT = process.listenerCount('SIGTERM');
    require(${JSON.stringify(path.join(__dirname, '../dist'))});
    if (process.listenerCount('SIGINT') !== beforeI) process.exit(2);
    if (process.listenerCount('SIGTERM') !== beforeT) process.exit(3);
  `;
  const result = spawnSync(process.execPath, ['-e', script], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
});

test('rejects conflicting HTTP + custom function', () => {
  const jobs = new BlazeJob();
  assert.throws(() => {
    jobs.schedule(async () => {}, { type: 'http', config: { url: 'http://127.0.0.1' } });
  }, /without a custom function/);
  jobs.close();
});

test('anonymous persisted functions cannot resume as success', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'blazerjob-'));
  const dbPath = path.join(directory, 'tasks.db');
  const writer = new BlazeJob({ storage: 'sqlite', dbPath });
  const id = writer.schedule(async () => ({ sneaky: true }), { runAt: new Date(Date.now() + 10), type: 'custom' });
  writer.close();

  const reader = new BlazeJob({ storage: 'sqlite', dbPath });
  await reader.start();
  const snap = await reader.waitFor(id, { timeoutMs: 2000 });
  assert.equal(snap.status, 'failed');
  assert.equal(snap.error.code, 'NON_RESUMABLE');
  reader.close();
  fs.rmSync(directory, { recursive: true, force: true });
});

test('executes HTTP tasks using the Node fetch API', async () => {
  let requests = 0;
  const server = await listen((_request, response) => {
    requests++;
    response.writeHead(200, { 'content-type': 'application/json' });
    response.end('{"ok":true}');
  });
  const address = server.address();
  const jobs = new BlazeJob();
  const id = jobs.schedule(undefined, {
    runAt: new Date(),
    type: 'http',
    config: { url: `http://127.0.0.1:${address.port}/task`, method: 'GET' }
  });

  await jobs.start();
  const snap = await jobs.waitFor(id);
  assert.equal(requests, 1);
  assert.equal(snap.status, 'success');
  assert.equal(snap.result.body.ok, true);
  jobs.close();
  await new Promise(resolve => server.close(resolve));
});

test('keeps persisted SQLite HTTP tasks compatible across restart', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'blazerjob-'));
  const dbPath = path.join(directory, 'tasks.db');
  const server = await listen((_request, response) => response.end('ok'));
  const address = server.address();

  const writer = new BlazeJob({ storage: 'sqlite', dbPath });
  writer.schedule(undefined, {
    runAt: new Date(Date.now() + 50),
    type: 'http',
    config: { url: `http://127.0.0.1:${address.port}/persisted`, method: 'GET' }
  });
  writer.close();

  const reader = new BlazeJob({ storage: 'sqlite', dbPath });
  await reader.start();
  for (let i = 0; i < 80 && reader.getTasks()[0].status !== 'success'; i++) await delay(25);
  assert.equal(reader.getTasks()[0].status, 'success');
  reader.close();
  await new Promise(resolve => server.close(resolve));
  fs.rmSync(directory, { recursive: true, force: true });
});

test('empty and invalid JSON HTTP bodies are handled', async () => {
  let n = 0;
  const server = await listen((_req, res) => {
    n++;
    if (n === 1) {
      res.writeHead(200);
      res.end('');
      return;
    }
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end('{not-json');
  });
  const port = server.address().port;
  const jobs = new BlazeJob();
  const a = jobs.scheduleHttp({ url: `http://127.0.0.1:${port}/a`, method: 'GET' }, { runAt: new Date() });
  await jobs.start();
  const sa = await jobs.waitFor(a);
  assert.equal(sa.result.bodyType, 'empty');
  const b = jobs.scheduleHttp({ url: `http://127.0.0.1:${port}/b`, method: 'GET' }, { runAt: new Date() });
  const sb = await jobs.waitFor(b);
  assert.equal(sb.result.bodyType, 'text');
  assert.equal(sb.result.body, '{not-json');
  jobs.close();
  await new Promise(r => server.close(r));
});

const assert = require('node:assert/strict');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const fs = require('node:fs');
const { test } = require('node:test');

const { BlazeJob } = require('../dist');

const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));

function completion(jobs) {
  return new Promise(resolve => jobs.onAllTasksEnded(resolve));
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

test('retries failures and records terminal errors', async () => {
  const jobs = new BlazeJob();
  let attempts = 0;
  const done = completion(jobs);
  jobs.schedule(async () => {
    attempts++;
    throw new Error(`failure ${attempts}`);
  }, { runAt: new Date(), retriesLeft: 2, type: 'custom' });

  await jobs.start();
  await done;
  const [task] = jobs.getTasks();
  assert.equal(attempts, 3);
  assert.equal(task.status, 'failed');
  assert.equal(task.retriesLeft, 0);
  assert.equal(task.lastError, 'failure 3');
  jobs.close();
});

test('executes HTTP tasks using the Node fetch API', async () => {
  let requests = 0;
  const server = http.createServer((request, response) => {
    requests++;
    response.writeHead(200, { 'content-type': 'application/json' });
    response.end('{"ok":true}');
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  const jobs = new BlazeJob();
  const done = completion(jobs);
  jobs.schedule(undefined, {
    runAt: new Date(),
    type: 'http',
    config: { url: `http://127.0.0.1:${address.port}/task`, method: 'GET' }
  });

  await jobs.start();
  await done;
  assert.equal(requests, 1);
  assert.equal(jobs.getTasks()[0].status, 'success');
  jobs.close();
  await new Promise(resolve => server.close(resolve));
});

test('keeps persisted SQLite HTTP tasks compatible across restart', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'blazerjob-'));
  const dbPath = path.join(directory, 'tasks.db');
  const server = http.createServer((_request, response) => response.end('ok'));
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
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
  for (let i = 0; i < 40 && reader.getTasks()[0].status !== 'success'; i++) await delay(25);
  assert.equal(reader.getTasks()[0].status, 'success');
  reader.close();
  await new Promise(resolve => server.close(resolve));
  fs.rmSync(directory, { recursive: true, force: true });
});

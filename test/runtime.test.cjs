const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const { BlazeJob } = require('../dist/index.js');

test('SQLite is opened by start and closed by stop', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'blazerjob-'));
  const dbPath = path.join(directory, 'tasks.db');
  const jobs = new BlazeJob({ storage: 'sqlite', dbPath });

  assert.equal(fs.existsSync(dbPath), false);
  assert.throws(() => jobs.getTasks(), /not started/);

  await jobs.start();
  assert.equal(fs.existsSync(dbPath), true);
  jobs.stop();
  assert.throws(() => jobs.getTasks(), /not started/);

  fs.rmSync(directory, { recursive: true, force: true });
});

test('library and server modules do not start a Fastify listener on import', () => {
  require('../dist/server.js');
  const listeningServers = process
    ._getActiveHandles()
    .filter(handle => handle && handle.constructor && handle.constructor.name === 'Server');
  assert.equal(listeningServers.length, 0);
});

import { BlazeJob } from '../index';

const jobs = new BlazeJob({ dbPath: './test_http_interval.db' });

async function main() {
await jobs.start();

jobs.schedule(undefined, {
  runAt: new Date(),
  interval: 2000, // 2s for test speed
  type: 'http',
  config: JSON.stringify({
    url: 'https://httpbin.org/get',
    method: 'GET'
  })
});

// Stop after 3 calls (simulate interval)
setTimeout(() => {
  jobs.stop();
  console.log('Test finished.');
  process.exit(0);
}, 7000);
}

main();

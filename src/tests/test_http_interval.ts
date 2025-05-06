import { BlazeJob } from '../index';

const jobs = new BlazeJob({ dbPath: './test_http_interval.db' });

let callCount = 0;

jobs.schedule(async () => {}, {
  runAt: new Date(),
  interval: 2000, // 2s for test speed
  type: 'http',
  config: JSON.stringify({
    url: 'https://httpbin.org/get',
    method: 'GET'
  })
});

jobs.start();

// Stop after 3 calls (simulate interval)
setTimeout(() => {
  jobs.stop();
  console.log('Test finished.');
  process.exit(0);
}, 7000);

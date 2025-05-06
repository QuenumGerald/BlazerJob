import { BlazeJob } from '../index';

const jobs = new BlazeJob({ dbPath: './tasks_http.db' });
jobs.schedule(async () => {}, {
  runAt: new Date(Date.now() + 1000),
  type: 'http',
  config: JSON.stringify({
    url: 'https://httpbin.org/post',
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ message: 'Hello BlazeJob!' })
  })
});
jobs.start();

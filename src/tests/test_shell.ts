import { BlazeJob } from '../index';

const jobs = new BlazeJob({ dbPath: './tasks_shell.db' });
jobs.schedule(async () => {}, {
  runAt: new Date(Date.now() + 1000),
  type: 'shell',
  config: JSON.stringify({ cmd: 'echo Hello BlazeJob!' })
});
jobs.start();

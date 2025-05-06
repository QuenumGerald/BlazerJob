import { BlazeJob } from '../index';

const jobs = new BlazeJob({ dbPath: './test_http_retry_prio.db', autoExit: true });

jobs.schedule(async () => { }, {
  runAt: new Date(),
  interval: 2000,
  type: 'http',
  config: JSON.stringify({
    url: 'https://httpbin.org/status/503',
    method: 'GET'
  }),
  retriesLeft: 1,
  priority: 10,
  maxRuns: 3,
  maxDurationMs: 7000,
  onEnd: (stats: { runCount: number, errorCount: number }) => {
    console.log(`Résumé : exécutions = ${stats.runCount}, erreurs = ${stats.errorCount}`);
  }
});

jobs.start();

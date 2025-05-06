import { BlazeJob } from '../index';

const jobs = new BlazeJob({ dbPath: './tasks_fintech.db' });
jobs.schedule(async () => {}, {
  runAt: new Date(Date.now() + 1000),
  type: 'fintech',
  config: JSON.stringify({
    provider: 'demo',
    action: 'create_invoice',
    data: { customerId: '123', amount: 100, currency: 'EUR' }
  })
});
jobs.start();

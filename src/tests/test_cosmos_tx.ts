import { BlazeJob } from '../index';

const jobs = new BlazeJob({ dbPath: './tasks_cosmos_tx.db' });
jobs.schedule(undefined, {
  runAt: new Date(Date.now() + 1000),
  type: 'cosmos',
  config: JSON.stringify({
    to: 'cosmos1destination...',
    amount: '100000',
    denom: 'uatom',
    chainId: 'cosmoshub-4'
  })
});
jobs.start();

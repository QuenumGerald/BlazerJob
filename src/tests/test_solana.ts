import { BlazeJob } from '../index';

const jobs = new BlazeJob({ dbPath: './tasks_solana.db' });
jobs.schedule(async () => {}, {
  runAt: new Date(Date.now() + 1000),
  type: 'solana',
  config: JSON.stringify({
    to: 'AdresseSolanaDestinataire',
    lamports: 1000000 // 0.001 SOL
  })
});
jobs.start();

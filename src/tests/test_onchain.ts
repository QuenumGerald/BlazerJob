import { BlazeJob } from '../index';

const jobs = new BlazeJob({ dbPath: './tasks_onchain.db' });
jobs.schedule(async () => {}, {
  runAt: new Date(Date.now() + 1000),
  type: 'onchain',
  config: JSON.stringify({
    to: '0xAdresseDestinataire',
    value: '0.001'
    // privateKey et rpcUrl lus dans .env
  })
});
jobs.start();

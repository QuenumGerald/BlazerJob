import { BlazeJob } from '../index';

const jobs = new BlazeJob({ dbPath: './tasks_email.db' });
jobs.schedule(async () => {}, {
  runAt: new Date(Date.now() + 1000),
  type: 'email',
  config: JSON.stringify({
    to: 'destinataire@exemple.com',
    subject: 'Test BlazeJob',
    text: 'Ceci est un test.'
  })
});
jobs.start();

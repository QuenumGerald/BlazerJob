import { BlazeJob } from '../index';
import * as fs from 'fs';

console.log('Test Cosmos query démarré');

const jobs = new BlazeJob({ dbPath: './tasks_cosmos_query.db' });
jobs.schedule(async () => { }, {
  runAt: new Date(), // Exécution immédiate
  type: 'cosmos',
  config: JSON.stringify({
    queryType: 'balance',
    queryParams: { address: 'cosmos1fl48vsnmsdzcv85q5d2q4z5ajdha8yu34mf0eh' }
  })
});
console.log('Tâche Cosmos programmée');
console.log('Vérification immédiate de la base...');
if (fs.existsSync('./tasks_cosmos_query.db')) {
  console.log('Base SQLite créée');
} else {
  console.log('Base SQLite NON créée');
}

(async () => {
  await jobs.start();
  // Attendre 5 secondes pour laisser la tâche Cosmos s'exécuter et logger le résultat
  await new Promise(resolve => setTimeout(resolve, 5000));
  process.exit(0);
})();

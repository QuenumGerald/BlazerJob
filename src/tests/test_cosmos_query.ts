import { BlazeJob } from '../index';
import { scheduleManyCosmosQueries } from '../cosmos';

const job = new BlazeJob({ dbPath: './tasks_cosmos_query.db' });

(async () => {
  console.log('Test Cosmos multi-query démarré');
  await scheduleManyCosmosQueries(job, {
    addresses: [
      'cosmos1fl48vsnmsdzcv85q5d2q4z5ajdha8yu34mf0eh',
      'cosmos1c9ye9j3p4e9w8f7j2k7l6k8e8f7g9h5d3j8k7h',
      // Ajoute ici d'autres adresses si besoin
    ],
    count: 100,
    queryType: 'balance',
    intervalMs: 100,
    // Autres options possibles: retriesLeft, priority, configOverrides, runAt, webhookUrl
  });
  job.start();
})();

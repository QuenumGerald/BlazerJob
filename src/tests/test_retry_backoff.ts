import { BlazeJob } from '../index';
import * as fs from 'fs';

const dbPath = 'test_retry_backoff.db';

// Nettoyer la base avant le test
if (fs.existsSync(dbPath)) {
  fs.unlinkSync(dbPath);
}

const jobs = new BlazeJob({
  dbPath,
  autoExit: true,
  concurrency: 1
});

let attemptCount = 0;
const maxAttempts = 3;
const startTime = Date.now();

// Tâche qui échoue 2 fois, puis réussit
const taskId = jobs.schedule(async () => {
  attemptCount++;
  const elapsed = Date.now() - startTime;

  console.log(`[Test] Tentative ${attemptCount} à ${elapsed}ms`);

  if (attemptCount < maxAttempts) {
    throw new Error(`Échec simulé - tentative ${attemptCount}/${maxAttempts}`);
  }

  console.log(`[Test] Succès après ${attemptCount} tentatives !`);
}, {
  runAt: new Date(),
  retriesLeft: 3,
  priority: 1,
  type: 'custom',
  onEnd: (stats: { runCount: number, errorCount: number }) => {
    console.log('[Test] Statistiques finales:', stats);
    console.log(`[Test] Nombre total de tentatives: ${attemptCount}`);

    // Vérifications
    if (attemptCount === maxAttempts) {
      console.log('✅ Test réussi : La tâche a été réessayée le bon nombre de fois');
    } else {
      console.error(`❌ Test échoué : Attendu ${maxAttempts} tentatives, obtenu ${attemptCount}`);
    }

    if (stats.errorCount === maxAttempts - 1) {
      console.log('✅ Test réussi : Le compteur d\'erreurs est correct');
    } else {
      console.error(`❌ Test échoué : Attendu ${maxAttempts - 1} erreurs, obtenu ${stats.errorCount}`);
    }

    if (stats.runCount === 1) {
      console.log('✅ Test réussi : La tâche a réussi une fois');
    } else {
      console.error(`❌ Test échoué : Attendu 1 run réussi, obtenu ${stats.runCount}`);
    }
  }
});

console.log(`[Test] Tâche créée avec ID: ${taskId}`);
console.log('[Test] Configuration:');
console.log('  - retriesLeft: 3');
console.log('  - Backoff exponentiel attendu: 1s, 2s');
console.log('  - Nombre de tentatives attendu: 3 (2 échecs + 1 succès)');

jobs.start();

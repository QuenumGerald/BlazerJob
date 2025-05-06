import { BlazeJob } from '../index';

// Initialize BlazeJob with a test database
const jobs = new BlazeJob({ dbPath: './custom_retry_test.db' });

// Exemple minimal de tâche custom avec juste un console.log
const taskId = jobs.schedule(
  async () => {
    console.log('[CUSTOM] Hello from my custom BlazeJob task!');
    // Pour tester le retry, décommente la ligne suivante :
    // throw new Error('Erreur custom');
  },
  {
    runAt: new Date(Date.now()), // dans 1 seconde
    interval: 1,
    retriesLeft: 2, // Essaie 3 fois au total si erreur
    type: 'custom',
    config: { foo: 'bar' },
    maxRuns: 10,
    onEnd: ({ runCount, errorCount }: { runCount: number; errorCount: number }) => {
      console.log('[CUSTOM][onEnd] runCount:', runCount, 'errorCount:', errorCount);
      process.exit(0); // Pour arrêter le test proprement
    }
  }
);
jobs.start();
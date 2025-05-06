import { BlazeJob } from '../index';

// Initialize BlazeJob with a test database
const jobs = new BlazeJob({ dbPath: './custom_retry_test.db' });

// Fonction pour simuler une requête API
async function simulateApiCall(attempt: number): Promise<boolean> {
  // Simuler un délai aléatoire entre 100ms et 500ms
  const delay = Math.floor(Math.random() * 400) + 100;
  await new Promise(resolve => setTimeout(resolve, delay));

  // 10% de chance de réussite (pour bien tester les retries)
  const randomValue = Math.random();
  const success = randomValue > 0.9;
  console.log(`Random value: ${randomValue.toFixed(4)}, success: ${success}`);

  if (!success) {
    console.log(`[Attempt ${attempt}] API call failed after ${delay}ms`);
    throw new Error(`API request failed (attempt ${attempt})`);
  }

  console.log(`[Attempt ${attempt}] API call succeeded after ${delay}ms`);
  return true;
}

// Planifier une tâche qui va simuler des appels API
const taskId = jobs.schedule(
  async () => {
    // Cette fonction est appelée par BlazeJob
    const task = jobs['db'].prepare('SELECT * FROM tasks WHERE id = ?').get(1);
    const config = typeof task.config === 'string' ? JSON.parse(task.config) : task.config || {};

    // Initialiser ou incrémenter le compteur de tentatives
    config.attempt = (config.attempt || 0) + 1;
    console.log(`\n[Attempt ${config.attempt}] Executing API call...`);

    try {
      // Simuler l'appel API (avec 90% de chance d'échec)
      await simulateApiCall(config.attempt);

      // Si on arrive ici, l'appel a réussi
      console.log('✅ Task completed successfully!');

      // Afficher l'état final des tâches
      const tasks = jobs['db'].prepare('SELECT id, status, retriesLeft, lastError FROM tasks').all();
      console.log('📋 Tasks status:', tasks);

      // Arrêter le processus après succès
      process.exit(0);
    } catch (error) {
      console.error(`❌ Error on attempt ${config.attempt}:`, error);

      // Mettre à jour le compteur de tentatives dans la config
      jobs['db'].prepare('UPDATE tasks SET config = ? WHERE id = ?').run(
        JSON.stringify(config),
        task.id
      );

      // Relancer l'erreur pour que BlazeJob gère le retry
      throw error;
    }
  },
  {
    type: 'api_test', // Type personnalisé pour notre test
    runAt: new Date(Date.now() + 1000), // Démarrer dans 1 seconde
    retriesLeft: 5, // 5 tentatives maximum
    interval: 1000, // 1 seconde entre chaque tentative
    config: {
      description: 'Simulation d\'appel API avec échecs aléatoires',
      maxAttempts: 6, // 6 tentatives au total (1 + 5 retries)
      attempt: 0 // Compteur de tentatives
    }
  }
);

console.log(`\n🔹 Scheduled task with ID: ${taskId}`);
console.log('🚀 Starting job processor... (Press Ctrl+C to stop)');
jobs.start();

// Gérer l'arrêt du processus
process.on('SIGINT', async () => {
  console.log('\n🛑 Shutting down...');
  await jobs.stop();

  // Afficher l'état final des tâches
  const tasks = jobs['db'].prepare('SELECT id, status, retriesLeft, lastError FROM tasks').all();
  console.log('📋 Final tasks status:', tasks);

  process.exit(0);
});

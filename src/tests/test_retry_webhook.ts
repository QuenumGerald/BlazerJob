import { BlazeJob } from '../index';
import * as fs from 'fs';
import Fastify from 'fastify';

const dbPath = 'test_retry_webhook.db';

if (fs.existsSync(dbPath)) {
    fs.unlinkSync(dbPath);
}

const webhookServer = Fastify({ logger: false });
const webhookEvents: any[] = [];

webhookServer.post('/webhook', async (request, reply) => {
    const payload = request.body;
    console.log('[Webhook reçu]', JSON.stringify(payload, null, 2));
    webhookEvents.push(payload);
    reply.send({ received: true });
});

(async () => {
    await webhookServer.listen({ port: 9999 });
    console.log('Serveur webhook en écoute sur http://localhost:9999');

    const jobs = new BlazeJob({
        dbPath,
        autoExit: true,
        concurrency: 1
    });

    let attemptCount = 0;

    console.log('\n=== Test webhook sur retry ===\n');
    console.log('La tâche va échouer 2 fois avant de réussir');
    console.log('Vous devriez voir 3 webhooks :');
    console.log('  1. result: "retry" (après 1ère erreur)');
    console.log('  2. result: "retry" (après 2ème erreur)');
    console.log('  3. result: "success" (succès final)\n');

    jobs.schedule(async () => {
        attemptCount++;
        console.log(`[Task] Tentative ${attemptCount}`);

        if (attemptCount < 3) {
            throw new Error(`Échec simulé - tentative ${attemptCount}`);
        }

        console.log('[Task] ✅ Succès !');
    }, {
        runAt: new Date(),
        retriesLeft: 3,
        type: 'custom',
        webhookUrl: 'http://localhost:9999/webhook',
        retryConfig: {
            strategy: 'fixed',
            delayMs: 500
        },
        onEnd: (stats: { runCount: number, errorCount: number }) => {
            console.log('\n=== Résumé ===');
            console.log('Stats:', stats);
            console.log('Nombre total de webhooks reçus:', webhookEvents.length);

            console.log('\nDétails des webhooks:');
            webhookEvents.forEach((event, index) => {
                console.log(`  ${index + 1}. result="${event.result}", status="${event.status}", error="${event.error || 'none'}"`);
            });

            setTimeout(async () => {
                await webhookServer.close();
                console.log('\nServeur webhook arrêté');
            }, 500);
        }
    });

    jobs.start();
})();

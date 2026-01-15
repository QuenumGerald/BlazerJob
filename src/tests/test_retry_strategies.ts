import { BlazeJob } from '../index';
import * as fs from 'fs';

const dbPath = 'test_retry_strategies.db';

if (fs.existsSync(dbPath)) {
    fs.unlinkSync(dbPath);
}

const jobs = new BlazeJob({
    dbPath,
    autoExit: true,
    concurrency: 3
});

let attemptCountExponential = 0;
let attemptCountLinear = 0;
let attemptCountFixed = 0;

console.log('=== Test des différentes stratégies de retry ===\n');

console.log('1. Test stratégie EXPONENTIAL (1s, 2s, 4s)');
jobs.schedule(async () => {
    attemptCountExponential++;
    console.log(`[Exponential] Tentative ${attemptCountExponential} à ${Date.now()}`);
    if (attemptCountExponential < 3) {
        throw new Error('Échec simulé exponential');
    }
    console.log('[Exponential] ✅ Succès après 3 tentatives');
}, {
    runAt: new Date(),
    retriesLeft: 3,
    type: 'custom',
    retryConfig: {
        strategy: 'exponential',
        delayMs: 1000,
        maxDelayMs: 30000
    },
    onEnd: (stats: { runCount: number, errorCount: number }) => {
        console.log('[Exponential] Stats finales:', stats);
    }
});

console.log('2. Test stratégie LINEAR (2s, 4s, 6s)');
jobs.schedule(async () => {
    attemptCountLinear++;
    console.log(`[Linear] Tentative ${attemptCountLinear} à ${Date.now()}`);
    if (attemptCountLinear < 3) {
        throw new Error('Échec simulé linear');
    }
    console.log('[Linear] ✅ Succès après 3 tentatives');
}, {
    runAt: new Date(),
    retriesLeft: 3,
    type: 'custom',
    retryConfig: {
        strategy: 'linear',
        delayMs: 2000,
        maxDelayMs: 30000
    },
    onEnd: (stats: { runCount: number, errorCount: number }) => {
        console.log('[Linear] Stats finales:', stats);
    }
});

console.log('3. Test stratégie FIXED (1.5s entre chaque retry)');
jobs.schedule(async () => {
    attemptCountFixed++;
    console.log(`[Fixed] Tentative ${attemptCountFixed} à ${Date.now()}`);
    if (attemptCountFixed < 3) {
        throw new Error('Échec simulé fixed');
    }
    console.log('[Fixed] ✅ Succès après 3 tentatives');
}, {
    runAt: new Date(),
    retriesLeft: 3,
    type: 'custom',
    retryConfig: {
        strategy: 'fixed',
        delayMs: 1500,
        maxDelayMs: 30000
    },
    onEnd: (stats: { runCount: number, errorCount: number }) => {
        console.log('[Fixed] Stats finales:', stats);
    }
});

console.log('\n=== Démarrage des tests ===\n');
jobs.start();

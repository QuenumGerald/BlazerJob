"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const index_1 = require("../src/index");
const TOTAL_TASKS = Number(process.env.BENCH_TASKS || 500);
const CONCURRENCY = Number(process.env.BENCH_CONCURRENCY || 16);
const TASK_DURATION_MS = Number(process.env.BENCH_TASK_MS || 50);
const DB_PATH = process.env.BENCH_DB || 'bench.db';
const delay = (ms) => new Promise((res) => setTimeout(res, ms));
(async () => {
    const runner = new index_1.BlazeJob({ dbPath: DB_PATH, concurrency: CONCURRENCY });
    let completed = 0;
    const startedAt = Date.now();
    const markDone = () => {
        completed += 1;
        if (completed === TOTAL_TASKS) {
            const durationSec = (Date.now() - startedAt) / 1000;
            const rate = TOTAL_TASKS / durationSec;
            console.log(`Done: ${TOTAL_TASKS} tasks in ${durationSec.toFixed(3)}s -> ${rate.toFixed(1)} tasks/s (conc=${CONCURRENCY}, task=${TASK_DURATION_MS}ms)`);
            runner.stop();
            process.exit(0);
        }
    };
    for (let i = 0; i < TOTAL_TASKS; i++) {
        runner.schedule(async () => {
            await delay(TASK_DURATION_MS);
            markDone();
        }, {
            type: 'http',
            runAt: new Date(),
            priority: 0,
            retriesLeft: 0,
            config: {}
        });
    }
    await runner.start();
})();

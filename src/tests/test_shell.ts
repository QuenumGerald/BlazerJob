import { BlazeJob } from '../index';

const jobs = new BlazeJob({ dbPath: './test_shell.db' });

jobs.schedule(undefined, {
    runAt: new Date(),
    type: 'shell',
    config: {
        cmd: 'echo "Hello from shell!" && date'
    }
});

jobs.start();

setTimeout(() => {
    jobs.stop();
    console.log('Test shell finished.');
    process.exit(0);
}, 3000);

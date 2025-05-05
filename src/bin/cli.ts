#!/usr/bin/env node
import { BlazeJob } from '../index';
import * as path from 'path';

const dbPath = path.resolve(process.cwd(), 'blazerjob.db');
const jobs = new BlazeJob({ dbPath });

function printHelp() {
  console.log(`Usage: blazerjob <command> [options]\n\nCommands:\n  schedule   Schedule a new task\n  list       List all tasks\n  delete     Delete a task by id\n  help       Show this help message\n`);
}

async function main() {
  const [,, cmd, ...args] = process.argv;
  switch (cmd) {
    case 'schedule': {
      // Minimal CLI: blazerjob schedule --type shell --cmd "echo hello" --runAt "2025-01-01T00:00:00Z"
      const opts: any = {};
      for (let i = 0; i < args.length; i++) {
        if (args[i].startsWith('--')) {
          opts[args[i].slice(2)] = args[i+1];
          i++;
        }
      }
      if (!opts.type) {
        console.error('Missing --type');
        return process.exit(1);
      }
      let config: any = undefined;
      if (opts.type === 'shell' && opts.cmd) {
        config = { cmd: opts.cmd };
      }
      const runAt = opts.runAt || new Date().toISOString();
      const interval = opts.interval ? Number(opts.interval) : undefined;
      const priority = opts.priority ? Number(opts.priority) : undefined;
      const retriesLeft = opts.retriesLeft ? Number(opts.retriesLeft) : undefined;
      const taskFn = async () => {};
      const id = jobs.schedule(taskFn, { runAt, interval, priority, retriesLeft, type: opts.type, config });
      console.log(`Task scheduled with id: ${id}`);
      break;
    }
    case 'list': {
      const tasks = jobs['db'].prepare('SELECT * FROM tasks').all();
      console.table(tasks);
      break;
    }
    case 'delete': {
      const id = args[0];
      if (!id) {
        console.error('Please provide the task id to delete.');
        return process.exit(1);
      }
      jobs['db'].prepare('DELETE FROM tasks WHERE id = ?').run(id);
      jobs['taskMap'].delete(Number(id));
      console.log(`Task ${id} deleted.`);
      break;
    }
    case 'help':
    default:
      printHelp();
  }
}

main();

#!/usr/bin/env node
import { BlazeJob } from '../blaze-job';
import * as path from 'path';
import * as fs from 'fs';

async function listAllTasks() {
  const dbFiles = fs.readdirSync('.').filter(file => file.endsWith('.db'));
  for (const dbFile of dbFiles) {
    console.log(`\n=== Database: ${dbFile} ===`);
    try {
      const jobs = new BlazeJob({ storage: 'sqlite', dbPath: path.resolve(process.cwd(), dbFile) });
      const allTasks = jobs.getTasks();
      const tasks = allTasks
        .sort((a, b) => new Date(b.runAt).getTime() - new Date(a.runAt).getTime())
        .map(({ id, type, status, runAt, lastError }) => ({ id, type, status, runAt, lastError }));
      console.table(tasks);
      jobs.close();
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Unknown error';
      console.error(`Error with ${dbFile}:`, errorMessage);
    }
  }
}

async function main() {
  const [, , cmd, ...args] = process.argv;

  if (cmd === 'list-all') {
    await listAllTasks();
    return;
  }

  const dbPath = path.resolve(process.cwd(), 'blazerjob.db');
  const jobs = new BlazeJob({ storage: 'sqlite', dbPath });

  switch (cmd) {
    case 'schedule': {
      const opts: Record<string, string> = {};
      for (let i = 0; i < args.length; i++) {
        if (args[i].startsWith('--')) {
          opts[args[i].slice(2)] = args[i + 1];
          i++;
        }
      }
      if (!opts.type) {
        console.error('Missing --type');
        jobs.close();
        return process.exit(1);
      }
      let config: unknown = undefined;
      if (opts.type === 'http' && opts.url) {
        config = { url: opts.url, method: opts.method || 'GET' };
      }
      const runAt = opts.runAt || new Date().toISOString();
      const interval = opts.interval ? Number(opts.interval) : undefined;
      const priority = opts.priority ? Number(opts.priority) : undefined;
      const retriesLeft = opts.retriesLeft ? Number(opts.retriesLeft) : undefined;
      const webhookUrl = opts.webhookUrl;
      const id = jobs.schedule(undefined, { runAt, interval, priority, retriesLeft, type: opts.type, config, webhookUrl, handler: opts.handler, payload: opts.payload ? JSON.parse(opts.payload) : undefined });
      console.log(`Task scheduled with id: ${id}`);
      break;
    }
    case 'list': {
      const tasks = jobs.getTasks();
      console.table(tasks.map(({ id, type, status, runAt, lastError }) => ({ id, type, status, runAt, lastError })));
      break;
    }
    case 'delete': {
      const id = args[0];
      if (!id) {
        console.error('Please provide the task id to delete.');
        jobs.close();
        return process.exit(1);
      }
      jobs.deleteTask(Number(id));
      console.log(`Task ${id} deleted.`);
      break;
    }
    case 'help':
    default:
      console.log(`Usage: blazerjob <command> [options]\n\nCommands:\n  schedule   Schedule a new task\n  list       List tasks in blazerjob.db\n  list-all   List tasks from all .db files\n  delete     Delete a task by id\n  help       Show this help message\n`);
  }
  jobs.close();
}

function installCliSignals() {
  const halt = async () => {
    process.exit(0);
  };
  process.on('SIGTERM', halt);
  process.on('SIGINT', halt);
}

if (require.main === module) {
  installCliSignals();
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}

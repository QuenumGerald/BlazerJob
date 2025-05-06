#!/usr/bin/env node
import { BlazeJob } from '../index';
import * as path from 'path';
import * as fs from 'fs';

// Cherche tous les fichiers .db dans le répertoire courant
const dbFiles = fs.readdirSync('.').filter(file => file.endsWith('.db'));

// Affiche toutes les tâches de toutes les bases de données
async function listAllTasks() {
  for (const dbFile of dbFiles) {
    console.log(`\n=== Base de données : ${dbFile} ===`);
    try {
      const jobs = new BlazeJob({ dbPath: path.resolve(process.cwd(), dbFile) });
      const tasks = jobs['db'].prepare('SELECT id, type, status, runAt, lastError, config FROM tasks ORDER BY runAt DESC').all();
      console.table(tasks);
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

  // Logique existante...
  const dbPath = path.resolve(process.cwd(), 'blazerjob.db');
  const jobs = new BlazeJob({ dbPath });

  switch (cmd) {
    case 'schedule': {
      // Minimal CLI: blazerjob schedule --type shell --cmd "echo hello" --runAt "2025-01-01T00:00:00Z"
      const opts: any = {};
      for (let i = 0; i < args.length; i++) {
        if (args[i].startsWith('--')) {
          opts[args[i].slice(2)] = args[i + 1];
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
      const webhookUrl = opts.webhookUrl;
      const taskFn = async () => { };
      const id = jobs.schedule(taskFn, { runAt, interval, priority, retriesLeft, type: opts.type, config, webhookUrl });
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
      console.log(`Task ${id} deleted.`);
      break;
    }
    case 'help':
    default:
      console.log(`Usage: blazerjob <command> [options]\n\nCommands:\n  schedule   Schedule a new task\n  list       List tasks in blazerjob.db\n  list-all   List tasks from all .db files\n  delete     Delete a task by id\n  help       Show this help message\n`);
  }
}

main().catch(console.error);

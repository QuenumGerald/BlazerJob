import * as dotenv from 'dotenv';
import Fastify, { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import formbody from '@fastify/formbody';
import { BlazeJob } from './index';
import { HttpTaskConfig } from './types';
import { makeHttpTaskFn } from './http/queries';

let app: FastifyInstance | undefined;
let jobs: BlazeJob | undefined;

export async function startServer(port = 9000): Promise<void> {
  if (app) return;

  dotenv.config();
  const nextApp = Fastify({ logger: true });
  const nextJobs = new BlazeJob({ storage: 'memory' });
  nextApp.register(formbody);

  nextApp.get('/tasks', async (_request: FastifyRequest, reply: FastifyReply) => {
    reply.send(nextJobs.getTasks());
  });

  nextApp.post('/task', async (request: FastifyRequest, reply: FastifyReply) => {
    const options = (request.body as any) ?? {};
    let taskFn: () => Promise<void> = async () => {
      console.log('Task executed:', { type: options.type, config: options.config });
    };
    if (options.type === 'http' && options.config) {
      const config = typeof options.config === 'string'
        ? JSON.parse(options.config) as HttpTaskConfig
        : options.config as HttpTaskConfig;
      taskFn = makeHttpTaskFn(config);
    }
    const taskId = nextJobs.schedule(taskFn, options);
    reply.code(201).send({ id: taskId });
  });

  nextApp.delete('/task/:id', async (request: FastifyRequest, reply: FastifyReply) => {
    const { id } = request.params as { id: string };
    nextJobs.deleteTask(Number.parseInt(id, 10));
    reply.code(204).send();
  });

  try {
    await nextJobs.start();
    await nextApp.listen({ port });
    jobs = nextJobs;
    app = nextApp;
  } catch (error) {
    nextJobs.close();
    await nextApp.close();
    throw error;
  }
}

export async function stopServer(): Promise<void> {
  const currentApp = app;
  const currentJobs = jobs;
  app = undefined;
  jobs = undefined;
  if (currentApp) await currentApp.close();
  currentJobs?.close();
}

if (require.main === module) {
  const stopAndExit = async () => {
    await stopServer();
    process.exit(0);
  };
  process.once('SIGTERM', stopAndExit);
  process.once('SIGINT', stopAndExit);
  startServer(Number(process.env.PORT) || 9000).catch(error => {
    console.error(error);
    process.exit(1);
  });
}

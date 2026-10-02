import Fastify, { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import formbody from '@fastify/formbody';
import { BlazeJob } from './blaze-job';

let app: FastifyInstance | null = null;
let jobs: BlazeJob | null = null;

function redactTask(task: any) {
  const copy = { ...task };
  if (copy.config && typeof copy.config === 'object') {
    const cfg = { ...copy.config };
    if (cfg.headers) {
      const headers = { ...cfg.headers };
      for (const key of Object.keys(headers)) {
        if (key.toLowerCase() === 'authorization' || key.toLowerCase() === 'cookie') {
          headers[key] = '[redacted]';
        }
      }
      cfg.headers = headers;
    }
    if (cfg.body) cfg.body = '[omitted]';
    copy.config = cfg;
  }
  if (copy.result && typeof copy.result === 'object' && copy.result.body) {
    copy.result = { ...copy.result, body: '[omitted]' };
  }
  return copy;
}

export async function startServer(port: number = 9000, options: { storage?: 'memory' | 'sqlite'; dbPath?: string } = {}) {
  app = Fastify({ logger: true });
  await app.register(formbody);
  jobs = new BlazeJob({ storage: options.storage ?? 'memory', dbPath: options.dbPath });

  app.get('/tasks', async (_request: FastifyRequest, reply: FastifyReply) => {
    reply.send(jobs!.getTasks().map(redactTask));
  });

  app.post('/task', async (request: FastifyRequest, reply: FastifyReply) => {
    const body = (request.body as any) ?? {};
    const { runAt, interval, priority, retriesLeft, type, config, webhookUrl, maxRuns, maxDurationMs, handler, payload } = body;
    if (type === 'http' && config) {
      const taskId = jobs!.schedule(undefined, { runAt, interval, priority, retriesLeft, type, config, webhookUrl, maxRuns, maxDurationMs });
      reply.code(201).send({ id: taskId });
      return;
    }
    if (handler) {
      const taskId = jobs!.schedule(undefined, { runAt, interval, priority, retriesLeft, type: type || 'custom', webhookUrl, maxRuns, maxDurationMs, handler, payload });
      reply.code(201).send({ id: taskId });
      return;
    }
    reply.code(400).send({ error: 'Standalone server cannot accept anonymous functions. Use type=http with config, or a named handler registered in-process.' });
  });

  app.post('/task/:id/cancel', async (request: FastifyRequest, reply: FastifyReply) => {
    const { id } = request.params as { id: string };
    const ok = jobs!.cancel(Number(id));
    reply.code(ok ? 200 : 404).send({ cancelled: ok });
  });

  app.delete('/task/:id', async (request: FastifyRequest, reply: FastifyReply) => {
    const { id } = request.params as { id: string };
    jobs!.deleteTask(parseInt(id, 10));
    reply.code(204).send();
  });

  await jobs.start();
  await app.listen({ port, host: '127.0.0.1' });
}

export async function stopServer() {
  if (app) await app.close();
  if (jobs) await jobs.shutdown({ timeoutMs: 5_000 });
  app = null;
  jobs = null;
}

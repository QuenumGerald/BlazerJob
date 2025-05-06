import { BlazeJob } from '../index';
import { CosmosBatchOptions } from './types';

/**
 * Programme facilement un grand nombre de requêtes Cosmos sur une liste d'adresses.
 * Les adresses sont utilisées en round-robin.
 */
export async function scheduleManyCosmosQueries(job: BlazeJob, opts: CosmosBatchOptions) {
  const {
    addresses,
    count,
    queryType,
    intervalMs = 100,
    configOverrides = {},
    retriesLeft = 0,
    priority = 0,
    runAt,
    webhookUrl
  } = opts;
  if (!addresses || addresses.length === 0) throw new Error('addresses must be a non-empty array');
  for (let i = 0; i < count; i++) {
    const address = addresses[i % addresses.length];
    const scheduledAt = runAt
      ? (runAt instanceof Date ? new Date(runAt.getTime() + i * intervalMs) : new Date(new Date(runAt).getTime() + i * intervalMs))
      : new Date(Date.now() + i * intervalMs);
    job.schedule(async () => {}, {
      type: 'cosmos',
      runAt: scheduledAt,
      priority,
      retriesLeft,
      webhookUrl,
      config: {
        queryType,
        queryParams: { address },
        ...configOverrides
      }
    });
  }
}

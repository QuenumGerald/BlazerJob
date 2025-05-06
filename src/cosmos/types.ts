export interface CosmosBatchOptions {
  addresses: string[];
  count: number;
  queryType: string;
  intervalMs?: number;
  configOverrides?: Record<string, any>;
  retriesLeft?: number;
  priority?: number;
  runAt?: Date | string;
  webhookUrl?: string;
}

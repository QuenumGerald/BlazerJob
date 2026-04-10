// TaskConfig interface for all supported types
export type TaskType = 'http';

export interface HttpTaskConfig {
  url: string;
  method?: string;
  headers?: Record<string, string>;
  body?: any;
}

export type TaskConfig = HttpTaskConfig;

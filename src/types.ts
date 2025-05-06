// TaskConfig interface for all supported types
export type TaskType = 'fintech' | 'onchain' | 'solana' | 'cosmos' | 'shell' | 'http' | 'email';

export interface ShellTaskConfig {
  cmd: string;
}

export interface HttpTaskConfig {
  url: string;
  method?: string;
  headers?: Record<string, string>;
  body?: any;
}

export interface OnchainTaskConfig {
  rpcUrl?: string;
  privateKey?: string;
  to: string;
  value: string; // in ETH or wei
  data?: string;
  gasLimit?: number;
}

export interface SolanaTaskConfig {
  rpcUrl?: string;
  secretKey?: string; // base58 or Uint8Array as string
  to: string;
  lamports: number; // amount in lamports
  memo?: string;
}

export interface EmailTaskConfig {
  to: string;
  subject: string;
  text?: string;
  html?: string;
  from?: string;
  smtpHost?: string;
  smtpPort?: number;
  smtpUser?: string;
  smtpPass?: string;
}

export interface FintechTaskConfig {
  provider: string;
  amount: number;
  currency: string;
  recipient: string;
  [key: string]: any;
}

export interface CosmosTaskConfig {
  rpcUrl?: string;
  mnemonic?: string;
  to: string;
  amount: string; // en uatom, uosmo, etc.
  denom: string;
  chainId: string;
  gas?: string;
  memo?: string;
  // Pour query : queryType et params
  queryType?: 'balance' | 'tx' | 'custom';
  queryParams?: Record<string, any>;
}

export type TaskConfig =
  | ShellTaskConfig
  | HttpTaskConfig
  | OnchainTaskConfig
  | SolanaTaskConfig
  | EmailTaskConfig
  | CosmosTaskConfig
  | FintechTaskConfig;

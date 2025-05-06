export function getCosmosConfig(cfg: any = {}): { rpcUrl: string; mnemonic?: string } {
  const rpcUrl = cfg.rpcUrl || process.env.COSMOS_RPC_URL;
  const mnemonic = cfg.mnemonic || process.env.COSMOS_MNEMONIC;
  if (!rpcUrl) throw new Error('No Cosmos rpcUrl (set in config or .env)');
  return { rpcUrl, mnemonic };
}

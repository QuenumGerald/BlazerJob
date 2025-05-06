import { getStargateClient, getSigningClientAndWallet } from './client';

/**
 * Fabrique une fonction de tâche Cosmos pour BlazeJob (queryType, queryParams...)
 */
export function makeCosmosTaskFn(cfg: any) {
  return async () => {
    const { queryType, queryParams } = cfg;
    console.log('[Cosmos] queryType:', queryType, 'queryParams:', queryParams);
    if (!queryType || !queryParams || !queryParams.address) throw new Error('Invalid Cosmos config: missing address');
    const rpcEndpoint = process.env.COSMOS_RPC_URL;
    if (!rpcEndpoint) {
      throw new Error('COSMOS_RPC_URL is not set in environment variables');
    }
    const client = await getStargateClient(rpcEndpoint);
    if (queryType === 'balance') {
      const balance = await client.getAllBalances(queryParams.address);
      console.log('[Cosmos][balance]', balance);
    } else if (queryType === 'txs') {
      const txs = await client.searchTx(queryParams);
      console.log('[Cosmos][txs]', txs);
    } else {
      throw new Error('Unknown Cosmos query type: ' + queryType);
    }
  };
}

export async function getBalance(rpcUrl: string, address: string) {
  const client = await getStargateClient(rpcUrl);
  return client.getAllBalances(address);
}

export async function getTx(rpcUrl: string, hash: string) {
  const client = await getStargateClient(rpcUrl);
  return client.getTx(hash);
}

export async function sendTokens({ rpcUrl, mnemonic, to, amount, denom, gas = '200000', memo = '', chainId }: {
  rpcUrl: string;
  mnemonic: string;
  to: string;
  amount: string;
  denom: string;
  gas?: string;
  memo?: string;
  chainId: string;
}) {
  const { client, wallet } = await getSigningClientAndWallet(rpcUrl, mnemonic);
  const [account] = await wallet.getAccounts();
  const fee = {
    amount: [{ amount: gas, denom }],
    gas,
  };
  return client.sendTokens(account.address, to, [{ amount, denom }], fee, memo);
}

/**
 * Query the current block height
 */
export async function getLatestBlockHeight(rpcUrl: string) {
  const client = await getStargateClient(rpcUrl);
  const status = await client.getHeight();
  return status;
}

/**
 * Query a block by height
 */
export async function getBlockByHeight(rpcUrl: string, height: number) {
  const client = await getStargateClient(rpcUrl);
  return client.getBlock(height);
}

/**
 * Query account info (number, sequence, etc)
 */
export async function getAccountInfo(rpcUrl: string, address: string) {
  const client = await getStargateClient(rpcUrl);
  return client.getAccount(address);
}

/**
 * Query all balances for an address
 */
export async function getAllBalances(rpcUrl: string, address: string) {
  const client = await getStargateClient(rpcUrl);
  return client.getAllBalances(address);
}

/**
 * Query chain ID
 */
export async function getChainId(rpcUrl: string) {
  const client = await getStargateClient(rpcUrl);
  return client.getChainId();
}

/**
 * Query a transaction by hash (alias for getTx)
 */
export async function getTransactionByHash(rpcUrl: string, hash: string) {
  const client = await getStargateClient(rpcUrl);
  return client.getTx(hash);
}

/**
 * Query all transactions for an address (using searchTx)
 */
export async function searchTxs(rpcUrl: string, query: any) {
  const client = await getStargateClient(rpcUrl);
  return client.searchTx(query);
}

/**
 * Broadcast a signed transaction (raw tx)
 */
export async function broadcastTx(rpcUrl: string, txBytes: Uint8Array) {
  const client = await getStargateClient(rpcUrl);
  return client.broadcastTx(txBytes);
}

/**
 * Query staking delegation for (delegator, validator)
 */
export async function getDelegation(rpcUrl: string, delegatorAddress: string, validatorAddress: string) {
  const client = await getStargateClient(rpcUrl);
  return client.getDelegation(delegatorAddress, validatorAddress);
}

// Note: Some advanced queries (validators, supply, node info) require REST endpoints or LCD clients, not StargateClient.
// For those, you can use fetch or cosmjs/launchpad/lcd for more advanced needs.

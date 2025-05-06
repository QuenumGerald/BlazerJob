import { SigningStargateClient } from '@cosmjs/stargate';
import { DirectSecp256k1HdWallet } from '@cosmjs/proto-signing';

export async function getStargateClient(rpcUrl: string) {
  return SigningStargateClient.connect(rpcUrl);
}

export async function getSigningClientAndWallet(rpcUrl: string, mnemonic: string, prefix = 'cosmos') {
  const wallet = await DirectSecp256k1HdWallet.fromMnemonic(mnemonic, { prefix });
  const client = await SigningStargateClient.connectWithSigner(rpcUrl, wallet);
  return { client, wallet };
}

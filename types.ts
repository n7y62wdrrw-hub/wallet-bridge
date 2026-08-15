export type Chain = "bitcoin" | "ethereum" | "solana";

export type Network = "regtest" | "signet" | "sepolia" | "devnet";

export type Asset =
  | { type: "native"; symbol: "BTC" | "ETH" | "SOL" }
  | {
      type: "erc20";
      symbol: string;
      contract: string;
      decimals: number;
    };

export interface WalletApp {
  id: string;
  name: string;
  tokenHash: string;
  createdAt: string;
}

export interface RegisteredAddress {
  id: string;
  appId: string;
  chain: Chain;
  network: Network;
  address: string;
  label: string;
  createdAt: string;
}

export interface BridgeEvent {
  id: string;
  appId: string;
  type: "broadcast" | "incoming";
  chain: Chain;
  network: Network;
  txid: string;
  address?: string;
  amount?: string;
  asset?: string;
  createdAt: string;
  raw?: unknown;
}

export interface State {
  apps: WalletApp[];
  addresses: RegisteredAddress[];
  events: BridgeEvent[];
  checkpoints: Record<string, string>;
}

export interface SendRequest {
  chain: Chain;
  network: Network;
  asset: Asset;
  to: string;
  amount: string;
}

export interface BroadcastResult {
  txid: string;
  from?: string;
  to: string;
  amount: string;
  asset: string;
  raw?: unknown;
}

export interface IncomingTransfer {
  txid: string;
  to: string;
  amount?: string;
  asset: string;
  raw?: unknown;
}

export interface ScanResult {
  checkpoint?: string;
  transfers: IncomingTransfer[];
}

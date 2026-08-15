import { ChainAdapter } from "./adapter.js";
import {
  Asset,
  BroadcastResult,
  RegisteredAddress,
  ScanResult,
  SendRequest
} from "../core/types.js";

type RpcResponse<T> = {
  result: T;
  error: { code: number; message: string } | null;
  id: string;
};

export class BitcoinCoreAdapter implements ChainAdapter {
  constructor(
    private readonly rpcUrl: string,
    private readonly rpcUser: string,
    private readonly rpcPassword: string,
    private readonly wallet: string,
    private readonly network: "regtest" | "signet"
  ) {}

  private walletUrl(): string {
    const suffix = `/wallet/${encodeURIComponent(this.wallet)}`;
    return this.rpcUrl.replace(/\/$/, "") + suffix;
  }

  private async rpc<T>(method: string, params: unknown[] = []): Promise<T> {
    const auth = Buffer.from(`${this.rpcUser}:${this.rpcPassword}`).toString("base64");
    const response = await fetch(this.walletUrl(), {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "authorization": `Basic ${auth}`
      },
      body: JSON.stringify({
        jsonrpc: "1.0",
        id: "wallet-bridge",
        method,
        params
      })
    });

    if (!response.ok) {
      throw new Error(`Bitcoin RPC HTTP ${response.status}`);
    }

    const body = await response.json() as RpcResponse<T>;
    if (body.error) throw new Error(`Bitcoin RPC ${body.error.code}: ${body.error.message}`);
    return body.result;
  }

  private async assertNetwork(): Promise<void> {
    // getblockchaininfo is available through wallet-scoped RPC URL as well.
    const info = await this.rpc<{ chain: string }>("getblockchaininfo");
    if (info.chain !== this.network) {
      throw new Error(`Refusing Bitcoin send: node chain=${info.chain}, expected=${this.network}`);
    }
  }

  async send(request: SendRequest): Promise<BroadcastResult> {
    await this.assertNetwork();
    if (request.chain !== "bitcoin" || request.network !== this.network) {
      throw new Error(`Bitcoin adapter only accepts bitcoin/${this.network}`);
    }
    if (request.asset.type !== "native" || request.asset.symbol !== "BTC") {
      throw new Error("Bitcoin adapter supports native BTC only");
    }

    const amount = Number(request.amount);
    if (!Number.isFinite(amount) || amount <= 0) throw new Error("invalid BTC amount");

    const txid = await this.rpc<string>("sendtoaddress", [request.to, amount]);
    return {
      txid,
      to: request.to,
      amount: request.amount,
      asset: "BTC"
    };
  }

  async getBalance(address: string, asset: Asset): Promise<string> {
    if (asset.type !== "native" || asset.symbol !== "BTC") {
      throw new Error("Bitcoin adapter supports native BTC only");
    }
    await this.assertNetwork();
    // This returns total BTC received by an address in the configured Core wallet.
    const received = await this.rpc<number>("getreceivedbyaddress", [address, 0]);
    return String(received);
  }

  async createWalletAddress(label = ""): Promise<string> {
    await this.assertNetwork();
    return this.rpc<string>("getnewaddress", [label, "bech32"]);
  }

  async scanAddress(address: RegisteredAddress, checkpoint?: string): Promise<ScanResult> {
    await this.assertNetwork();
    // listtransactions tracks this Bitcoin Core wallet's transactions.
    const rows = await this.rpc<any[]>("listtransactions", ["*", 200, 0, true]);
    const incoming = rows
      .filter(
        row =>
          row.category === "receive" &&
          row.address === address.address &&
          typeof row.txid === "string"
      )
      .sort((a, b) => (a.time ?? 0) - (b.time ?? 0));

    const unseen = checkpoint
      ? incoming.filter(row => row.txid !== checkpoint).slice(
          Math.max(0, incoming.findIndex(row => row.txid === checkpoint) + 1)
        )
      : incoming.slice(-10);

    return {
      checkpoint: incoming.at(-1)?.txid ?? checkpoint,
      transfers: unseen.map(row => ({
        txid: row.txid,
        to: address.address,
        amount: String(row.amount),
        asset: "BTC",
        raw: {
          confirmations: row.confirmations,
          blockhash: row.blockhash
        }
      }))
    };
  }
}

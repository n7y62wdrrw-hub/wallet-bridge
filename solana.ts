import {
  Connection,
  Keypair,
  LAMPORTS_PER_SOL,
  PublicKey,
  SystemProgram,
  Transaction,
  sendAndConfirmTransaction
} from "@solana/web3.js";
import { ChainAdapter } from "./adapter.js";
import {
  Asset,
  BroadcastResult,
  RegisteredAddress,
  ScanResult,
  SendRequest
} from "../core/types.js";

export class SolanaDevnetAdapter implements ChainAdapter {
  private readonly connection: Connection;
  private readonly signer: Keypair;

  constructor(rpcUrl: string, secretKeyJson: string) {
    if (!rpcUrl) throw new Error("SOLANA_RPC_URL is required");
    if (!secretKeyJson) throw new Error("SOLANA_SECRET_KEY_JSON is required");

    this.connection = new Connection(rpcUrl, "confirmed");
    const bytes = Uint8Array.from(JSON.parse(secretKeyJson) as number[]);
    this.signer = Keypair.fromSecretKey(bytes);
  }

  private assertRequest(request: SendRequest): void {
    if (request.chain !== "solana" || request.network !== "devnet") {
      throw new Error("Solana adapter only accepts solana/devnet");
    }
    if (request.asset.type !== "native" || request.asset.symbol !== "SOL") {
      throw new Error("This Solana adapter currently sends native SOL only");
    }
  }

  async send(request: SendRequest): Promise<BroadcastResult> {
    this.assertRequest(request);
    const to = new PublicKey(request.to);
    const lamports = BigInt(Math.round(Number(request.amount) * LAMPORTS_PER_SOL));
    if (lamports <= 0n) throw new Error("amount must be greater than zero");
    if (lamports > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error("amount is too large");

    const transaction = new Transaction().add(
      SystemProgram.transfer({
        fromPubkey: this.signer.publicKey,
        toPubkey: to,
        lamports: Number(lamports)
      })
    );

    const signature = await sendAndConfirmTransaction(
      this.connection,
      transaction,
      [this.signer],
      { commitment: "confirmed" }
    );

    return {
      txid: signature,
      from: this.signer.publicKey.toBase58(),
      to: to.toBase58(),
      amount: request.amount,
      asset: "SOL"
    };
  }

  async getBalance(address: string, asset: Asset): Promise<string> {
    if (asset.type !== "native" || asset.symbol !== "SOL") {
      throw new Error("This Solana adapter currently supports native SOL balance only");
    }
    const lamports = await this.connection.getBalance(new PublicKey(address), "confirmed");
    return String(lamports / LAMPORTS_PER_SOL);
  }

  async scanAddress(address: RegisteredAddress, checkpoint?: string): Promise<ScanResult> {
    const pubkey = new PublicKey(address.address);
    const signatures = await this.connection.getSignaturesForAddress(
      pubkey,
      { limit: 50 },
      "confirmed"
    );

    const unseen = checkpoint
      ? signatures.slice(0, Math.max(0, signatures.findIndex(s => s.signature === checkpoint)))
      : signatures.slice(0, 10);

    const transfers = [];
    for (const sig of [...unseen].reverse()) {
      const tx = await this.connection.getTransaction(sig.signature, {
        commitment: "confirmed",
        maxSupportedTransactionVersion: 0
      });
      if (!tx?.meta) continue;

      const keys = tx.transaction.message.getAccountKeys().staticAccountKeys;
      const idx = keys.findIndex(k => k.equals(pubkey));
      if (idx < 0) continue;

      const pre = tx.meta.preBalances[idx];
      const post = tx.meta.postBalances[idx];
      const delta = post - pre;

      if (delta > 0) {
        transfers.push({
          txid: sig.signature,
          to: address.address,
          amount: String(delta / LAMPORTS_PER_SOL),
          asset: "SOL",
          raw: { slot: sig.slot }
        });
      }
    }

    return {
      checkpoint: signatures[0]?.signature ?? checkpoint,
      transfers
    };
  }
}

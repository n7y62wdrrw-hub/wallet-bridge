import express, { NextFunction, Request, Response } from "express";
import { BitcoinCoreAdapter } from "./adapters/bitcoin.js";
import { ChainAdapter } from "./adapters/adapter.js";
import { EthereumSepoliaAdapter } from "./adapters/ethereum.js";
import { SolanaDevnetAdapter } from "./adapters/solana.js";
import { Registry } from "./core/registry.js";
import { Chain, Network, SendRequest, WalletApp } from "./core/types.js";

const port = Number(process.env.PORT ?? "8788");
const stateFile = process.env.BRIDGE_STATE_FILE ?? "./wallet-bridge-state.json";
const registry = new Registry(stateFile);

function key(chain: Chain, network: Network): string {
  return `${chain}:${network}`;
}

function buildAdapters(): Map<string, ChainAdapter> {
  const map = new Map<string, ChainAdapter>();

  if (process.env.EVM_RPC_URL && process.env.EVM_PRIVATE_KEY) {
    map.set(
      key("ethereum", "sepolia"),
      new EthereumSepoliaAdapter(
        process.env.EVM_RPC_URL,
        process.env.EVM_PRIVATE_KEY,
        BigInt(process.env.EVM_CHAIN_ID ?? "11155111")
      )
    );
  }

  if (process.env.SOLANA_SECRET_KEY_JSON) {
    map.set(
      key("solana", "devnet"),
      new SolanaDevnetAdapter(
        process.env.SOLANA_RPC_URL ?? "https://api.devnet.solana.com",
        process.env.SOLANA_SECRET_KEY_JSON
      )
    );
  }

  if (
    process.env.BTC_RPC_URL &&
    process.env.BTC_RPC_USER &&
    process.env.BTC_RPC_PASSWORD &&
    process.env.BTC_WALLET
  ) {
    const network = (process.env.BTC_NETWORK ?? "regtest") as "regtest" | "signet";
    if (!["regtest", "signet"].includes(network)) {
      throw new Error("BTC_NETWORK must be regtest or signet");
    }
    map.set(
      key("bitcoin", network),
      new BitcoinCoreAdapter(
        process.env.BTC_RPC_URL,
        process.env.BTC_RPC_USER,
        process.env.BTC_RPC_PASSWORD,
        process.env.BTC_WALLET,
        network
      )
    );
  }

  return map;
}

const adapters = buildAdapters();
const app = express();
app.use(express.json({ limit: "32kb" }));

declare global {
  namespace Express {
    interface Request {
      walletApp?: WalletApp;
    }
  }
}

function auth(req: Request, _res: Response, next: NextFunction) {
  try {
    const header = req.header("authorization") ?? "";
    if (!header.startsWith("Bearer ")) throw new Error("Bearer token required");
    req.walletApp = registry.auth(header.slice(7));
    next();
  } catch (error) {
    next(error);
  }
}

app.get("/health", (_req, res) => {
  res.json({
    ok: true,
    adapters: [...adapters.keys()]
  });
});

app.post("/v1/apps", (req, res, next) => {
  try {
    res.status(201).json(registry.registerApp(String(req.body?.name ?? "")));
  } catch (error) {
    next(error);
  }
});

app.get("/v1/apps", auth, (_req, res) => {
  res.json(registry.listApps());
});

app.post("/v1/addresses", auth, (req, res, next) => {
  try {
    const item = registry.registerAddress(
      req.walletApp!.id,
      req.body.chain as Chain,
      req.body.network as Network,
      String(req.body.address ?? ""),
      String(req.body.label ?? "")
    );
    res.status(201).json(item);
  } catch (error) {
    next(error);
  }
});

app.get("/v1/addresses", auth, (_req, res) => {
  res.json(registry.listAddresses());
});

app.post("/v1/send", auth, async (req, res, next) => {
  try {
    const request = req.body as SendRequest;
    const adapter = adapters.get(key(request.chain, request.network));
    if (!adapter) {
      throw new Error(`adapter not configured for ${request.chain}/${request.network}`);
    }

    const destinationOwner = registry.ownerOf(
      request.chain,
      request.network,
      request.to
    );
    if (!destinationOwner) {
      throw new Error(
        "destination is not registered to a linked wallet app; register it before sending"
      );
    }

    const result = await adapter.send(request);

    registry.emit({
      appId: req.walletApp!.id,
      type: "broadcast",
      chain: request.chain,
      network: request.network,
      txid: result.txid,
      address: result.to,
      amount: result.amount,
      asset: result.asset,
      raw: result.raw
    });

    res.status(201).json({
      ...result,
      destinationAppId: destinationOwner.id
    });
  } catch (error) {
    next(error);
  }
});

app.get("/v1/balance", auth, async (req, res, next) => {
  try {
    const chain = String(req.query.chain) as Chain;
    const network = String(req.query.network) as Network;
    const address = String(req.query.address ?? "");
    const symbol = String(req.query.symbol ?? "");

    const registered = registry
      .addressesForApp(req.walletApp!.id)
      .find(a => a.chain === chain && a.network === network && a.address.toLowerCase() === address.toLowerCase());

    if (!registered) throw new Error("address is not registered to this app");

    const adapter = adapters.get(key(chain, network));
    if (!adapter) throw new Error(`adapter not configured for ${chain}/${network}`);

    if (!["BTC", "ETH", "SOL"].includes(symbol)) {
      throw new Error("balance route currently accepts native BTC, ETH, or SOL");
    }

    const amount = await adapter.getBalance(address, {
      type: "native",
      symbol: symbol as "BTC" | "ETH" | "SOL"
    });

    res.json({ chain, network, address, symbol, amount });
  } catch (error) {
    next(error);
  }
});

app.post("/v1/scan", auth, async (req, res, next) => {
  try {
    const addresses = registry.addressesForApp(req.walletApp!.id);
    let created = 0;

    for (const address of addresses) {
      const adapter = adapters.get(key(address.chain, address.network));
      if (!adapter) continue;

      const checkpoint = registry.getCheckpoint(address.id);
      const result = await adapter.scanAddress(address, checkpoint);

      for (const transfer of result.transfers) {
        registry.emit({
          appId: req.walletApp!.id,
          type: "incoming",
          chain: address.chain,
          network: address.network,
          txid: transfer.txid,
          address: transfer.to,
          amount: transfer.amount,
          asset: transfer.asset,
          raw: transfer.raw
        });
        created += 1;
      }

      registry.setCheckpoint(address.id, result.checkpoint);
    }

    res.json({ scanned: addresses.length, newEvents: created });
  } catch (error) {
    next(error);
  }
});

app.get("/v1/events", auth, (req, res) => {
  res.json(registry.eventsForApp(req.walletApp!.id));
});

app.use((error: unknown, _req: Request, res: Response, _next: NextFunction) => {
  const message = error instanceof Error ? error.message : "unknown error";
  res.status(400).json({ error: message });
});

app.listen(port, "127.0.0.1", () => {
  console.log(`Multi-chain testnet wallet bridge: http://127.0.0.1:${port}`);
  console.log(`Configured adapters: ${[...adapters.keys()].join(", ") || "(none yet)"}`);
  console.log("Development/test networks only. Do not load mainnet keys.");
});

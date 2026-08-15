# Multi-chain Testnet Wallet Bridge

This is the next version of the simulator: a **testnet-first blockchain bridge** that can connect multiple wallet applications and actually broadcast transactions on supported development/test networks.

Supported adapters:

- **Bitcoin:** Bitcoin Core `regtest` by default, with `signet` supported by configuration.
- **Ethereum:** Sepolia, using `ethers` and a Sepolia-only signer.
- **Solana:** Devnet, using `@solana/web3.js` and a devnet-only signer.

It is deliberately locked conceptually to development/test networks. Do **not** add production/mainnet private keys to the environment.

## What it does

The coordinator keeps a registry of:

- wallet apps,
- app API tokens,
- chain/network,
- addresses belonging to each app,
- labels and metadata,
- last scan checkpoints,
- detected incoming transfers.

A registered App A can ask the bridge to send supported testnet assets to a registered address belonging to App B. The adapter signs/broadcasts the chain transaction, and App B can poll its event inbox for receipt detection.

## Important limitation

There is no single transaction format that can send “any cryptocurrency.”

This framework provides an adapter interface so additional chains can be implemented safely:

```text
ChainAdapter
 ├── BitcoinCoreAdapter
 ├── EvmAdapter
 ├── SolanaAdapter
 └── YourNextChainAdapter
```

The included implementation supports:

- native BTC on Bitcoin Core regtest/signet,
- native Sepolia ETH,
- ERC-20 transfers on Sepolia,
- native SOL on Solana devnet.

It does not automatically support every token or every blockchain.

## 1. Install

Requires Node.js 20+.

```bash
npm install
cp .env.example .env
```

Load `.env` with your preferred environment loader or export the variables in your shell.

## 2. Start

```bash
npm run start
```

Default coordinator:

```text
http://127.0.0.1:8788
```

## 3. Register two wallet apps

```bash
npm run demo:register
```

Or:

```bash
curl -X POST http://127.0.0.1:8788/v1/apps \
  -H 'content-type: application/json' \
  -d '{"name":"Wallet A"}'
```

Save the returned token.

Register Wallet B the same way.

## 4. Register addresses

A wallet app can either:

1. register an address it already owns, or
2. for Bitcoin Core, ask its Core wallet to create a new address using the helper route.

Generic address registration:

```bash
curl -X POST http://127.0.0.1:8788/v1/addresses \
  -H "authorization: Bearer APP_TOKEN" \
  -H 'content-type: application/json' \
  -d '{
    "chain":"ethereum",
    "network":"sepolia",
    "address":"0x...",
    "label":"Main"
  }'
```

Solana:

```json
{
  "chain": "solana",
  "network": "devnet",
  "address": "...",
  "label": "Main"
}
```

Bitcoin:

```json
{
  "chain": "bitcoin",
  "network": "regtest",
  "address": "bcrt1...",
  "label": "Main"
}
```

## 5. Send from App A to App B

### Sepolia ETH

```bash
curl -X POST http://127.0.0.1:8788/v1/send \
  -H "authorization: Bearer APP_A_TOKEN" \
  -H 'content-type: application/json' \
  -d '{
    "chain":"ethereum",
    "network":"sepolia",
    "asset":{"type":"native","symbol":"ETH"},
    "to":"0xAPP_B_ADDRESS",
    "amount":"0.001"
  }'
```

### Sepolia ERC-20

```bash
curl -X POST http://127.0.0.1:8788/v1/send \
  -H "authorization: Bearer APP_A_TOKEN" \
  -H 'content-type: application/json' \
  -d '{
    "chain":"ethereum",
    "network":"sepolia",
    "asset":{
      "type":"erc20",
      "symbol":"TEST",
      "contract":"0xTOKEN_CONTRACT",
      "decimals":18
    },
    "to":"0xAPP_B_ADDRESS",
    "amount":"10"
  }'
```

### Solana Devnet SOL

```bash
curl -X POST http://127.0.0.1:8788/v1/send \
  -H "authorization: Bearer APP_A_TOKEN" \
  -H 'content-type: application/json' \
  -d '{
    "chain":"solana",
    "network":"devnet",
    "asset":{"type":"native","symbol":"SOL"},
    "to":"APP_B_SOLANA_ADDRESS",
    "amount":"0.01"
  }'
```

### Bitcoin regtest/signet BTC

```bash
curl -X POST http://127.0.0.1:8788/v1/send \
  -H "authorization: Bearer APP_A_TOKEN" \
  -H 'content-type: application/json' \
  -d '{
    "chain":"bitcoin",
    "network":"regtest",
    "asset":{"type":"native","symbol":"BTC"},
    "to":"bcrt1APP_B_ADDRESS",
    "amount":"0.001"
  }'
```

Bitcoin signing is delegated to the configured Bitcoin Core wallet. This is much safer than reimplementing Bitcoin private-key or transaction signing logic in the bridge.

## 6. Detect incoming transfers

Tell the bridge to scan registered addresses:

```bash
curl -X POST http://127.0.0.1:8788/v1/scan \
  -H "authorization: Bearer APP_B_TOKEN"
```

Read App B's event inbox:

```bash
curl http://127.0.0.1:8788/v1/events \
  -H "authorization: Bearer APP_B_TOKEN"
```

For production-scale wallet software, replace polling with a dedicated indexer/webhook architecture.

## Ethereum setup

Ethereum Sepolia is intended for application development. Configure:

```text
EVM_RPC_URL=<your Sepolia JSON-RPC endpoint>
EVM_PRIVATE_KEY=<TESTNET-ONLY private key>
EVM_CHAIN_ID=11155111
```

The adapter verifies the connected chain ID before sending. It refuses anything other than the configured testnet chain.

The private key controls the sending account; register that account's address under App A.

## Solana setup

Default:

```text
SOLANA_RPC_URL=https://api.devnet.solana.com
```

Set a devnet-only secret key:

```text
SOLANA_SECRET_KEY_JSON=[1,2,...]
```

The adapter checks the endpoint/network configuration and sends signed SOL transfers.

Public Solana RPC endpoints are useful for development but can be rate limited; use a dedicated RPC service for serious applications.

## Bitcoin Core regtest setup

Example `bitcoin.conf` entries:

```text
regtest=1
server=1
rpcuser=devuser
rpcpassword=devpassword
```

Start Core, create/load a wallet named `bridge`, then fund it on regtest by mining blocks.

Typical flow:

```bash
bitcoin-cli -regtest createwallet bridge
bitcoin-cli -regtest -rpcwallet=bridge getnewaddress
```

Generate blocks to a regtest address so coinbase funds mature before spending.

The adapter calls Core's wallet RPC `sendtoaddress`.

## Files

```text
src/
  core/
    registry.ts
    types.ts
  adapters/
    adapter.ts
    ethereum.ts
    solana.ts
    bitcoin.ts
  server.ts
```

## Security boundaries

This is a development framework, not a reviewed production custody platform.

Before handling real funds you would need, at minimum:

- hardware-backed or MPC/HSM key management,
- withdrawal policies and approvals,
- per-chain fee/nonce/UTXO management,
- address allowlists and validation,
- rate limiting and authentication hardening,
- secure secrets storage,
- reconciliation,
- idempotency controls,
- reorg handling,
- token allowlists,
- fraud controls,
- audit logging,
- monitoring,
- backup/recovery procedures,
- independent security review.

For that reason this package intentionally documents and defaults to test networks.

## Extending another chain

Implement:

```ts
interface ChainAdapter {
  send(request: SendRequest): Promise<BroadcastResult>;
  scanAddress(address: RegisteredAddress, checkpoint?: string): Promise<ScanResult>;
  getBalance(address: string, asset: Asset): Promise<string>;
}
```

Then add it to `buildAdapters()` in `server.ts`.

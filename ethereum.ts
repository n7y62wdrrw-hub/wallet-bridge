import {
  Contract,
  JsonRpcProvider,
  Wallet,
  formatEther,
  formatUnits,
  getAddress,
  parseEther,
  parseUnits
} from "ethers";
import { ChainAdapter } from "./adapter.js";
import {
  Asset,
  BroadcastResult,
  RegisteredAddress,
  ScanResult,
  SendRequest
} from "../core/types.js";

const ERC20_ABI = [
  "function transfer(address to, uint256 amount) returns (bool)",
  "function balanceOf(address account) view returns (uint256)",
  "event Transfer(address indexed from, address indexed to, uint256 value)"
];

export class EthereumSepoliaAdapter implements ChainAdapter {
  private readonly provider: JsonRpcProvider;
  private readonly signer: Wallet;
  private readonly expectedChainId: bigint;

  constructor(rpcUrl: string, privateKey: string, expectedChainId = 11155111n) {
    if (!rpcUrl) throw new Error("EVM_RPC_URL is required");
    if (!privateKey) throw new Error("EVM_PRIVATE_KEY is required");
    this.provider = new JsonRpcProvider(rpcUrl);
    this.signer = new Wallet(privateKey, this.provider);
    this.expectedChainId = expectedChainId;
  }

  private async assertNetwork(): Promise<void> {
    const network = await this.provider.getNetwork();
    if (network.chainId !== this.expectedChainId) {
      throw new Error(
        `Refusing EVM send: connected chainId ${network.chainId}, expected ${this.expectedChainId}`
      );
    }
  }

  async send(request: SendRequest): Promise<BroadcastResult> {
    await this.assertNetwork();
    if (request.chain !== "ethereum" || request.network !== "sepolia") {
      throw new Error("Ethereum adapter only accepts ethereum/sepolia");
    }

    const to = getAddress(request.to);

    if (request.asset.type === "native") {
      if (request.asset.symbol !== "ETH") throw new Error("native EVM asset must be ETH");
      const tx = await this.signer.sendTransaction({
        to,
        value: parseEther(request.amount)
      });
      return {
        txid: tx.hash,
        from: this.signer.address,
        to,
        amount: request.amount,
        asset: "ETH"
      };
    }

    const token = new Contract(request.asset.contract, ERC20_ABI, this.signer);
    const amount = parseUnits(request.amount, request.asset.decimals);
    const tx = await token.transfer(to, amount);
    return {
      txid: tx.hash,
      from: this.signer.address,
      to,
      amount: request.amount,
      asset: request.asset.symbol,
      raw: { contract: request.asset.contract }
    };
  }

  async getBalance(address: string, asset: Asset): Promise<string> {
    await this.assertNetwork();
    const account = getAddress(address);
    if (asset.type === "native") {
      return formatEther(await this.provider.getBalance(account));
    }
    const token = new Contract(asset.contract, ERC20_ABI, this.provider);
    return formatUnits(await token.balanceOf(account), asset.decimals);
  }

  async scanAddress(address: RegisteredAddress, checkpoint?: string): Promise<ScanResult> {
    await this.assertNetwork();
    const latest = await this.provider.getBlockNumber();
    // First scan starts near the head so registering an old address does not replay its entire history.
    const start = checkpoint ? Number(checkpoint) + 1 : Math.max(0, latest - 20);
    const target = getAddress(address.address).toLowerCase();
    const transfers = [];

    for (let number = start; number <= latest; number++) {
      const block = await this.provider.getBlock(number, true);
      if (!block) continue;

      for (const item of block.prefetchedTransactions) {
        if (item.to?.toLowerCase() === target && item.value > 0n) {
          transfers.push({
            txid: item.hash,
            to: address.address,
            amount: formatEther(item.value),
            asset: "ETH",
            raw: { blockNumber: number }
          });
        }
      }
    }

    return { checkpoint: String(latest), transfers };
  }
}

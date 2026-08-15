import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import {
  BridgeEvent,
  Chain,
  Network,
  RegisteredAddress,
  State,
  WalletApp
} from "./types.js";

const emptyState = (): State => ({
  apps: [],
  addresses: [],
  events: [],
  checkpoints: {}
});

function sha256(text: string): string {
  return crypto.createHash("sha256").update(text).digest("hex");
}

export class Registry {
  private state: State;

  constructor(private readonly filename: string) {
    const resolved = path.resolve(filename);
    this.filename = resolved;
    if (fs.existsSync(resolved)) {
      this.state = JSON.parse(fs.readFileSync(resolved, "utf8")) as State;
    } else {
      this.state = emptyState();
      this.persist();
    }
  }

  private persist(): void {
    const tmp = this.filename + ".tmp";
    fs.writeFileSync(tmp, JSON.stringify(this.state, null, 2));
    fs.renameSync(tmp, this.filename);
  }

  registerApp(name: string): { app: Omit<WalletApp, "tokenHash">; token: string } {
    if (!name.trim()) throw new Error("name is required");

    const token = "mctb_" + crypto.randomBytes(32).toString("base64url");
    const app: WalletApp = {
      id: "app_" + crypto.randomUUID(),
      name: name.trim(),
      tokenHash: sha256(token),
      createdAt: new Date().toISOString()
    };

    this.state.apps.push(app);
    this.persist();

    const { tokenHash: _, ...publicApp } = app;
    return { app: publicApp, token };
  }

  auth(token: string): WalletApp {
    const app = this.state.apps.find(a => a.tokenHash === sha256(token));
    if (!app) throw new Error("invalid API token");
    return app;
  }

  listApps(): Omit<WalletApp, "tokenHash">[] {
    return this.state.apps.map(({ tokenHash: _, ...app }) => app);
  }

  registerAddress(
    appId: string,
    chain: Chain,
    network: Network,
    address: string,
    label = ""
  ): RegisteredAddress {
    if (!address.trim()) throw new Error("address is required");

    const duplicate = this.state.addresses.find(
      a => a.chain === chain && a.network === network && a.address === address
    );
    if (duplicate && duplicate.appId !== appId) {
      throw new Error("address is already registered to another app");
    }
    if (duplicate) return duplicate;

    const item: RegisteredAddress = {
      id: "addr_" + crypto.randomUUID(),
      appId,
      chain,
      network,
      address: address.trim(),
      label: label.trim(),
      createdAt: new Date().toISOString()
    };
    this.state.addresses.push(item);
    this.persist();
    return item;
  }

  listAddresses(): RegisteredAddress[] {
    return [...this.state.addresses];
  }

  addressesForApp(appId: string): RegisteredAddress[] {
    return this.state.addresses.filter(a => a.appId === appId);
  }

  ownerOf(chain: Chain, network: Network, address: string): WalletApp | undefined {
    const item = this.state.addresses.find(
      a => a.chain === chain && a.network === network && a.address.toLowerCase() === address.toLowerCase()
    );
    return item ? this.state.apps.find(a => a.id === item.appId) : undefined;
  }

  emit(event: Omit<BridgeEvent, "id" | "createdAt">): BridgeEvent {
    const full: BridgeEvent = {
      ...event,
      id: "evt_" + crypto.randomUUID(),
      createdAt: new Date().toISOString()
    };
    this.state.events.push(full);
    this.persist();
    return full;
  }

  eventsForApp(appId: string): BridgeEvent[] {
    return this.state.events.filter(e => e.appId === appId);
  }

  getCheckpoint(addressId: string): string | undefined {
    return this.state.checkpoints[addressId];
  }

  setCheckpoint(addressId: string, checkpoint?: string): void {
    if (checkpoint) this.state.checkpoints[addressId] = checkpoint;
    this.persist();
  }
}

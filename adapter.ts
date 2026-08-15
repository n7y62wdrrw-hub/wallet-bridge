import {
  Asset,
  BroadcastResult,
  RegisteredAddress,
  ScanResult,
  SendRequest
} from "../core/types.js";

export interface ChainAdapter {
  send(request: SendRequest): Promise<BroadcastResult>;
  scanAddress(address: RegisteredAddress, checkpoint?: string): Promise<ScanResult>;
  getBalance(address: string, asset: Asset): Promise<string>;
}

import type { NativeWalletCalls } from './commands.js';
import { failure } from '../errors.js';
import type { AccountRecord } from '../types.js';

/** Accepted, already initialized VIEW owner. Construct and consume in its worker. */
export interface InitializedViews {

  readonly generation: number;

  readonly instance: string;

  call(
    generation: number,
    instance: string,
    operation: string,
    args: object,
    seed?: Uint8Array,
    mnemonic?: Uint8Array,
    passphrase?: Uint8Array
  ): unknown;

  bindSigner?(token: number, accountId: string): 'ready' | 'recovery-required';

  unbindSigner?(token: number, accountId: string): void;

  close(generation: number, instance: string): void;

}
export interface NativeSignerDescription {
  readonly parameters: string;
  readonly genesis: string;
  readonly accountIndex: number;
  readonly viewingKey: string;
}
export interface NativeSignerCapabilities extends Omit<import('../types.js').SignerCapabilities, 'networks'> {
  readonly parameters: string;
  readonly genesis: string;
}
export interface NativeSignerAuthorization {
  readonly token: number;
  readonly format: string;
  readonly parameters: Uint8Array;
  readonly genesis: Uint8Array;
  readonly height: number;
  readonly branch: number;
  readonly bytes: Uint8Array;
  readonly maximum: number;
}
export interface InitializedSigners {

  describe(token: number): NativeSignerDescription;

  release(token: number): void;

  capabilities(token: number): NativeSignerCapabilities;

  authorize(
    token: number,
    format: string,
    parameters: Uint8Array,
    genesis: Uint8Array,
    height: number,
    branch: number,
    bytes: Uint8Array,
    maximum: number
  ): Uint8Array;

}
export interface MnemonicAccountInput {
  readonly mnemonic: Uint8Array;
  readonly accountId?: string;
  readonly passphrase?: Uint8Array;
  readonly accountIndex?: number;
  readonly birthday?: unknown;
  readonly name?: string;
}
export interface NativeCreatedAccount { readonly account: AccountRecord; readonly signerToken: number }

/** Private scanner points use protocol-order hash hex; public points use display order. */
export interface ScanTarget { readonly height: number; readonly hash: string }
export interface ScanPlan {
  readonly revision: string;
  readonly target: ScanTarget;
  readonly ranges: readonly {
    readonly start: number;
    readonly endExclusive: number;
    readonly priority: string;
    readonly priorState: { readonly height: number; readonly hash: string | null };
  }[];
}
export interface ScanBatch {
  readonly revision: string;
  readonly target: ScanTarget;
  readonly priorTreeState: Uint8Array;
  readonly blocks: readonly Uint8Array[];
}
export interface ScanReceipt {
  readonly revision: string;
  readonly start: number;
  readonly endExclusive: number;
  readonly blocks: number;
}
export interface ScanBlock { readonly revision: string; readonly point: ScanTarget | null }
export interface ScanRewind { readonly revision: string; readonly requestedPoint: ScanTarget }
export interface ScanCompletion {
  readonly revision: string;
  readonly target: ScanTarget;
  readonly treeState: Uint8Array;
}
export type EnhancementRequest = { readonly kind: 'enhancement' | 'status'; readonly txid: string }
  | {
    readonly kind: 'address';
    readonly address: string;
    readonly start: number;
    readonly endExclusive: number | null;
    readonly requestAt: number | null;
    readonly txStatus: 'mined' | 'mempool' | 'all';
    readonly outputStatus: 'unspent' | 'all';
  };
export interface EnhancementRequests { readonly revision: string; readonly requests: readonly EnhancementRequest[] }
export type EnhancementResult = {
  readonly transactions: readonly {
    readonly bytes: Uint8Array;
    readonly minedHeight: number | null;
    readonly txid?: string;
    readonly unspentOutputs?: readonly {
      readonly outputIndex: number;
      readonly script: Uint8Array;
      readonly value: bigint;
    }[];
  }[];
  readonly asOfHeight?: number;
  readonly asOfHash?: string;
  readonly complete?: boolean;
}
| { readonly status: 'notRecognized' | 'notInMainChain' }
| { readonly status: 'mined'; readonly height: number };
export interface EnhancementApply {
  readonly revision: string;
  readonly request: EnhancementRequest;
  readonly result: EnhancementResult;
}

export type Completion = 'none' | 'committed' | 'unknown';

/** Internal composition only; not a WalletClient or a public factory.
 * Native failures remain native until the public error/recovery boundary exists.
 */
export class WalletSession {
  private tail: Promise<unknown> = Promise.resolve();
  private closing: Promise<void> | undefined;
  private readonly completions = new WeakMap<object, Completion>();
  private readonly generation: number;
  private readonly instance: string;

  constructor(private readonly owner: InitializedViews) {
    this.generation = owner.generation;
    this.instance = owner.instance;
  }

  /** Worker-local completion receipt; never retry a rejected write automatically. */
  completion(error: object): Completion | undefined {
    return this.completions.get(error);
  }

  invoke<C extends keyof NativeWalletCalls>(
    operation: C, args: Parameters<NativeWalletCalls[C]>[0],
  ): Promise<ReturnType<NativeWalletCalls[C]>> {
    args ??= {};
    if (this.closing) {
      const error = failure('CLOSED', 'runtime', 'none', 'Wallet session is closed.');
      this.completions.set(error, 'none');
      return Promise.reject(error);
    }
    const result = this.tail.then(async () => {
      try {
        // The accepted owner supplies the frozen API DTOs, including bigint indices.
        if (operation === 'signer_bind' || operation === 'signer_unbind') {
          const input = args as { token: number; accountId: string };
          const method = operation === 'signer_bind' ? this.owner.bindSigner : this.owner.unbindSigner;
          if (!method) {
            throw failure(
              'METHOD_NOT_SUPPORTED',
              'account',
              'configure',
              'Native signer binding unavailable.',
            );
          }
          return Reflect.apply(method, this.owner, [input.token, input.accountId]) as ReturnType<NativeWalletCalls[C]>;
        }
        if (operation === 'account_import_mnemonic_signer' || operation === 'account_create_mnemonic_signer'
          || operation === 'account_restore_mnemonic_signer') {
          const { mnemonic, passphrase, ...input } = args as MnemonicAccountInput;
          // Native runtimes answer asynchronously; await so rejections are recorded below.
          return await this.owner.call(
            this.generation,
            this.instance,
            operation,
            input,
            undefined,
            mnemonic,
            passphrase,
          ) as ReturnType<NativeWalletCalls[C]>;
        }
        const value = await this.owner.call(this.generation, this.instance, operation, args);
        return value as ReturnType<NativeWalletCalls[C]>;
      } catch (error) {
        if (typeof error === 'object' && error !== null && !this.completions.has(error)) {
          let commit: unknown;
          try {
            commit = Object.getOwnPropertyDescriptor(error, 'commit')?.value;
          } catch { /* Preserve the original rejection. */ }
          this.completions.set(error, commit === 'none' || commit === 'committed' ? commit : 'unknown');
        }
        throw error;
      }
    });
    this.tail = result.catch(() => undefined);
    return result;
  }

  /** Drain accepted calls, close once, and reject new admission immediately.
   * The enclosing host must still destroy the dedicated worker, even on failure.
   */
  close(): Promise<void> {
    this.closing ??= this.tail.then(() => this.owner.close(this.generation, this.instance));
    return this.closing;
  }
}

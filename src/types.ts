/** Shared SDK contracts. Runtime exports and function signatures are owned by index.ts
 * and their implementation modules. Types alone do not establish backend support.
 */

declare const opaque: unique symbol;
type Brand<T, K extends string> = T & { readonly [opaque]: K };
export type AccountId = Brand<string, 'database-account-uuid'>;
export type AccountIndex = Brand<number, 'zip32-account-index'>;
export type DiversifierIndex = Brand<bigint, '88-bit-diversifier-index'>;
export type TxId = Brand<string, 'display-txid'>;
export type BlockHash = Brand<string, 'display-block-hash'>;
export type Pool = 'transparent' | 'sapling' | 'ironwood';
export type ShieldedPool = Exclude<Pool, 'transparent'>;
/** Orchard is a receiver encoding reused by Ironwood, never a v1 Pool. */
export type ReceiverType = 'p2pkh' | 'p2sh' | 'sapling' | 'orchard';
export type SecretInput = Uint8Array;
export type NonEmpty<T> = readonly [T, ...T[]];
export interface Op { readonly signal?: AbortSignal }
export interface Disposable { dispose(): Promise<void> }

export type BuiltinNetwork = 'mainnet' | 'testnet';
/** Validated protocol descriptor, from a package preset or an explicit definition. */
export interface Network {
  readonly [opaque]: 'network';
  readonly identity: string;
  readonly genesisHash: BlockHash;
}
/** Complete deployment consensus schedule. Null means an upgrade is inactive. */
export interface NetworkParameters {
  readonly encoding: 'main' | 'test' | 'regtest';
  readonly Overwinter: number | null;
  readonly Sapling: number | null;
  readonly Blossom: number | null;
  readonly Heartwood: number | null;
  readonly Canopy: number | null;
  readonly Nu5: number | null;
  readonly Nu6: number | null;
  readonly Nu6_1: number | null;
  readonly Nu6_2: number | null;
  readonly Nu6_3: number | null;
  /** Omit for a legacy version-1 schedule; null explicitly disables NU7 in version 2. */
  readonly Nu7?: number | null;
}
export interface NetworkDefinition {
  readonly identity: string;
  readonly genesisHash: BlockHash;
  /** Exact versioned consensus/encoding parameter document; schema is a G4 gate. */
  readonly parameters: Uint8Array;
  readonly parametersFormat: string;
}
/** Endpoint shorthand. Omitted network selects mainnet, never endpoint auto-detection. */
export interface LightClientOptions {
  readonly network?: BuiltinNetwork | Network | NetworkDefinition;
  readonly transportOptions?: Partial<TransportOptions>;
}
/** JSON-RPC endpoint shorthand; transport and observation reads remain bounded. */
export interface PublicClientOptions {
  readonly network?: BuiltinNetwork | Network | NetworkDefinition;
  readonly transportOptions?: Partial<TransportOptions>;
  readonly observation?: Partial<ObservationOptions>;
}
export interface ConsensusContext {
  readonly network: Network;
  readonly targetHeight: number;
  readonly branchId: number;
}
export interface SourceObservation {
  readonly sourceId: string; // caller label, never a credential-bearing endpoint
  readonly observedAt: string; // UTC ISO-8601
}
export interface ChainPoint { readonly height: number; readonly hash: BlockHash }
export interface ChainTip extends ChainPoint, SourceObservation { }
export type BlockSelector = { readonly height: number; readonly hash?: never }
  | { readonly hash: BlockHash; readonly height?: never };
export interface HeightRange { readonly fromHeight: number; readonly toHeight: number }

/** Factories are lazy: protocol/network handshake on first use; no failover. */
export interface TransportOptions {
  readonly sourceId: string;
  readonly timeoutMs: number; // positive per-request deadline
  readonly readRetry: { readonly attempts: number; readonly delayMs: number };
  readonly maxResponseBytes: number;
  /** Omitted = no credentials. Callback results/URLs must never enter diagnostics. */
  readonly headers?: () => Promise<Readonly<Record<string, string>>>;
}
export interface HttpTransport { readonly [opaque]: 'http-json-rpc-transport' }
export interface GrpcTransport { readonly [opaque]: 'lightwallet-grpc-transport' }
export type LightUnaryMethod = 'GetLatestBlock' | 'GetLightdInfo' | 'GetTransaction'
  | 'GetAddressUtxos' | 'GetTaddressBalance' | 'GetTreeState' | 'SendTransaction';
export type LightStreamMethod = 'GetSubtreeRoots' | 'GetBlockRange'
  | 'GetTaddressTransactions' | 'GetMempoolStream';
/** Advanced adapter: bounded protobuf payloads at a pinned protocol revision.
 * Host normalizes status/trailers, including browser balance-call adaptation.
 * Iteration is pull-bounded; return()/abort releases streams. No automatic replay.
 */
export interface CustomLightTransport {
  readonly kind: 'custom-lightwallet';
  readonly sourceId: string;
  readonly protocolRevision: string;
  unary(args: { method: LightUnaryMethod; request: Uint8Array } & Op): Promise<Uint8Array>;
  stream(args: { method: LightStreamMethod; request: Uint8Array } & Op): AsyncIterable<Uint8Array>;
}
export interface ObservationOptions {
  readonly pollIntervalMs: number;
  readonly maxBufferedUpdates: number; // positive; overflow errors, never silent loss
}
export interface ZcashClient {
  readonly public: PublicClient;
  readonly light: LightClient;
  readonly wallet: WalletClient;
}

export interface BlockHeader extends SourceObservation {
  readonly point: ChainPoint;
  readonly previousHash: BlockHash;
  readonly time: number; // Unix seconds
  readonly raw: Uint8Array;
}
export interface PublicBlock extends BlockHeader { readonly txids: readonly TxId[] }
export interface Inclusion {
  readonly height: number;
  readonly blockHash: BlockHash | null;
  readonly confirmations: number | null; // only with coherent inclusion/tip identity
}
export interface TransactionObservation extends SourceObservation {
  readonly txid: TxId;
  readonly state: 'notSeen' | 'mempool' | 'mined' | 'offMainChain' | 'unknown';
  readonly inclusion: Inclusion | null;
  readonly tip: ChainPoint | null;
  readonly priorInclusion: Inclusion | null;
}
export interface PublicTransaction extends SourceObservation {
  readonly txid: TxId;
  readonly raw: Uint8Array;
  readonly observation: TransactionObservation;
}
export interface PublicUtxo {
  readonly txid: TxId;
  readonly outputIndex: number;
  readonly address: string;
  readonly value: bigint;
  readonly script: Uint8Array;
  readonly minedHeight: number | null;
}
export interface PublicUtxos extends SourceObservation {
  readonly items: readonly PublicUtxo[];
  readonly tip: ChainPoint | null;
}
export interface TreeState extends SourceObservation {
  readonly network: Network;
  readonly point: ChainPoint;
  readonly sapling: Uint8Array | null;
  readonly ironwood: Uint8Array | null;
  readonly encoded: Uint8Array; // pinned lightwallet TreeState protobuf; network label normalized to configured encoding
}
export interface SubtreeRoot extends SourceObservation {
  readonly pool: ShieldedPool;
  readonly index: bigint;
  readonly root: Uint8Array;
  readonly completingBlock: ChainPoint;
}
export interface SubtreeRequest {
  readonly pool: ShieldedPool;
  readonly startIndex: bigint;
  readonly limit: number; // positive bounded count, no implicit unbounded request
}
export interface BroadcastReport extends SourceObservation {
  readonly txid: TxId; // derived from exact bytes, checked against server result
  readonly outcome: 'acknowledged' | 'rejected' | 'unknown';
  readonly diagnosticCode: string | null; // sanitized code, never raw server text
}
export interface WaitOptions extends Op {
  readonly confirmations?: number; // default 1; positive integer, zero rejects
  readonly timeoutMs?: number; // omitted = no deadline; explicit value must be positive
}
export interface ConfirmedTransaction extends SourceObservation {
  readonly txid: TxId;
  readonly height: number;
  readonly blockHash: BlockHash;
  readonly confirmations: number;
}
/** Optional provider methods fail METHOD_NOT_SUPPORTED; no invented zero/not-found.
 * Broadcast is one attempt, never automatically retried; timeout after dispatch is unknown.
 * Public/light results are endpoint evidence, not full consensus verification.
 */
export interface PublicClient {
  readonly network: Network;
  getTip(args?: Op): Promise<ChainTip>;
  getBlock(args: BlockSelector & Op): Promise<PublicBlock | null>;
  getBlockHeader(args: BlockSelector & Op): Promise<BlockHeader | null>;
  getTransaction(args: { txid: TxId } & Op): Promise<PublicTransaction | null>;
  getTransactionStatus(args: { txid: TxId } & Op): Promise<TransactionObservation>;
  getUtxos(args: { addresses: NonEmpty<string> } & Op): Promise<PublicUtxos>;
  getTreeState(args: BlockSelector & Op): Promise<TreeState>;
  getSubtreeRoots(args: SubtreeRequest & Op): AsyncIterable<SubtreeRoot>;
  broadcastTransaction(args: { bytes: Uint8Array } & Op): Promise<BroadcastReport>;
  waitForTransaction(args: { txid: TxId } & WaitOptions): Promise<ConfirmedTransaction>;
  watchTransaction(args: { txid: TxId } & Op): AsyncIterable<TransactionObservation>;
}
export interface LightServerInfo extends SourceObservation {
  readonly networkIdentity: string;
  readonly vendor: string;
  readonly version: string;
  readonly protocolRevision: string;
}
export interface CompactBlock extends SourceObservation {
  readonly point: ChainPoint;
  readonly previousHash: BlockHash;
  readonly encoded: Uint8Array; // bounded pinned CompactBlock protobuf, including Ironwood
}
export interface LightClient {
  readonly network: Network;
  getTip(args?: Op): Promise<ChainTip>;
  getServerInfo(args?: Op): Promise<LightServerInfo>;
  /** Decode uint64 sentinels before conversion: 0 mempool, all-ones off-main-chain. */
  getTransaction(args: { txid: TxId } & Op): Promise<PublicTransaction | null>;
  getAddressUtxos(args: { addresses: NonEmpty<string> } & Op): Promise<PublicUtxos>;
  getAddressBalance(args: { addresses: NonEmpty<string> } & Op): Promise<{
    value: bigint; sourceId: string; observedAt: string;
  }>;
  getTreeState(args: BlockSelector & Op): Promise<TreeState>;
  getSubtreeRoots(args: SubtreeRequest & Op): AsyncIterable<SubtreeRoot>;
  /** Inclusive range; receiving blocks does not scan a wallet. */
  streamCompactBlocks(args: HeightRange & Op): AsyncIterable<CompactBlock>;
  streamAddressTransactions(args: { address: string } & HeightRange & Op): AsyncIterable<PublicTransaction>;
  streamMempool(args?: Op): AsyncIterable<PublicTransaction>;
  broadcastTransaction(args: { bytes: Uint8Array } & Op): Promise<BroadcastReport>;
}

/** Bundled SQLite in wallet WASM; never an injected native SQLite connection.
 * Node filesystem and OPFS are intended durable modes, pending F3 qualification.
 * Memory is explicitly ephemeral; no silent fallback, encrypted-at-rest claim or secret vault.
 */
export type WalletStorage
  = | { readonly kind: 'node-filesystem'; readonly path: string }
    | { readonly kind: 'browser-opfs'; readonly name: string }
    | { readonly kind: 'memory' };
/** Application-pinned canonical manifest; H1.1 defines URL and verification rules. */
export interface WasmArtifact {
  readonly manifestUrl: string; // absolute credential-free HTTPS URL
  readonly manifestSha256: string; // expected lowercase 64-hex SHA-256 of canonical bytes
}
/** Complete executable closure; no unlisted imports or runtime-downloaded code. */
export interface ArtifactFile {
  readonly url: string; // relative path under the manifest directory; H1.1
  readonly sha256: string; // lowercase 64-hex SHA-256 of exact asset bytes
  readonly byteLength: number; // positive safe integer
  readonly kind: 'module' | 'glue' | 'wasm' | 'worker' | 'thread-bootstrap';
  readonly mediaType: 'text/javascript' | 'application/wasm';
}
export interface ArtifactManifest {
  readonly format: 'zcash-artifact/1';
  readonly contractRevision: string;
  readonly abiVersion: string;
  readonly schemas: {
    readonly operations: Readonly<Record<string, string>>;
    readonly protobuf: string;
    readonly networkParameters: string;
    readonly database: string;
    readonly hostServices: Readonly<Record<string, string>>;
  };
  readonly buildSha256: string; // digest of reproducible build/toolchain identity record
  readonly dependencyGraphSha256: string; // digest of complete locked dependency/feature graph
  readonly mode: 'baseline' | 'threaded';
  readonly files: NonEmpty<ArtifactFile>;
}
export interface RuntimeOptions {
  readonly baseline: WasmArtifact;
  readonly threading: { readonly mode: 'baseline' } | {
    readonly mode: 'prefer-threaded';
    readonly artifact: WasmArtifact;
    readonly workers: number;
    readonly startupTimeoutMs: number;
  };
  readonly maxMemoryBytes: number;
  readonly maxQueuedBytes: number;
  readonly maxQueuedJobs: number;
  readonly scanBatchSize: number;
  readonly maxPcztBytes: number;
  /** Optional sanitized startup diagnostics; no wallet identifiers or payloads. */
  readonly onDiagnostic?: (event: RuntimeDiagnostic) => void;
}
export interface RuntimeDiagnostic {
  readonly code: 'BASELINE_SELECTED' | 'THREADED_SELECTED' | 'THREADED_FALLBACK';
  readonly reason: 'requested' | 'prerequisiteMissing' | 'bootstrapFailed' | 'ready';
}
export interface AssetRequirement {
  readonly pool: ShieldedPool;
  readonly circuitVersion: string;
  readonly assetId: string;
  readonly format: string;
  readonly digest: { readonly algorithm: 'sha256' | 'blake2b512'; readonly hex: string };
  readonly byteLength: number;
}
/** Only parameter/circuit assets, never wallet witnesses. Verify pinned digest/length
 * before parsing and on cache retrieval. No project CDN or implicit remote proving.
 */
export interface LocalProvingOptions {
  readonly kind: 'local';
  readonly assets: readonly AssetRequirement[];
  loadAsset(args: { requirement: AssetRequirement } & Op): Promise<Uint8Array>;
  readonly cache: { readonly kind: 'memory'; readonly maxBytes: number } | {
    readonly kind: 'persistent'; readonly namespace: string; readonly maxBytes: number;
  };
  readonly maxConcurrentProofs: 1;
}
export interface ConfirmationsPolicy {
  readonly trusted: number;
  readonly untrusted: number;
  readonly allowZeroConfirmationShielding: boolean;
}
/** Explicit Rust policy inputs; no default SpendPolicy admitting legacy funds. */
export interface TransactionPolicy {
  readonly spendPools: NonEmpty<Pool>;
  readonly transparent: 'disallow' | 'allow-owned';
  readonly changePool: ShieldedPool;
  readonly feeRule: 'zip317-standard';
  readonly confirmations: ConfirmationsPolicy;
  readonly expiry: { readonly kind: 'offset'; readonly blocks: number } | { readonly kind: 'disabled' };
  readonly lockExpiryBlocks: number;
  readonly shieldingThreshold: bigint;
  readonly freshness: { readonly mode: 'require-synced'; readonly maxLagBlocks: number } | {
    readonly mode: 'catch-up'; readonly maxLagBlocks: number; readonly timeoutMs: number;
  };
}
/** Startup recovery policy; specification only. See operations.md.
 * Omitted: online with a 15_000ms total pass deadline when light is supplied,
 * otherwise offline. Both load/reconcile ALL database operations locally.
 */
export type RecoveryPolicy
  = | { readonly mode: 'offline'; readonly rebroadcast?: never; readonly timeoutMs?: never }
    | {
      readonly mode: 'online';
      readonly timeoutMs: number; // positive safe integer; total network pass, not per operation
      /** Omitted = observe only. Requires light + broadcaster and stored consent.
     * Never grants first dispatch, rebuild, signing, proving or endpoint failover.
     * Supported explicit DB restore/import disables retry until fresh reconciliation/consent.
     * External copies/rollback may be undetectable; no cross-copy lifetime budget guarantee.
     */
      readonly rebroadcast?: {

        readonly mode: 'previously-dispatched';

        readonly maxAttempts: number; // positive per-step ceiling across ordinary opens of the non-rolled-back authoritative DB

        readonly minIntervalMs: number; // positive spacing; strictest adopted value persists

      };
    };
/** Immutable startup summary, not payment completion or a background job handle.
 * Counts are checked nonnegative safe integers, counting operations, not steps.
 */
export interface RecoveryReport {

  readonly local: 'complete';

  readonly operations: number; // all records in the captured database inventory

  readonly observation: 'offline' | 'complete' | 'incomplete'; // online complete iff no deferred observation candidates

  readonly observedOperations: number; // fully observed candidates, independent of later dispatch failure

  readonly deferredOperations: number; // candidates still needing observation, not failed dispatches

  readonly lastError: ErrorInfo | null; // last sanitized network/dispatch failure, even with complete observation; timeout uses TIMEOUT

}
export interface WalletOptions extends Op {
  readonly recovery?: RecoveryPolicy;
  readonly network: Network;
  readonly storage: WalletStorage;
  readonly runtime?: Partial<RuntimeOptions>;
  readonly confirmations: ConfirmationsPolicy; // applies to query accounting as well
  /** Omitted = no scan/startup observation route; never invent an endpoint. */
  readonly light?: LightClient;
  /** Omitted = no submission route, even if light is present. */
  readonly broadcaster?: PublicClient | LightClient;
  /** Omitted = no planning/send policy. Must match query confirmations. */
  readonly transactionPolicy?: TransactionPolicy;
  /** Omitted = bundled local proving assets, loaded on demand. A UFVK never grants spending authority. */
  readonly proving?: LocalProvingOptions;
  readonly observation: ObservationOptions;
}
/** Connected wallet defaults; storage is always an explicit durability choice. */
export interface WalletEndpointOptions extends
  Omit<WalletOptions, 'network' | 'light' | 'broadcaster' | 'confirmations' | 'observation'>,
  LightClientOptions {
  readonly confirmations?: ConfirmationsPolicy;
  readonly observation?: ObservationOptions;
}

export interface ViewKeyHandle extends Disposable {
  readonly [opaque]: 'viewing-handle';
  readonly kind: 'ufvk' | 'uivk';
}
export interface AccountDescriptor {
  readonly network: Network;
  readonly viewing: ViewKeyHandle;
  readonly components: readonly ReceiverType[];
  readonly enabledPools: readonly Pool[];
  readonly provenance: null | { readonly accountIndex: AccountIndex; readonly scheme: 'zip32-and-bip44' };
}
export interface AccountRecord {
  readonly id: AccountId;
  readonly name: string | null;
  readonly birthdayHeight: number;
  readonly accountIndex: AccountIndex | null;
  readonly viewOnly: boolean; // tracking only, never secret possession
  readonly signerAttached: boolean;
}
export interface Birthday {
  readonly network: Network;
  readonly firstScanHeight: number;
  readonly priorTreeState: Uint8Array;
  readonly recoverUntilExclusive?: number; // omitted = no recovery boundary
  readonly source: 'checkpoint' | 'light-client';
}
/** Mnemonic accounts use all supported pools; pool selection is not an onboarding option. */
export interface AccountCreate extends Op {
  readonly mnemonic: SecretInput; // UTF-8; all checksum-valid BIP39 12/15/18/21/24 counts
  readonly passphrase?: SecretInput; // omitted = empty BIP39 passphrase; NFKD required
  readonly name?: string; // omitted = null
}
export interface MnemonicImport extends AccountCreate {
  readonly accountIndex: AccountIndex;
  readonly birthday: Birthday | 'fullScan'; // never current-tip recovery
}
export interface ViewingImport extends Op {
  readonly viewingKey: string; // UFVK only; UIVK wallet import rejects
  readonly birthday: Birthday | 'fullScan';
  readonly name?: string; // omitted = null
  readonly viewOnly?: boolean; // default false; retains spend state, supplies no signer
  readonly enabledPools?: NonEmpty<Pool>; // omitted = all three, missing authority rejects
}
export interface CreatedAccount { readonly account: AccountRecord; readonly signer: MemorySigner }
export interface AccountsApi {
  /** No birthday argument: derive AccountBirthday internally from one coherent wallet DB
   * snapshot after explicit sync. No network request or implicit sync. Unavailable/stale
   * local chain/tree state fails SYNC_REQUIRED before mutation (see accounts-signers.md).
   * Zakura chooses the next seed-relative index.
   * Returned signer is caller-owned, memory-only and UNATTACHED.
   */
  create(args: AccountCreate): Promise<CreatedAccount>;
  import(args: MnemonicImport): Promise<CreatedAccount>;
  import(args: ViewingImport): Promise<AccountRecord>;
  list(args?: Op): Promise<readonly AccountRecord[]>;
  get(args: { accountId: AccountId } & Op): Promise<AccountRecord | null>;
  /** Reject unresolved operations/locks; local history deletion cannot erase funds. */
  remove(args: { accountId: AccountId; acknowledge: 'deletes-local-history' } & Op): Promise<void>;
  /** Restore caller-owned, unattached authority for an existing mnemonic-derived account.
   * Verifies the mnemonic/passphrase against its viewing key without changing wallet history.
   */
  restoreSigner(
    args: { accountId: AccountId; mnemonic: SecretInput; passphrase?: SecretInput } & Op,
  ): Promise<MemorySigner>;
  attachSigner(args: { accountId: AccountId; signer: Signer } & Op): Promise<SignerBinding>;
  detachSigner(args: { accountId: AccountId } & Op): Promise<void>;
}
export interface SignerBinding extends Disposable {
  readonly accountId: AccountId;
  readonly state: 'ready' | 'recovery-required'; // attachment cannot upgrade true view-only tracking
}
export type AddressRequest
  = | { readonly format: 'transparent' }
    | { readonly format: 'unified' }
    | ({ readonly format: 'unified'; readonly transparent: 'require' | 'omit' | 'allow' } & (
    { readonly sapling: 'require'; readonly ironwood: 'require' | 'omit' }
    | { readonly sapling: 'omit'; readonly ironwood: 'require' }
  ));
export interface AddressRecord {
  readonly address: string;
  readonly receiverTypes: readonly ReceiverType[];
  readonly intendedPools: readonly Pool[];
  readonly index: DiversifierIndex;
}
export interface AccountAddressArgs extends Op {
  readonly accountId: AccountId;
  /** Omitted or unified-only = AllAvailableKeys: links every available supported
   * receiver and permits transparent receipt. No required-receiver fallback.
   */
  readonly request?: AddressRequest;
}
export interface WalletAddressesApi {
  current(args: AccountAddressArgs): Promise<string | null>; // local read; never allocates
  next(args: AccountAddressArgs): Promise<AddressRecord>; // commits exposure before return
  list(args: { accountId: AccountId } & Op): Promise<readonly AddressRecord[]>;
  at(args: AccountAddressArgs & { index: DiversifierIndex }): Promise<AddressRecord>; // exact-index write
}
export interface ViewingApi {
  export(args: {
    account: AccountDescriptor;
    format: 'ufvk' | 'uivk';
    acknowledge: 'discloses-viewing-authority';
  } & Op): Promise<string>;
  toIncoming(args: { account: AccountDescriptor } & Op): Promise<AccountDescriptor>;
}
export interface DecodedAddress {
  readonly network: Network;
  readonly encoded: string;
  readonly knownReceivers: readonly ReceiverType[];
  readonly unknownTypecodes: readonly number[];
}
export interface SelectedReceiver { readonly pool: Pool; readonly type: ReceiverType; readonly bytes: Uint8Array }
export interface AddressApi {

  derive(
    args: { account: AccountDescriptor; index: DiversifierIndex; request?: AddressRequest } & Op
  ): Promise<AddressRecord>;

  find(
    args: { account: AccountDescriptor; start: DiversifierIndex; request?: AddressRequest; maxAttempts: number } & Op
  ): Promise<AddressRecord>;

  decode(args: { network: Network; address: string } & Op): Promise<DecodedAddress>;

  selectReceiver(
    args: { address: DecodedAddress; pool: Pool; context: ConsensusContext } & Op
  ): Promise<SelectedReceiver>;

}

/** Adapter negotiation tuples, not a caller configuration/support matrix.
 * No concrete Ledger adapter is included or claimed supported.
 */
export interface SignerCapabilities {
  readonly revision: string;
  readonly networks: readonly string[];
  readonly authorizations: readonly {
    readonly pool: Pool;
    readonly txVersion: number;
    readonly branchIds: readonly number[];
    readonly circuitVersions: readonly string[];
    readonly pcztVersions: readonly number[];
    readonly proofState: 'required' | 'not-required' | 'either';
    readonly requiredFields: readonly string[]; // versioned profile IDs, unknown values reject
    readonly review: 'device' | 'application';
  }[];
  readonly accountDiscovery: 'explicit-index' | 'enumeration' | 'imported-only';
  readonly exportableViewing: readonly ('ufvk' | 'uivk')[];
  readonly maxPcztBytes: number;
}
export type SignerSelector = { readonly kind: 'derived'; readonly accountIndex: AccountIndex }
  | { readonly kind: 'imported'; readonly keyId: string }
  | { readonly kind: 'fingerprint'; readonly fingerprint: string };
export interface Signer {
  getCapabilities(args?: Op): Promise<SignerCapabilities>;
  getAccount(args: { network: Network; selector: SignerSelector } & Op): Promise<AccountDescriptor>;
  authorize(args: SigningRequest & Op): Promise<SigningResult>;
}
/** Internal opaque USK access enables the fused local route; never exported bytes. */
export interface MemorySigner extends Signer, Disposable { readonly [opaque]: 'memory-signer' }
export interface SigningRequest {
  readonly requestId: string;
  readonly pczt: Uint8Array;
  readonly context: ConsensusContext;
  readonly accountIds: NonEmpty<AccountId>; // routing hints, never proof of correspondence
  readonly capabilityRevision: string;
  readonly reviewCommitment: string;
}
export interface SigningResult { readonly requestId: string; readonly pczt: Uint8Array }

export type MemoInput = { readonly text: string; readonly bytes?: never }
  | { readonly bytes: Uint8Array; readonly text?: never };
export interface Payment { readonly to: string; readonly amount: bigint; readonly memo?: MemoInput }
export type SendIntent = {
  readonly accountId: AccountId; readonly idempotencyKey?: string; readonly maxFee?: bigint;
} & ((Payment & { readonly payments?: never }) | {
  readonly payments: NonEmpty<Payment>; readonly to?: never; readonly amount?: never; readonly memo?: never;
});
export interface ShieldIntent {
  readonly accountId: AccountId;
  readonly fromAddresses?: readonly string[]; // omitted = eligible owned transparent addresses
  readonly toPool?: ShieldedPool; // omitted = configured changePool
  readonly threshold?: bigint; // omitted = configured shieldingThreshold
  readonly idempotencyKey?: string;
  readonly maxFee?: bigint; // omitted = no application fee ceiling; standard fee still applies
}
export interface ExecuteOptions extends Op { readonly signer?: Signer } // omitted = verified attached authority
export interface ReviewedInput {
  readonly accountId: AccountId;
  readonly pool: Pool;
  readonly source: { readonly kind: 'output'; readonly txid: TxId; readonly outputIndex: number }
    | { readonly kind: 'prior-step'; readonly stepIndex: number; readonly outputIndex: number };
  readonly value: bigint;
}
export interface ReviewedOutput {
  readonly accountId: AccountId | null;
  readonly pool: Pool;
  readonly address: string;
  readonly amount: bigint;
  readonly memo: MemoInput | null;
  readonly kind: 'payment' | 'change' | 'step-funding';
}
/** Recipient intent is exact; native construction may choose wallet-owned internal addresses later. */
export type ProposedOutput = Omit<ReviewedOutput, 'kind' | 'address'> & (
  | { readonly kind: 'payment'; readonly address: string }
  | { readonly kind: 'change' | 'step-funding'; readonly address: string | null }
);
export interface Proposal {
  readonly [opaque]: 'wallet-proposal';
  readonly operationId: string;
  readonly proposalId: string;
  readonly accountIds: NonEmpty<AccountId>; // durable wrapper metadata; not a native Proposal getter
  readonly context: ConsensusContext;
  readonly revision: string;
  readonly reviewCommitment: string;
  readonly totalFee: bigint;
  readonly lockExpiryHeight: number;
  readonly steps: NonEmpty<{
    readonly index: number;
    readonly dependsOn: readonly number[];
    readonly transactionVersion: number;
    readonly expiryHeight: number; // zero = disabled
    readonly inputs: readonly ReviewedInput[];
    readonly outputs: readonly ProposedOutput[];
    readonly fee: bigint;
  }>;
}
export interface PcztArtifact {
  readonly [opaque]: 'wallet-pczt';
  readonly outputs: readonly ReviewedOutput[]; // exact native-built outputs, available before external signing
  readonly operationId: string;
  readonly artifactId: string;
  readonly accountIds: NonEmpty<AccountId>;
  readonly proofsComplete: boolean;
  readonly authorizationComplete: boolean;
}
export interface PcztExchange { readonly operationId: string; readonly artifactId: string; readonly bytes: Uint8Array }
export interface WalletPcztApi {
  /** Single-step only; retain full copy, export minimum signer view. No approval by serialization. */

  export(
    args: ({ proposal: Proposal; pczt?: never } | { pczt: PcztArtifact; proposal?: never }) & Op
  ): Promise<PcztExchange>;
  /** Parse, check association/effects/signatures, combine retained full copy, persist new artifact.
   * Partial authorization is allowed. Unknown operation is never enrolled implicitly.
   */

  import(args: { operationId: string; bytes: Uint8Array } & Op): Promise<PcztArtifact>;

}
export interface PcztHandle extends Disposable { readonly [opaque]: 'standalone-pczt' }
export interface PcztInspection {
  readonly pcztVersion: number;
  readonly transactionVersion: number;
  readonly context: ConsensusContext;
  readonly pools: readonly Pool[];
  readonly proofsComplete: boolean;
  readonly authorizationComplete: boolean;
}
export interface PcztApi {
  parse(args: { bytes: Uint8Array; context: ConsensusContext; maxBytes: number } & Op): Promise<PcztHandle>;
  serialize(args: { pczt: PcztHandle } & Op): Promise<Uint8Array>;
  inspect(args: { pczt: PcztHandle } & Op): Promise<PcztInspection>;
  combine(args: { pczts: NonEmpty<PcztHandle> } & Op): Promise<PcztHandle>;
  redact(args: { pczt: PcztHandle; profile: string } & Op): Promise<PcztHandle>; // versioned qualified profile only
}

export interface SubmissionAttempt {
  readonly attemptId: string;
  readonly outcome: 'started' | 'acknowledged' | 'rejected' | 'unknown';
  readonly sourceId: string;
  readonly startedAt: string;
  readonly completedAt: string | null;
  readonly diagnosticCode: string | null;
}
export interface PaymentState {

  readonly operationId: string;

  readonly revision: string;

  readonly accountIds: NonEmpty<AccountId>;

  readonly durability: 'durable' | 'ephemeral';
  /** Journal presentation, NOT a linear proof/authorization pipeline. */

  readonly phase: 'proposed'
    | 'awaitingAuthorization'
    | 'building'
    | 'ready'
    | 'observing'
    | 'needsAttention'
    | 'complete'
    | 'abandoned';

  readonly missing: readonly ('proposal' | 'artifact' | 'authority' | 'provingMaterial' | 'finalizedBytes')[];

  readonly steps: readonly {
    readonly index: number;
    readonly dependsOn: readonly number[];
    readonly txid: TxId | null;
    readonly exactBytesSha256: string | null;
    readonly attempts: readonly SubmissionAttempt[];
    readonly inclusion: Inclusion | null;
    readonly observation: TransactionObservation | null;
    readonly expiry: {
      readonly height: number | null;
      readonly reached: boolean | null;
      readonly confirmedUnminedAt: number | null;
    };
    readonly blockedBy: readonly number[];
  }[];

}
export interface PaymentConfirmation {
  readonly operationId: string;
  readonly transactions: NonEmpty<ConfirmedTransaction>;
  readonly snapshot: PaymentState;
}
export interface PendingPayment {
  readonly operationId: string;
  snapshot(): Promise<PaymentState>; // local, no network
  events(args?: Op): AsyncIterable<PaymentState>;
  /** Explicit submission consent; reconcile then dispatch immutable bytes, parents first.
   * Records consent provenance for policy-approved later exact-byte retry; operations.md. */
  broadcast(args?: Op): Promise<PaymentState>;
  /** All required steps must have checked inclusion; reorg normally continues observation.
   * Timeout/abort retains latest state, never cancels a transaction or releases locks.
   */
  wait(args?: WaitOptions): Promise<PaymentConfirmation>;
}
export interface PageArgs {
  readonly cursor?: string; // omitted = first page
  readonly limit?: number; // default 50, maximum 200, positive integer
}
export interface OperationsApi {
  /** Atomically retire an unbuilt proposal and release only its input locks.
   * Local/offline and idempotent; any retained artifact or finalized transaction rejects.
   * The retained operation and idempotency key cannot be reused to execute a spend.
   */
  abandon(args: { operationId: string } & Op): Promise<PaymentState>;
  /** Wallet-wide if accountId omitted; never selects a spending account. */
  list(args?: PageArgs & Op & { accountId?: AccountId }): Promise<OperationPage>;
  get(args: { operationId: string } & Op): Promise<PaymentState | null>;
  /** Rehydrate behavior only; no propose/sign/broadcast or implicit signer prompt. */
  resume(args: { operationId: string } & Op): Promise<PendingPayment>;
}
export interface OperationPage {
  readonly items: readonly PaymentState[];
  readonly nextCursor: string | null;
  readonly revision: string;
}

export interface ScanState {
  readonly revision: string; // opaque epoch + sequence, never height/rowid/user_version
  readonly tipHeight: number | null;
  readonly fullyScannedHeight: number | null;
  readonly maxScannedHeight: number | null;
  readonly scanComplete: boolean | null;
}
export interface BalanceBuckets {
  readonly total: bigint;
  readonly spendable: bigint;
  readonly locked: bigint;
  readonly changePendingConfirmation: bigint;
  readonly pendingSpendability: bigint;
  readonly uneconomic: bigint;
}
export interface WalletBalance {
  readonly accountId: AccountId;
  readonly scan: ScanState;
  readonly amounts: null | {
    readonly total: bigint;
    readonly uneconomic: bigint;
    readonly observedTotal: bigint;
    readonly transparent: { readonly regular: BalanceBuckets; readonly coinbase: BalanceBuckets };
    readonly sapling: BalanceBuckets;
    readonly ironwood: BalanceBuckets;
    readonly unsupportedLegacy: null | { readonly kind: 'legacyOrchard'; readonly balance: BalanceBuckets };
  };
}
export type Memo = { readonly kind: 'unknown' | 'empty' }
  | { readonly kind: 'text'; readonly text: string }
  | { readonly kind: 'binary'; readonly bytes: Uint8Array };
export interface HistoryEntry {
  readonly accountId: AccountId;
  readonly txid: TxId;
  readonly balanceDelta: bigint; // signed, account-relative; sign alone is not direction
  readonly totalReceived: bigint;
  readonly totalSpent: bigint;
  readonly fee: bigint | null; // transaction-wide: never sum across accounts
  readonly minedHeight: number | null;
  readonly transactionIndex: number | null;
  readonly blockTime: number | null;
  readonly expiryHeight: number | null;
  readonly expiredAtMaxScannedHeight: boolean | null; // SQL classification, not consensus proof
  readonly isShielding: boolean | null;
  readonly poolCrossing: boolean | null;
  readonly pools: readonly Pool[];
  readonly unsupportedLegacy: 'legacyOrchard' | null;
}
export interface HistoryPage {
  readonly items: readonly HistoryEntry[];
  readonly nextCursor: string | null;
  readonly scan: ScanState;
  readonly historyComplete: 'unknown';
}
export type ObservedPool = Pool | 'legacyOrchard'; // historical data only; never selection/routing
export interface TransactionOutput {
  readonly txid: TxId;
  readonly pool: ObservedPool;
  readonly outputIndex: number;
  readonly value: bigint | null;
  readonly address: string | null;
  readonly addressSource: 'recorded' | 'recovered' | 'unknown';
  readonly memo: Memo;
  readonly isChange: boolean | null;
  readonly changeClassification: 'recorded' | 'heuristic' | 'unknown';
  readonly receivingAccountIds: readonly AccountId[]; // receipt projection explicitly filters accounts
  readonly sendingAccountIds: readonly AccountId[];
}
export interface WalletTransaction {
  readonly txid: TxId;
  readonly raw: Uint8Array | null; // known but not enhanced is different from absent record
  readonly accounts: readonly HistoryEntry[];
  readonly outputs: readonly TransactionOutput[]; // deduplicated by pool/index
  readonly scan: ScanState;
}
export type SpendState = 'unspent' | 'pendingSpend' | 'spent' | 'unknown';
export interface InventoryFilter {
  readonly spendState?: SpendState; // omitted = all known states, including spent/unknown
  readonly locked?: boolean; // omitted = all, including unknown lock state
  readonly uneconomic?: boolean; // omitted = all, including unknown classification
}
export interface InventoryState {
  readonly accountId: AccountId;
  readonly value: bigint;
  readonly minedHeight: number | null;
  readonly coinbase: boolean | null;
  readonly lock: null | { readonly operationId: string | null; readonly expiresAtHeight: number | null };
  readonly lockKnown: boolean;
  readonly spendState: SpendState;
  readonly spendingTxid: TxId | null;
  readonly uneconomic: boolean | null;
  readonly eligibility: 'unknown'; // until complete Rust classifier is validated
}
export interface WalletNote extends InventoryState {
  readonly txid: TxId; readonly pool: ShieldedPool; readonly outputIndex: number;
}
export interface WalletUtxo extends InventoryState {
  readonly txid: TxId; readonly outputIndex: number; readonly address: string | null;
}
export interface NotePage {
  readonly items: readonly WalletNote[];
  readonly nextCursor: string | null;
  readonly scan: ScanState;
  readonly unsupportedLegacyRowsOmitted: boolean;
}
export interface UtxoPage {
  readonly items: readonly WalletUtxo[];
  readonly nextCursor: string | null;
  readonly scan: ScanState;
  readonly unsupportedLegacyRowsOmitted: boolean;
}
export interface SyncStatus {
  readonly activity: 'idle' | 'running' | 'stopped' | 'failed';
  readonly scan: ScanState;
  readonly target: ChainPoint | null;
  readonly targetReached: boolean;
  readonly enhancement: { readonly actionable: number; readonly delayed: number };
  readonly workEstimate: null | {
    readonly completed: bigint;
    readonly total: bigint | null;
    readonly scope: 'backend-sapling-orchard-only'; // excludes Ironwood, not overall percentage
  };
  readonly lastError: ErrorInfo | null;
}
export interface WalletClient {

  readonly recovery: RecoveryReport; // startup-only summary; current state is in operations

  readonly network: Network;

  readonly accounts: AccountsApi;

  readonly addresses: WalletAddressesApi;

  readonly pczt: WalletPcztApi;

  readonly operations: OperationsApi;
  /** Creation/storage + initial ordered attempt pass, NOT mining. Durable storage
   * commits operation/finalized bytes before dispatch; explicit memory storage
   * reports `ephemeral` and cannot promise restart recovery. Local execution is
   * fused and supports backend multi-step dependencies. Custom authority uses
   * single-step PCZT; reject multi-step before disclosure, retaining operation ID.
   * Supplied proposal executes EXACTLY that plan; never reselect/reprice/reprove on retry.
   * Submission grants recorded consent bound to exact bytes/route; later startup
   * retries additionally require explicit RecoveryPolicy opt-in (operations.md).
   */

  send(
    args: (SendIntent
      | {
        proposal: Proposal;
        accountId?: never;
        to?: never;
        amount?: never;
        payments?: never;
      })
      & ExecuteOptions
  ): Promise<PendingPayment>;

  shield(args: ShieldIntent & ExecuteOptions): Promise<PendingPayment>;

  propose(args: (SendIntent | ({ kind: 'shield' } & ShieldIntent)) & Op): Promise<Proposal>;
  /** The next four methods are PCZT roles only, not resumable local build stages. */

  build(args: { proposal: Proposal } & Op): Promise<PcztArtifact>;

  prove(args: { pczt: PcztArtifact } & Op): Promise<PcztArtifact>;

  sign(args: { pczt: PcztArtifact } & ExecuteOptions): Promise<PcztArtifact>;

  finalize(args: { pczt: PcztArtifact } & Op): Promise<PendingPayment>; // verify/store/outbox, no network
  /** Explicit submission consent for this operation; exact-byte/route binding as pending.broadcast. */

  broadcast(args: { operationId: string } & Op): Promise<PaymentState>;

  getBalance(args: { accountId: AccountId } & Op): Promise<WalletBalance>;

  getHistory(args: { accountId: AccountId } & PageArgs & Op): Promise<HistoryPage>;

  getTransaction(args: { txid: TxId } & Op): Promise<WalletTransaction | null>; // wallet-wide

  listNotes(args: { accountId: AccountId; pool?: ShieldedPool } & InventoryFilter & PageArgs & Op): Promise<NotePage>;

  listUtxos(args: { accountId: AccountId } & InventoryFilter & PageArgs & Op): Promise<UtxoPage>;
  /** Captures finite verified target if omitted; required fetch failure rejects with progress.
   * Cancellation returns stopped status at a safe commit boundary. Target pinning
   * unsupported by source fails explicitly; enhancement pass is part of completion.
   */

  sync(args?: { target?: ChainPoint } & Op): Promise<SyncStatus>;

  watchSync(args?: Op): AsyncIterable<SyncStatus>; // shared continuous runner; plain status records

  getSyncStatus(args?: Op): Promise<SyncStatus>; // local read only

  close(): Promise<void>; // idempotent; flush, detach, invalidate; injected resources remain caller-owned

}

/** ACCOUNT_BUSY, INVALID_AUTHORIZATION and REVIEW_MISMATCH are reserved for compatibility;
 * the bundled runtime does not currently emit them. */
export type ErrorCode = 'INVALID_ARGUMENT' | 'INVALID_MNEMONIC' | 'ENTROPY_UNAVAILABLE'
  | 'NETWORK_MISMATCH' | 'PROTOCOL_MISMATCH' | 'METHOD_NOT_SUPPORTED' | 'UNSUPPORTED_POOL'
  | 'UNSUPPORTED_VERSION' | 'TRANSPORT_ERROR' | 'OBSERVATION_UNAVAILABLE' | 'TARGET_PINNING_UNSUPPORTED'
  | 'ACCOUNT_NOT_FOUND' | 'ACCOUNT_KEY_MISMATCH' | 'ACCOUNT_COLLISION' | 'ACCOUNT_BUSY'
  | 'FULL_VIEWING_KEY_REQUIRED' | 'INCOMING_ONLY_WALLET_UNSUPPORTED' | 'RECOVERY_REQUIRED'
  | 'RECEIVER_UNAVAILABLE' | 'INVALID_DIVERSIFIER' | 'DIVERSIFIER_EXHAUSTED' | 'ADDRESS_SEARCH_LIMIT'
  | 'ADDRESS_ALREADY_EXPOSED' | 'DISCOVERY_RANGE_UNSAFE' | 'SIGNER_REQUIRED'
  | 'SIGNER_CAPABILITY_MISMATCH' | 'SIGNER_REJECTED' | 'INVALID_AUTHORIZATION'
  | 'SYNC_REQUIRED' | 'INSUFFICIENT_FUNDS' | 'NOTHING_TO_SHIELD' | 'FEE_LIMIT_EXCEEDED'
  | 'STALE_PROPOSAL' | 'INPUT_LOCKED' | 'IDEMPOTENCY_CONFLICT' | 'PCZT_MULTI_STEP_UNSUPPORTED'
  | 'INVALID_PCZT' | 'PCZT_ASSOCIATION_MISMATCH' | 'REVIEW_MISMATCH' | 'ROLE_PRECONDITION'
  | 'PROVING_MATERIAL_REQUIRED' | 'ASSET_UNAVAILABLE' | 'ASSET_INTEGRITY' | 'PROOF_FAILED'
  | 'NOT_FINALIZED' | 'OPERATION_NOT_FOUND' | 'PAYMENT_BLOCKED' | 'TRANSACTION_EXPIRED'
  | 'SUBMISSION_REJECTED' | 'SUBMISSION_UNKNOWN' | 'CURSOR_STALE' | 'STORAGE_ERROR'
  | 'STORAGE_BUSY' | 'STORAGE_QUOTA' | 'MIGRATION_REQUIRED' | 'RUNTIME_UNAVAILABLE'
  | 'WORKER_CRASHED' | 'RESOURCE_LIMIT' | 'STALE_HANDLE' | 'WRONG_INSTANCE' | 'CLOSED'
  | 'TIMEOUT' | 'ABORTED';
export interface ErrorInfo {
  readonly code: ErrorCode;
  readonly stage: 'validation' | 'transport' | 'storage' | 'runtime' | 'account' | 'address'
    | 'query' | 'sync' | 'proposal' | 'authorization' | 'proving' | 'finalization' | 'submission' | 'observation';
  readonly retryable: boolean; // never permission to repeat a spend or device prompt
  readonly recovery: 'correct-input' | 'configure' | 'sync' | 'reattach-signer' | 'review-new-proposal'
    | 'resume-operation' | 'reconcile-exact-bytes' | 'reopen' | 'restore' | 'none';
  readonly message: string; // sanitized, no raw foreign cause/payload/endpoint
}
export interface ZcashError extends Error, ErrorInfo {
  readonly message: string; // reconcile Error.message with the readonly diagnostic contract
  readonly operationId?: string; // present only if allocated
  readonly paymentState?: PaymentState; // latest partial result, sensitive; never auto-log
  readonly syncStatus?: SyncStatus;
  readonly observation?: TransactionObservation;
}

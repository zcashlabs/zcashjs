import type {
  AccountId,
  Network,
  Op,
  Pool,
  Proposal,
  ProposedOutput,
  PcztArtifact,
  ReviewedOutput,
  TransactionPolicy,
  WalletPcztApi,
  LocalProvingOptions,
} from '../types.js';
import type { openWalletRuntime } from '../runtime/wallet.js';
import { ProvingAssets } from './proving-assets.js';
import { operation } from '../clients/light-chain-reads.js';
import { networkBinding } from '../network.js';
import { failure, invalidArgument } from '../errors.js';
import { ownBytes, snapshot } from '../clients/owned-plumbing.js';
import { pczt } from '../pczt.js';
import type { NativeFinalized } from './payment-journal-types.js';
import type { memorySignerAuthority } from './memory-signer.js';

export type NativeProposalIntent = {
  readonly accountId: AccountId;
  readonly idempotencyKey?: string;
  readonly policy: Omit<TransactionPolicy, 'freshness' | 'shieldingThreshold'>;
  readonly maxFee?: bigint;
} & ({
  readonly kind?: never;
  readonly payments: readonly { readonly to: string; readonly amount: bigint; readonly memo?: Uint8Array | null }[];
} | { readonly kind: 'shield'; readonly threshold: bigint; readonly fromAddresses?: readonly string[] });
export type NativeProposalInput = NativeProposalIntent & { readonly revision: string };
export interface NativeProposalReview {
  readonly operationId: string;
  readonly proposalId: string;
  readonly reviewCommitment: string;
  readonly accountId: AccountId;
  readonly revision: string;
  readonly targetHeight: number;
  readonly branchId: number;
  readonly expiryHeight: number;
  readonly lockExpiryHeight: number;
  readonly totalFee: bigint;
  readonly steps: readonly (Omit<Proposal['steps'][number], 'outputs'> & {
    readonly outputs: readonly {
      readonly accountId: AccountId | null;
      readonly pool: Pool;
      readonly address: string | null;
      readonly amount: bigint;
      readonly memo: Uint8Array | null;
      readonly kind: 'payment' | 'change' | 'step-funding';
    }[];
  })[];
}
export interface NativePcztBuildInput {
  readonly operationId: string;
  readonly proposalId: string;
  readonly reviewCommitment: string;
}
export interface NativePcztArtifact {
  readonly operationId: string;
  readonly artifactId: string;
  readonly accountId: AccountId;
  readonly outputs: readonly (Omit<ReviewedOutput, 'memo'> & { readonly memo: Uint8Array | null })[];
  readonly requiresSaplingProofs?: boolean;
  readonly requiresIronwoodProof?: boolean;
  readonly requiresOrchardProof?: boolean;
  readonly bytes: Uint8Array;
  readonly proofsComplete: boolean;
  readonly authorizationComplete: boolean;
}
export interface ProposalInventoryInput {
  readonly afterSequence: string;
  readonly highWater?: string;
  readonly limit: number;
}
export interface ProposalInventory {
  readonly highWater: string;
  readonly items: readonly { readonly sequence: string; readonly operationId: string }[];
}
type Session = Awaited<ReturnType<typeof openWalletRuntime>>['session'];
const proposals = new WeakMap<
  Proposal,
  Readonly<{ session: Session; operationId: string; proposalId: string; reviewCommitment: string }>
>();
const artifacts = new WeakMap<PcztArtifact, Readonly<{ session: Session; operationId: string; artifactId: string }>>();
const protocol = () => failure(
  'PROTOCOL_MISMATCH',
  'proposal',
  'reopen',
  'Native proposal review does not match its context.',
);

/** Private composition after wallet policy/freshness admission; not WalletClient.propose. */
export class WalletProposals {
  private readonly proving?: ProvingAssets;
  private reserved = false;
  constructor(
    private readonly session: Session,
    private readonly network: Network,
    proving?: LocalProvingOptions,
    packageOwned = false,
  ) {
    networkBinding(network);
    if (proving) this.proving = new ProvingAssets(proving, packageOwned);
  }

  private project(value: NativeProposalReview): Proposal {
    const bound = networkBinding(this.network);
    if (![value.operationId, value.proposalId, value.reviewCommitment].every(
      id => typeof id === 'string' && /^[0-9a-f]{64}$/.test(id),
    )

    || !value.steps.length
    || bound.codec.consensusContext(
      bound.definition.parametersFormat,
      bound.definition.parameters.bytes,
      value.targetHeight,
    ).branchId !== value.branchId) throw protocol();
    const context = Object.freeze({
      network: this.network,
      targetHeight: value.targetHeight,
      branchId: value.branchId,
    });
    const steps = value.steps.map(step => Object.freeze({
      ...step,
      dependsOn: Object.freeze([...step.dependsOn]),
      inputs: Object.freeze(
        step.inputs.map(input => Object.freeze({ ...input, source: Object.freeze({ ...input.source }) })),
      ),
      outputs: Object.freeze(step.outputs.map((output) => {
        if (output.kind === 'payment' && output.address === null) throw protocol();
        const bytes = output.memo === null ? null : ownBytes(output.memo, protocol, protocol, 512);
        const memo = bytes === null
          ? null
          : Object.freeze({
              get bytes() {
                return bytes.slice();
              },
            });
        return Object.freeze({ ...output, memo }) as ProposedOutput;
      })),
    }));
    const result = Object.freeze({
      operationId: value.operationId,
      proposalId: value.proposalId,
      accountIds: Object.freeze([value.accountId]),
      context,
      revision: value.revision,
      reviewCommitment: value.reviewCommitment,
      totalFee: value.totalFee,
      lockExpiryHeight: value.lockExpiryHeight,
      steps: Object.freeze(steps),
    }) as unknown as Proposal;
    proposals.set(
      result,
      Object.freeze({
        session: this.session,
        operationId: value.operationId,
        proposalId: value.proposalId,
        reviewCommitment: value.reviewCommitment,
      }),
    );
    return result;
  }

  async create(args: NativeProposalInput & Op): Promise<Proposal> {
    const value = await this.session.proposals.create(args);
    try {
      return this.project(value);
    } catch (error) {
      const rejected = typeof error === 'object' && error !== null ? error : protocol();
      this.session.committed(rejected, value);
      throw rejected;
    }
  }

  async lookup(args: NativeProposalIntent & { idempotencyKey: string } & Op): Promise<Proposal | null> {
    const value = await this.session.proposals.lookup(args);
    return value === null ? null : this.project(value);
  }

  async restore(args: { operationId: string } & Op): Promise<Proposal | null> {
    const value = await this.session.proposals.get(args);
    return value === null ? null : this.project(value);
  }

  async build(args: { proposal: Proposal } & Op): Promise<PcztArtifact> {
    const input = snapshot(args, ['proposal', 'signal']),
      binding = proposalBinding(input.proposal, this.session);
    const value = await this.session.pczt.build({
      ...binding,
      ...(input.signal === undefined ? {} : { signal: input.signal }),
    });
    return this.projectArtifact(value, binding.operationId, input.proposal.accountIds[0]);
  }

  private async sapling(signal: AbortSignal) {
    if (!this.proving) {
      throw failure(
        'PROVING_MATERIAL_REQUIRED',
        'finalization',
        'configure',
        'Local verification assets are not configured.',
      );
    }
    this.session.pczt.checkProvingAssets();
    if (!this.reserved) {
      this.session.pczt.reserveProving(this.proving.cacheReservation, () => this.proving!.close());
      this.reserved = true;
    }
    const release = this.session.pczt.reserveProving(this.proving.workingReservation, () => this.proving!.close());
    try {
      return { assets: await this.proving.sapling(signal), release };
    } catch (error) {
      release();
      throw error;
    }
  }

  async execute(
    wallet: Awaited<ReturnType<typeof openWalletRuntime>>,
    authority: NonNullable<ReturnType<typeof memorySignerAuthority>>,
    args: { proposal: Proposal } & Op,
  ) {
    const input = snapshot(args, ['proposal', 'signal']),
      binding = proposalBinding(input.proposal, this.session),
      pending = operation(input.signal);
    let release: (() => void) | undefined,
      working: (() => void) | undefined;
    try {
      pending.check();
      if (wallet.session !== this.session) {
        throw failure(
          'WRONG_INSTANCE',
          'authorization',
          'correct-input',
          'Proposal belongs to another wallet.',
        );
      }
      authority.checkWallet(wallet);
      release = this.session.pczt.startProof();
      const prepared = await this.sapling(pending.signal);
      working = prepared.release;
      pending.check();
      return await authority.execute(wallet, { ...binding, ...prepared.assets, signal: pending.signal });
    } finally {
      working?.();
      release?.();
      pending.close();
    }
  }

  async finalize(args: { pczt: PcztArtifact } & Op): Promise<NativeFinalized> {
    const input = snapshot(args, ['pczt', 'signal']),
      binding = pcztArtifactBinding(input.pczt, this.session),
      pending = operation(input.signal);
    let working: (() => void) | undefined,
      release: (() => void) | undefined;
    try {
      pending.check();
      const stored = await this.session.pczt.finalized({ operationId: binding.operationId, signal: pending.signal });
      if (stored.operationId !== binding.operationId || !Array.isArray(stored.transactions)) throw protocol();
      if (stored.transactions.length) {
        const prior = stored.transactions[0]!;
        if (stored.transactions.length !== 1 || prior.stepIndex !== 0
          || prior.artifactId !== binding.artifactId) {
          throw failure(
            'PCZT_ASSOCIATION_MISMATCH',
            'finalization',
            'correct-input',
            'A different artifact was already finalized.',
          );
        }
        return { ...prior, stepIndex: 0, artifactId: binding.artifactId };
      }
      release = this.session.pczt.startProof();
      const retained = await this.session.pczt.get({ ...binding, signal: pending.signal }),
        proposal = await this.restore({ operationId: binding.operationId, signal: pending.signal });
      if (!retained || !proposal) throw protocol();
      const handle = await pczt.parse({
        bytes: retained.bytes,
        context: proposal.context,
        maxBytes: this.session.pczt.maximum,
        signal: pending.signal,
      });
      let needsSapling: boolean;
      try {
        needsSapling = (await pczt.inspect({ pczt: handle, signal: pending.signal })).pools.includes('sapling');
      } finally {
        await handle.dispose();
      }
      let assets: { spend: Uint8Array; output: Uint8Array } = { spend: new Uint8Array(), output: new Uint8Array() };
      if (needsSapling) {
        const prepared = await this.sapling(pending.signal);
        assets = prepared.assets;
        working = prepared.release;
      }
      pending.check();
      return await this.session.pczt.finalize({ ...binding, ...assets, signal: pending.signal });
    } finally {
      working?.();
      release?.();
      pending.close();
    }
  }

  async prove(args: { pczt: PcztArtifact } & Op): Promise<PcztArtifact> {
    const input = snapshot(args, ['pczt', 'signal']),
      binding = pcztArtifactBinding(input.pczt, this.session);
    const pending = operation(input.signal);
    let release: (() => void) | undefined,
      working: (() => void) | undefined;
    try {
      pending.check();
      if (!this.proving) {
        throw failure(
          'PROVING_MATERIAL_REQUIRED',
          'proving',
          'configure',
          'Local proving is not configured.',
        );
      }
      release = this.session.pczt.startProof();
      const retained = await this.session.pczt.get({ ...binding, signal: pending.signal });
      pending.check();
      if (!retained) throw protocol();
      if ([
        retained.requiresSaplingProofs,
        retained.requiresIronwoodProof,
        retained.requiresOrchardProof,
      ].some(value => typeof value !== 'boolean')) throw protocol();
      if (retained.requiresOrchardProof) {
        throw failure(
          'ROLE_PRECONDITION',
          'proving',
          'correct-input',
          'Legacy Orchard proving is unsupported.',
        );
      }
      let assets: { spend: Uint8Array; output: Uint8Array } = { spend: new Uint8Array(), output: new Uint8Array() };
      if (retained.requiresSaplingProofs) {
        const prepared = await this.sapling(pending.signal);
        working = prepared.release;
        assets = prepared.assets;
      }
      pending.check();
      const value = await this.session.pczt.prove({ ...binding, ...assets, signal: pending.signal });
      return this.projectArtifact(value, binding.operationId, input.pczt.accountIds[0]);
    } finally {
      working?.();
      release?.();
      pending.close();
    }
  }

  async import(args: Parameters<WalletPcztApi['import']>[0]): Promise<PcztArtifact> {
    const input = snapshot(args, ['operationId', 'bytes', 'signal']);
    // Host admission owns the bounded byte copy before queuing native work.
    const value = await this.session.pczt.import(input);
    return this.projectArtifact(value, input.operationId);
  }

  async export(args: Parameters<WalletPcztApi['export']>[0]): ReturnType<WalletPcztApi['export']> {
    const input = snapshot(args, ['proposal', 'pczt', 'signal']);
    if (Object.hasOwn(input, 'proposal') === Object.hasOwn(input, 'pczt')) throw invalidArgument();
    const op = input.signal === undefined ? {} : { signal: input.signal };
    if (Object.hasOwn(input, 'proposal')) {
      const artifact = await this.build({ proposal: input.proposal!, ...op });
      try {
        return await this.export({ pczt: artifact, ...op });
      } catch (error) {
        if (error && typeof error === 'object') this.session.committed(error, artifact);
        throw error;
      }
    }
    const binding = pcztArtifactBinding(input.pczt!, this.session);
    const proposal = await this.restore({ operationId: binding.operationId, ...op });
    if (!proposal) throw protocol();
    const retained = await this.session.pczt.get({ ...binding, ...op });
    if (!retained || retained.operationId !== binding.operationId
      || retained.artifactId !== binding.artifactId) throw protocol();
    const handle = await pczt.parse({
      bytes: retained.bytes,
      context: proposal.context,
      maxBytes: this.session.pczt.maximum,
      ...op,
    });
    try {
      const redacted = await pczt.redact({ pczt: handle, profile: 'zakura-signer-full/1', ...op });
      try {
        return { ...binding, bytes: await pczt.serialize({ pczt: redacted, ...op }) };
      } finally {
        await redacted.dispose();
      }
    } finally {
      await handle.dispose();
    }
  }

  private projectArtifact(value: NativePcztArtifact, operationId: string, accountId?: AccountId): PcztArtifact {
    try {
      if (value.operationId !== operationId || !/^[0-9a-f]{64}$/.test(value.artifactId)

        || typeof value.accountId !== 'string'
        || !value.accountId
        || (accountId !== undefined && value.accountId !== accountId)
        || typeof value.proofsComplete !== 'boolean'
        || typeof value.authorizationComplete !== 'boolean'
        || !Array.isArray(value.outputs) || value.outputs.length > 256) throw protocol();
      const outputs = value.outputs.map((output) => {
        if (typeof output.address !== 'string' || !output.address
          || typeof output.amount !== 'bigint'
          || output.amount < 0n

          || !['transparent', 'sapling', 'ironwood'].includes(output.pool)
          || !['payment', 'change', 'step-funding'].includes(output.kind)) throw protocol();
        const bytes = output.memo === null ? null : ownBytes(output.memo, protocol, protocol, 512);
        return Object.freeze({
          ...output,
          memo: bytes === null
            ? null
            : Object.freeze({
                get bytes() {
                  return bytes.slice();
                },
              }),
        });
      });
      const result = Object.freeze({
        operationId: value.operationId,
        artifactId: value.artifactId,
        accountIds: Object.freeze([value.accountId]),
        outputs: Object.freeze(outputs),
        proofsComplete: value.proofsComplete,
        authorizationComplete: value.authorizationComplete,
      }) as unknown as PcztArtifact;
      artifacts.set(
        result,
        Object.freeze({ session: this.session, operationId: value.operationId, artifactId: value.artifactId }),
      );
      return result;
    } catch (error) {
      const rejected = typeof error === 'object' && error !== null ? error : protocol();
      this.session.committed(rejected, value);
      throw rejected;
    }
  }

  list(args: ProposalInventoryInput & Op): Promise<ProposalInventory> {
    return this.session.proposals.list(args);
  }
}

/** Execution uses only retained native IDs, never the caller-visible effect fields. */
export function proposalBinding(proposal: Proposal, session: Session) {
  const value = proposals.get(proposal);
  if (!value) throw invalidArgument();
  if (value.session !== session) {
    throw failure(
      'WRONG_INSTANCE',
      'proposal',
      'none',
      'Proposal belongs to another wallet instance.',
    );
  }
  session.check();
  return Object.freeze({
    operationId: value.operationId,
    proposalId: value.proposalId,
    reviewCommitment: value.reviewCommitment,
  });
}

/** Native retained artifact identity, never caller-visible output fields. */
export function pcztArtifactBinding(artifact: PcztArtifact, session: Session) {
  const value = artifacts.get(artifact);
  if (!value) throw invalidArgument();
  if (value.session !== session) {
    throw failure(
      'WRONG_INSTANCE',
      'proposal',
      'none',
      'PCZT belongs to another wallet instance.',
    );
  }
  session.check();
  return Object.freeze({ operationId: value.operationId, artifactId: value.artifactId });
}

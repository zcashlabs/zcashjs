import assert from 'node:assert/strict';
import test from 'node:test';
import { syncWallet, WalletSync } from '../../dist/src/wallet/sync.js';
import { failure } from '../../dist/src/errors.js';

function recoveryFixture() {
  const hash = '03'.repeat(32), target = { height: 2, hash };
  const control = { scanned: 0, revision: 0, ingests: 0, pins: 0, tips: 0, plans: 0 };
  const session = { scan: {
    async state() { return { revision: String(control.revision), maxScannedHeight: control.scanned, fullyScannedHeight: control.scanned }; },
    async block({ height }) { return { revision: String(control.revision), point: { height, hash } }; },
    async plan() { control.plans++; return { revision: String(control.revision), ranges: control.scanned === 2 ? [] : [{ start: control.scanned + 1, endExclusive: 3, priorState: { hash } }] }; },
    async ingest({ revision, blocks }) {
      if (revision !== String(control.revision)) throw failure('CURSOR_STALE', 'sync', 'sync', 'Stale plan.');
      control.ingests++; control.scanned += blocks.length; control.revision++;
    },
    async complete({ revision }) { assert.equal(revision, String(control.revision)); },
  }, enhancement: { async requests() { return { revision: String(control.revision), requests: [] }; } } };
  const light = {
    async getTip() { control.tips++; return target; },
    async getTreeState({ height }) { if (height === 2) control.pins++; return { point: { height, hash }, encoded: new Uint8Array() }; },
    async *streamCompactBlocks({ fromHeight, toHeight }) {
      for (let height = fromHeight; height <= toHeight; height++) yield { point: { height, hash }, encoded: new Uint8Array([height]) };
    },
  };
  return { control, session, light, target, owner: new WalletSync(session, light, { pollIntervalMs: 5, maxBufferedUpdates: 8 }) };
}

function enhancementRaceFixture({ historical = false, stale = false } = {}) {
  const hash = '03'.repeat(32), request = { kind: 'address', address: 'unused', start: 1,
    endExclusive: null, requestAt: null, txStatus: 'all', outputStatus: 'unspent' };
  let scanned = 20, revision = 0, outstanding = true, tipReads = 0, applied = 0, plans = 0;
  const session = { scan: {
    async state() { return { revision: String(revision), tipHeight: scanned,
      fullyScannedHeight: scanned, maxScannedHeight: scanned, scanComplete: true }; },
    async block({ height }) { return { revision: String(revision), point: height <= scanned ? { height, hash } : null }; },
    async plan({ target }) { plans++; return { revision: String(revision),
      ranges: scanned >= target.height ? [] : [{ start: scanned + 1, endExclusive: target.height + 1, priorState: { hash } }] }; },
    async ingest({ blocks }) { scanned += blocks.length; revision++; },
    async complete({ target }) { assert.equal(target.height, scanned); },
  }, enhancement: {
    async requests() { return { revision: String(revision), requests: outstanding ? [request] : [] }; },
    async apply({ revision: expected }) {
      assert.equal(expected, String(revision)); applied++; outstanding = false;
      return { revision: String(++revision) };
    },
  } };
  const light = {
    async getTip() {
      tipReads++;
      if (stale && tipReads === 2) revision++;
      return { height: stale ? 20 : historical || tipReads > 1 ? 21 : 20,
        hash, sourceId: 'source', observedAt: 'fixture' };
    },
    async getTreeState({ height }) { return { point: { height, hash }, encoded: new Uint8Array() }; },
    async *streamCompactBlocks({ fromHeight, toHeight }) {
      for (let height = fromHeight; height <= toHeight; height++) yield { point: { height, hash }, encoded: new Uint8Array([1]) };
    },
    async getAddressUtxos() { return { items: [], tip: null, sourceId: 'source', observedAt: 'fixture' }; },
  };
  return { owner: new WalletSync(session, light, { pollIntervalMs: 5, maxBufferedUpdates: 16 }),
    session, light, state: () => ({ outstanding, applied, plans, scanned, tipReads }) };
}

test('finite scan defers post-scan extension and leaves its native request outstanding', async () => {
  const f = enhancementRaceFixture();
  const result = await f.owner.sync();
  assert.equal(result.targetReached, true);
  assert.equal(result.target.height, 20);
  assert.equal(result.enhancement.actionable, 1);
  assert.equal(f.state().applied, 0);
});

test('explicit historical target is not advanced to satisfy enhancement', async () => {
  const f = enhancementRaceFixture({ historical: true });
  const result = await f.owner.sync({ target: { height: 20, hash: '03'.repeat(32) } });
  assert.equal(result.targetReached, true);
  assert.equal(result.target.height, 20);
  assert.equal(f.state().scanned, 20);
  assert.equal(f.state().applied, 0);
});

test('watchSync survives deferred enhancement and resolves it on the next scan', async () => {
  const f = enhancementRaceFixture();
  const watcher = f.owner.watchSync({ signal: AbortSignal.timeout(2000) });
  try {
    for await (const result of watcher) {
      if (result.targetReached && result.target.height === 21) break;
    }
    assert.equal(f.state().scanned, 21);
    assert.equal(f.state().applied, 1);
    assert.equal(f.state().outstanding, false);
  } finally { await watcher.return(); await f.owner.stop(); }
});

test('enhancement revision race replans rather than reporting native recovery failure', async () => {
  const f = enhancementRaceFixture({ stale: true });
  assert.equal((await f.owner.sync()).targetReached, true);
  assert.equal(f.state().plans, 2);
  assert.equal(f.state().applied, 1);
});

test('mid-batch source change restarts ancestor validation and completes without ingesting inconsistent data', async () => {
  const f = recoveryFixture(), read = f.light.getTreeState;
  let changed = false;
  f.light.getTreeState = async args => {
    if (args.height === 0 && !changed) { changed = true; return { point: { height: 0, hash: '04'.repeat(32) } }; }
    return read(args);
  };
  const result = await f.owner.sync();
  assert.equal(result.targetReached, true);
  assert.equal(f.control.tips, 2);
  assert.equal(f.control.ingests, 1);
});

test('automatic targets may be re-pinned but explicit targets never change', async () => {
  for (const explicit of [false, true]) {
    const f = recoveryFixture();
    const old = { ...f.target, hash: '04'.repeat(32) };
    f.light.getTip = async () => ++f.control.tips === 1 ? old : f.target;
    if (explicit) {
      await assert.rejects(f.owner.sync({ target: old }), error => error.code === 'SYNC_REQUIRED'
        && error.retryable && error.message.includes('target pin') && !error.syncStatus.targetReached);
      assert.equal(f.control.tips, 0);
      assert.equal(f.control.pins, 3);
      assert.equal(f.control.ingests, 0);
      assert.deepEqual((await f.owner.getSyncStatus()).target, old);
    } else {
      assert.equal((await f.owner.sync()).targetReached, true);
      assert.equal(f.control.tips, 2);
    }
  }
});

test('revision changed between plan and ingest is discarded and replanned with bounded contention', async () => {
  for (const persistent of [false, true]) {
    const f = recoveryFixture(), stream = f.light.streamCompactBlocks;
    let changes = 0;
    f.light.streamCompactBlocks = async function* (args) {
      if (persistent || changes === 0) { changes++; f.control.revision++; }
      yield* stream(args);
    };
    if (persistent) {
      await assert.rejects(syncWallet(f.session, f.light, f.target), { code: 'CURSOR_STALE' });
      assert.equal(changes, 3);
      assert.equal(f.control.ingests, 0);
    } else {
      await syncWallet(f.session, f.light, f.target);
      assert.equal(changes, 1);
      assert.equal(f.control.ingests, 1);
      assert.equal(f.control.scanned, 2);
    }
  }
});

test('malformed block order is not retried as chain movement', async () => {
  const f = recoveryFixture();
  f.light.streamCompactBlocks = async function* () {
    yield { point: { height: 99 }, encoded: new Uint8Array([1]) };
  };
  await assert.rejects(f.owner.sync(), { code: 'PROTOCOL_MISMATCH' });
  assert.equal(f.control.tips, 1);
  assert.equal(f.control.ingests, 0);
});

test('native rejection retries only when fresh pinned-point evidence proves source movement', async () => {
  for (const changes of [false, true]) {
    const f = recoveryFixture(), ingest = f.session.scan.ingest, read = f.light.getTreeState;
    let failures = 0, moved = false;
    f.light.getTip = async () => {
      f.control.tips++;
      return { ...f.target, hash: moved ? '04'.repeat(32) : f.target.hash };
    };
    f.light.getTreeState = async args => {
      const tree = await read(args);
      if (args.height === f.target.height && moved) tree.point.hash = '04'.repeat(32);
      return tree;
    };
    f.session.scan.ingest = async args => {
      if (!failures++) {
        moved = changes;
        throw failure('PROTOCOL_MISMATCH', 'sync', 'sync', 'Native batch rejected.');
      }
      return ingest(args);
    };
    if (changes) {
      assert.equal((await f.owner.sync()).targetReached, true);
      assert.equal(f.control.tips, 2);
      assert.equal(f.control.ingests, 1);
    } else {
      await assert.rejects(f.owner.sync(), { code: 'PROTOCOL_MISMATCH' });
      assert.equal(f.control.tips, 1);
      assert.equal(f.control.ingests, 0);
    }
  }
});

test('stale completion revalidates the target and does not rescan committed blocks', async () => {
  const f = recoveryFixture(), complete = f.session.scan.complete;
  let calls = 0;
  f.session.scan.complete = async args => {
    if (++calls === 1) { f.control.revision++; throw failure('CURSOR_STALE', 'sync', 'sync', 'Observation changed revision.'); }
    return complete(args);
  };
  await syncWallet(f.session, f.light, f.target);
  assert.equal(calls, 2);
  assert.equal(f.control.ingests, 1);
  assert.equal(f.control.pins, 5); // Two pins per pass, plus the retained ancestor check.
});

test('caller cancellation prevents stale-plan retry', async () => {
  const f = recoveryFixture(), controller = new AbortController();
  f.session.scan.ingest = async () => {
    controller.abort();
    throw failure('CURSOR_STALE', 'sync', 'sync', 'Stale plan.');
  };
  await assert.rejects(syncWallet(f.session, f.light, f.target, controller.signal), { code: 'CURSOR_STALE' });
  assert.equal(f.control.plans, 1);
  assert.equal(f.control.ingests, 0);
});

test('unknown native completion is never replayed as a stale plan or changed source', async () => {
  for (const code of ['CURSOR_STALE', 'PROTOCOL_MISMATCH']) {
    const f = recoveryFixture();
    f.session.completion = () => ({ completion: 'unknown' });
    f.session.scan.ingest = async () => { throw failure(code, 'sync', 'reopen', 'Unknown write completion.'); };
    await assert.rejects(f.owner.sync(), { code });
    assert.equal(f.control.plans, 1);
    assert.equal(f.control.tips, 1);
    assert.equal(f.control.pins, 1);
  }
});

test('newly discovered enhancement requests cannot grow a finite pass without bound', async () => {
  const target = { height: 1, hash: '03'.repeat(32) };
  let applied = 0;
  const session = { scan: {
    async state() { return { revision: String(applied), maxScannedHeight: null }; },
    async plan() { return { ranges: [] }; },
  }, enhancement: {
    async requests() { return { revision: String(applied), requests: [{ kind: 'status', txid: applied.toString(16).padStart(64, '0') }] }; },
    async apply() { applied++; return { revision: String(applied) }; },
  } };
  const light = { async getTreeState() { return { point: target }; }, async getTransaction() { return null; } };
  await assert.rejects(syncWallet(session, light, target), error => error.code === 'RESOURCE_LIMIT');
  assert.equal(applied, 1024);
});

test('reorg replay starts at the native actual checkpoint, not the requested ancestor', async () => {
  const oldHash = '01'.repeat(32), newHash = '02'.repeat(32);
  let scanned = 100, revision = 0;
  const requested = [], replayed = [];
  const session = { scan: {
    async state() { return { revision: String(revision), maxScannedHeight: scanned, fullyScannedHeight: scanned }; },
    async block({ height }) { return { revision: String(revision), point: { height, hash: oldHash } }; },
    async rewind({ requestedPoint }) {
      requested.push(requestedPoint.height); scanned = 96; revision++;
      return { revision: String(revision), point: { height: 96, hash: oldHash } };
    },
    async plan() {
      return { revision: String(revision), ranges: scanned === 100 ? []
        : [{ start: scanned + 1, endExclusive: 101, priorState: { height: scanned, hash: oldHash } }] };
    },
    async ingest({ blocks }) { scanned += blocks.length; revision++; },
    async complete() { return { revision: String(++revision) }; },
  }, enhancement: { async requests() { return { revision: String(revision), requests: [] }; } } };
  const light = {
    async getTreeState({ height }) { return { point: { height, hash: height === 100 ? newHash : oldHash }, encoded: new Uint8Array() }; },
    async *streamCompactBlocks({ fromHeight, toHeight }) {
      for (let height = fromHeight; height <= toHeight; height++) {
        replayed.push(height);
        yield { point: { height, hash: height === 100 ? newHash : oldHash }, encoded: new Uint8Array([height]) };
      }
    },
  };
  assert.equal((await syncWallet(session, light, { height: 100, hash: newHash })).fullyScannedHeight, 100);
  assert.deepEqual(requested, [99]);
  assert.deepEqual(replayed, [97, 98, 99, 100]);
});

test('finite sync follows native ranges in bounded batches and visits persistent status requests once', async () => {
  const hash = '03'.repeat(32), target = { height: 20, hash };
  let scanned = 0, revision = 0, applications = 0, pins = 0;
  const batches = [];
  const session = {
    scan: {
      async state() { return { revision: String(revision), maxScannedHeight: scanned || null, fullyScannedHeight: scanned || null }; },
      async plan() { return { revision: String(++revision), ranges: scanned === 20 ? [] : [{ start: scanned + 1, endExclusive: 21, priorState: { height: scanned, hash: null } }] }; },
      async ingest(args) { assert.equal(args.revision, String(revision)); batches.push(args.blocks.length); scanned += args.blocks.length; revision++; },
      async complete(args) { assert.equal(args.revision,String(revision)); assert.deepEqual(args.target,target); return {revision:String(++revision)}; },
    },
    enhancement: {
      async requests() { return { revision: String(revision), requests: [{ kind: 'status', txid: hash }] }; },
      async apply(args) { assert.equal(args.result.status, 'notRecognized'); applications++; return { revision: String(++revision) }; },
    },
  };
  const light = {
    async getTreeState({ height }) { if (height === 20) pins++; return { point: { height, hash }, encoded: new Uint8Array([height]) }; },
    async *streamCompactBlocks({ fromHeight, toHeight }) {
      for (let height = fromHeight; height <= toHeight; height++) yield { point: { height, hash }, encoded: new Uint8Array([height]) };
    },
    async getTransaction() { return null; },
  };
  assert.equal((await syncWallet(session, light, target)).fullyScannedHeight, 20);
  assert.deepEqual(batches, [16, 4]); assert.equal(applications, 1); assert.equal(pins, 2);
});

test('empty wallet reaches a target only after native completion without invented scan heights', async () => {
  for (const fail of [false,true]) {
    let completed=0,revision='0';
    const target={height:1,hash:'03'.repeat(32)};
    const session={scan:{
      async state(){return {revision,tipHeight:1,maxScannedHeight:null,fullyScannedHeight:null,scanComplete:null};},
      async plan(){return {revision,ranges:[]};},
      async complete(args){assert.equal(args.revision,revision);assert.deepEqual(args.treeState,new Uint8Array([7]));completed++;
        if(fail)throw failure('SYNC_REQUIRED','sync','sync','Snapshot incomplete.');revision='1';return{revision};},
    },enhancement:{async requests(){return{revision,requests:[]};}}};
    const light={async getTreeState(){return {point:target,encoded:new Uint8Array([7])};}};
    const owner=new WalletSync(session,light,{pollIntervalMs:10,maxBufferedUpdates:8});
    if(fail)await assert.rejects(owner.sync({target}),error=>error.code==='SYNC_REQUIRED'&&!error.syncStatus.targetReached);
    else {const status=await owner.sync({target});assert.equal(status.targetReached,true);assert.equal(status.scan.fullyScannedHeight,null);assert.equal(status.scan.scanComplete,null);}
    assert.equal(completed,1);
  }
});

test('sync lifecycle returns committed stopped progress and attaches failed status', async () => {
  const hash = '03'.repeat(32), target = { height: 1, hash };
  let scanned = null, revision = '0';
  const session = { scan: {
    async state() { return { revision, maxScannedHeight: scanned, fullyScannedHeight: scanned, scanComplete: false, tipHeight: 1 }; },
    async plan() { return { revision, ranges: [{ start: 1, endExclusive: 2, priorState: { height: 0, hash: null } }] }; },
    async ingest() { scanned = 1; revision = '1'; throw failure('ABORTED', 'sync', 'none', 'Cancelled after commit.'); },
  }, enhancement: { async requests() { return { revision, requests: [] }; } } };
  const light = {
    async getTreeState({ height }) { return { point: { height, hash }, encoded: new Uint8Array() }; },
    async *streamCompactBlocks() { yield { point: target, encoded: new Uint8Array([1]) }; },
  };
  const owner = new WalletSync(session, light, { pollIntervalMs: 10, maxBufferedUpdates: 8 });
  const stopped = await owner.sync({ target });
  assert.equal(stopped.activity, 'stopped'); assert.equal(stopped.scan.fullyScannedHeight, 1);
  assert.equal(stopped.targetReached, false);
  light.getTreeState = async () => { throw failure('TRANSPORT_ERROR', 'transport', 'configure', 'Source failed.'); };
  await assert.rejects(owner.sync({ target }), error => error.code === 'TRANSPORT_ERROR'
    && error.syncStatus.activity === 'failed' && error.syncStatus.scan.revision === '1');
  const status = await owner.getSyncStatus();
  assert.equal(status.lastError.code, 'TRANSPORT_ERROR');
  assert.throws(() => { status.lastError.message = 'mutated'; }, TypeError);
  assert.equal((await owner.getSyncStatus()).lastError.message, 'Source failed.');
});

function observing({ maxBufferedUpdates = 8, getTip } = {}) {
  const point = { height: 1, hash: '03'.repeat(32) };
  const scan = { revision: '0', fullyScannedHeight: 1, maxScannedHeight: 1, tipHeight: 1, scanComplete: true };
  let calls = 0, aborted = 0;
  const session = { scan: {
    async state({ signal } = {}) { if (signal?.aborted) throw failure('ABORTED', 'sync', 'none', 'Stopped.'); return { ...scan }; },
    async block() { return { revision: '0', point }; },
    async plan() { return { revision: '0', ranges: [] }; },
    async complete() { return { revision: '0' }; },
  }, enhancement: { async requests() { return { revision: '0', requests: [] }; } } };
  const light = {
    async getTip({ signal }) {
      calls++;
      if (getTip) return getTip(signal, point);
      return new Promise((resolve, reject) => {
        const fail = () => { aborted++; reject(failure('ABORTED', 'sync', 'none', 'Stopped.')); };
        signal.addEventListener('abort', fail, { once: true });
        if (signal.aborted) fail();
      });
    },
    async getTreeState() { return { point }; },
  };
  return { owner: new WalletSync(session, light, { pollIntervalMs: 5, maxBufferedUpdates }),
    calls: () => calls, aborted: () => aborted };
}
async function until(check) {
  for (let i = 0; i < 100; i++) { if (check()) return; await new Promise(resolve => setTimeout(resolve, 2)); }
  assert.fail('condition did not settle');
}

test('watch subscribers share one run; return and caller abort release only their subscription', async () => {
  const f = observing(), controller = new AbortController();
  // A suppressed caller event must still detach this subscription.
  controller.signal.addEventListener('abort', event => event.stopImmediatePropagation());
  const a = f.owner.watchSync({ signal: controller.signal }), b = f.owner.watchSync();
  assert.equal((await a.next()).value.activity, 'idle');
  await b.next(); await until(() => f.calls() === 1);
  controller.signal.dispatchEvent(new Event('abort'));
  assert.equal(f.aborted(), 0);
  controller.abort();
  await assert.rejects(a.next(), error => error.code === 'ABORTED');
  assert.equal(f.aborted(), 0);
  await b.return();
  assert.equal(f.aborted(), 1);
  assert.equal((await f.owner.getSyncStatus()).activity, 'stopped');
  const c = f.owner.watchSync(); await c.next(); await until(() => f.calls() === 2);
  await c.return(); assert.equal(f.aborted(), 2);
});

test('watch never cancels independently started finite sync and active watch retains busy admission', async () => {
  const f = observing();
  const finite = f.owner.sync(); await until(() => f.calls() === 1);
  const iterator = f.owner.watchSync(); await iterator.next(); await iterator.return();
  assert.equal(f.aborted(), 0);
  await f.owner.stop(); assert.equal((await finite).activity, 'stopped');
  const next = f.owner.watchSync(); await next.next(); await until(() => f.calls() === 2);
  await assert.rejects(f.owner.sync(), error => error.code === 'STORAGE_BUSY');
  await next.return();
});

test('submission refresh joins finite sync without taking cancellation ownership', async () => {
  const f = observing(), controller = new AbortController();
  const finite = f.owner.sync();
  await until(() => f.calls() === 1);
  const joined = f.owner.refreshForSubmission(controller.signal);
  controller.abort();
  await assert.rejects(joined, { code: 'ABORTED' });
  assert.equal(f.calls(), 1);
  assert.equal(f.aborted(), 0);
  await f.owner.stop();
  assert.equal((await finite).activity, 'stopped');
  const ready = recoveryFixture();
  await ready.owner.refreshForSubmission(new AbortController().signal);
  assert.equal((await ready.owner.getSyncStatus()).targetReached, true);
});

test('slow subscriber overflow is explicit and releases the last watch', async () => {
  const polling = observing({ maxBufferedUpdates: 1, getTip: async (_signal, point) => point });
  const stalled = polling.owner.watchSync(); await stalled.next();
  await until(() => polling.calls() >= 1);
  await new Promise(resolve => setTimeout(resolve, 5));
  await assert.rejects(stalled.next(), error => error.code === 'RESOURCE_LIMIT');
  const calls = polling.calls(); await new Promise(resolve => setTimeout(resolve, 15));
  assert.equal(polling.calls(), calls);
  await polling.owner.stop();
});

test('watch retries only transient network failures and closes all subscribers on terminal error', async () => {
  let attempts = 0;
  const f = observing({ getTip: async (_signal, point) => {
    attempts++;
    if (attempts === 1) throw failure('TRANSPORT_ERROR', 'transport', 'configure', 'Unavailable.', true);
    if (attempts === 2) return point;
    throw failure('PROTOCOL_MISMATCH', 'query', 'configure', 'Bad source.');
  } });
  const iterator = f.owner.watchSync(), statuses = [];
  await assert.rejects(async () => { for await (const status of iterator) statuses.push(status); }, error => error.code === 'PROTOCOL_MISMATCH');
  assert(statuses.some(status => status.activity === 'failed' && status.lastError.code === 'TRANSPORT_ERROR'));
  assert(statuses.some(status => status.targetReached));
  assert.equal(attempts, 3);
  await f.owner.stop();
});

test('overflow detaches only the slow subscriber', async () => {
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  const f = observing({ maxBufferedUpdates: 1, getTip: async (_signal, point) => { await gate; return point; } });
  const slow = f.owner.watchSync(), fast = f.owner.watchSync();
  await slow.next(); await fast.next(); await until(() => f.calls() === 1);
  const terminal = fast.next(); release();
  assert.equal((await terminal).value.targetReached, true);
  await assert.rejects(slow.next(), error => error.code === 'RESOURCE_LIMIT');
  await fast.return();
});

test('configured scan batches retain the aggregate native byte ceiling', async () => {
  const hash = '03'.repeat(32), target = { height: 3, hash };
  let scanned = 0;
  const batches = [];
  const session = { scan: {
    async state() { return { revision: '1', maxScannedHeight: scanned || null }; },
    async plan() { return { revision: '1', ranges: scanned === 3 ? [] : [{ start: scanned + 1, endExclusive: 4, priorState: { hash: null } }] }; },
    async ingest({ blocks }) { batches.push(blocks.length); scanned += blocks.length; },
    async complete() {},
  }, enhancement: { async requests() { return { revision: '1', requests: [] }; } } };
  const light = {
    async getTreeState({ height }) { return { point: { height, hash }, encoded: new Uint8Array() }; },
    async *streamCompactBlocks({ fromHeight, toHeight }) {
      for (let height = fromHeight; height <= toHeight; height++) yield { point: { height, hash }, encoded: new Uint8Array(1024 * 1024 + 1) };
    },
  };
  await syncWallet(session, light, target, undefined, 8);
  assert.deepEqual(batches, [1, 1, 1]);
  for (const size of [0, -1, 1.5, NaN, Infinity]) {
    await assert.rejects(syncWallet(session, light, target, undefined, size), { code: 'INVALID_ARGUMENT' });
  }
});

test('unsupported target pinning is classified before any scan mutation', async () => {
  const f = recoveryFixture();
  f.light.getTreeState = async () => {throw failure('METHOD_NOT_SUPPORTED','transport','configure','Unsupported method.');};
  await assert.rejects(syncWallet(f.session,f.light,f.target), error => {
    assert.equal(error.code,'TARGET_PINNING_UNSUPPORTED'); assert.equal(error.recovery,'configure');
    assert.match(error.message,/pin the sync target/); return true;
  });
  assert.equal(f.control.ingests,0); assert.equal(f.control.plans,0);
});

test('standing unspent-address polls are answered once per target block, not on every pass', async () => {
  const hash = Array.from({ length: 32 }, (_, i) => i.toString(16).padStart(2, '0')).join('');
  const nativeHash = hash.match(/../g).reverse().join('');
  const request = { kind: 'address', address: 'fixture', start: 1, endExclusive: null, requestAt: null,
    txStatus: 'all', outputStatus: 'unspent' };
  let revision = 0, inventories = 0, applied = 0;
  const target = { height: 50, hash };
  const session = { scan: {
    async state() { return { revision: String(revision), tipHeight: 50, fullyScannedHeight: 50, maxScannedHeight: 50, scanComplete: true }; },
    async block({ height }) { return { revision: String(revision), point: { height, hash: nativeHash } }; },
    async plan() { return { revision: String(revision), ranges: [] }; },
    async complete() {},
  }, enhancement: {
    // Native reissues the standing poll after every answer.
    async requests() { return { revision: String(revision), requests: [request] }; },
    async apply() { applied++; return { revision: String(++revision) }; },
  } };
  const light = {
    async getTip() { return { height: 50, hash, sourceId: 'source', observedAt: 'fixture' }; },
    async getTreeState({ height }) { return { point: { height, hash }, encoded: new Uint8Array() }; },
    async getAddressUtxos() { inventories++; return { items: [], tip: null, sourceId: 'source', observedAt: 'fixture' }; },
  };
  const polled = new Map();
  await syncWallet(session, light, target, undefined, 16, polled);
  assert.equal(inventories, 1);
  assert.equal(applied, 1);
  await syncWallet(session, light, target, undefined, 16, polled);
  await syncWallet(session, light, target, undefined, 16, polled);
  assert.equal(inventories, 1, 'same target block: no repeated inventory');
  // A new target block makes the poll due again.
  polled.set(JSON.stringify(request), 'ff'.repeat(32));
  await syncWallet(session, light, target, undefined, 16, polled);
  assert.equal(inventories, 2);
  // Without a cache (one-off callers) every pass still answers it.
  await syncWallet(session, light, target);
  assert.equal(inventories, 3);
});

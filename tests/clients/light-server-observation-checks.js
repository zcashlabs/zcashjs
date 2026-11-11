import { vectors, golden, bytes } from './light-server-observation-fixtures.js';

// Same assertions execute with page-owned browser objects and Node objects.
export async function observationChecks({ readLightdInfo, createGrpcWebByteTransport, codec, origin }) {
  const claims = [];
  const equal = (a, b) => { if (JSON.stringify(a) !== JSON.stringify(b)) throw Error('Assertion failed: ' + JSON.stringify({ actual: a, expected: b })); };
  const rejects = async (action, code) => {
    try { await action(); } catch (error) {
      equal(error.code, code);
      if (/private-secret|case=|https?:/.test(`${error.message} ${JSON.stringify(error)}`)) throw Error('unsanitized error');
      return;
    }
    throw Error('Expected rejection: ' + code);
  };
  const create = (mode = 'main', extra = {}) => createGrpcWebByteTransport(origin + '?case=' + mode, { timeoutMs: 2000, ...extra });
  const source = (mode, extra) => ({ codec, transport: create(mode, extra), sourceId: 'local label' });
  equal([...codec.encodeRequest('GetLightdInfo', '{}')], []);
  equal(codec.decodeResponse('GetLightdInfo', bytes(golden.hex)), golden.dto);
  claims.push('actual-codec-empty-request-and-unchanged-golden');
  for (const mode of ['main', 'zero', 'maximum', 'unknown', 'fragmented', 'protocol-v060']) {
    const dto = (vectors[mode] ?? vectors.main).dto;
    const before = Date.now();
    const result = await readLightdInfo(source(mode));
    const { observedAt, ...rest } = result;
    equal(rest, { version: dto.version, vendor: dto.vendor, protocolRevision: dto.lightwallet_protocol_version, sourceId: 'local label', chainName: dto.chain_name,
      saplingActivationHeight: Number(dto.sapling_activation_height), branchId: dto.consensus_branch_id, blockHeight: Number(dto.block_height), taddrSupport: dto.taddr_support });
    if (new Date(observedAt).toISOString() !== observedAt || Date.parse(observedAt) < before || Date.parse(observedAt) > Date.now()) throw Error('timestamp');
  }
  claims.push('exact-unbound-projection-zero-max-unknown-fragmented-v060');
  for (const mode of ['default', 'golden', 'height-overflow', 'sapling-overflow', 'uint64-max', 'protocol-missing', 'protocol-other',
    'branch-upper', 'branch-short', 'branch-newline', 'chain-empty', 'truncated-field', 'wrong-wire', 'utf8', 'field-bound', 'missing', 'no-message', 'two', 'base64', 'frame']) {
    await rejects(() => readLightdInfo(source(mode)), 'PROTOCOL_MISMATCH');
  }
  await rejects(() => readLightdInfo(source('message-bound')), 'RESOURCE_LIMIT');
  await rejects(() => readLightdInfo(source('status12')), 'METHOD_NOT_SUPPORTED');
  for (const mode of ['status5', 'http-error']) await rejects(() => readLightdInfo(source(mode)), 'TRANSPORT_ERROR');
  await rejects(() => readLightdInfo(source('stall', { timeoutMs: 50 })), 'TIMEOUT');
  claims.push('profile-malformed-bounds-terminal-status-timeout');
  for (const bad of ['', '  ', 1, null]) await rejects(() => readLightdInfo({ ...source(), sourceId: bad }), 'INVALID_ARGUMENT');
  let getters = 0;
  await rejects(() => readLightdInfo({ ...source(), get sourceId() { getters++; return 'x'; } }), 'INVALID_ARGUMENT');
  await rejects(() => readLightdInfo(source(), { get signal() { getters++; return undefined; } }), 'INVALID_ARGUMENT');
  await rejects(() => readLightdInfo(source(), { extra: true }), 'INVALID_ARGUMENT');
  await rejects(() => readLightdInfo(source(), { signal: {} }), 'INVALID_ARGUMENT');
  equal(getters, 0);
  const pre = new AbortController(); pre.abort('private-secret');
  let dispatched = 0;
  await rejects(() => readLightdInfo(source('main', { headers: async () => { dispatched++; return {}; } }), { signal: pre.signal }), 'ABORTED');
  equal(dispatched, 0);
  claims.push('descriptor-admission-preabort');
  const controller = new AbortController();
  controller.signal.addEventListener('abort', event => event.stopImmediatePropagation());
  await rejects(() => readLightdInfo(source('main', { headers: async () => { controller.abort('private-secret'); return {}; } }), { signal: controller.signal }), 'ABORTED');
  const synthetic = new AbortController();
  const mutable = source('main', { headers: async () => {
    synthetic.signal.dispatchEvent(new Event('abort')); mutable.sourceId = 'changed'; mutable.codec = null; mutable.transport = null;
    return {};
  } });
  equal((await readLightdInfo(mutable, { signal: synthetic.signal })).sourceId, 'local label');
  const afterSynthetic = new AbortController();
  afterSynthetic.signal.addEventListener('abort', event => event.stopImmediatePropagation());
  await rejects(() => readLightdInfo(source('main', { headers: async () => {
    afterSynthetic.signal.dispatchEvent(new Event('abort')); afterSynthetic.abort(); return {};
  } }), { signal: afterSynthetic.signal }), 'ABORTED');
  const during = new AbortController();
  const nativeFetch = globalThis.fetch;
  let timer, responseSeen = false;
  globalThis.fetch = async (...args) => {
    const result = await Reflect.apply(nativeFetch, globalThis, args);
    responseSeen = true; timer = setTimeout(() => during.abort(), 10); return result;
  };
  try { await rejects(() => readLightdInfo(source('stall'), { signal: during.signal }), 'ABORTED'); equal(responseSeen, true); }
  finally { globalThis.fetch = nativeFetch; clearTimeout(timer); }
  await rejects(() => readLightdInfo(source('main', { timeoutMs: 50, headers: async () => new Promise(() => {}) })), 'TIMEOUT');
  await rejects(() => readLightdInfo(source('main', { headers: async () => { throw Error('private-secret'); } })), 'INVALID_ARGUMENT');
  claims.push('native-cancellation-synthetic-events-label-capture-credentials');
  // Instrument trusted actual operations, never replace the real protobuf oracle.
  const transport = create();
  let encoded = 0, called = 0, decoded = 0;
  const wrappedCodec = {
    encodeRequest(method, json) { if (this !== wrappedCodec) throw Error('codec receiver'); equal([method, json], ['GetLightdInfo', '{}']); encoded++; return codec.encodeRequest(method, json); },
    decodeResponse(method, data) { if (this !== wrappedCodec) throw Error('codec receiver'); equal(method, 'GetLightdInfo'); decoded++; return codec.decodeResponse(method, data); },
  };
  const wrappedTransport = { unary(args) { if (this !== wrappedTransport) throw Error('transport receiver'); equal(args.method, 'GetLightdInfo'); called++; return transport.unary(args); } };
  for (const fn of [wrappedCodec.encodeRequest, wrappedCodec.decodeResponse, wrappedTransport.unary]) Object.defineProperty(fn, 'call', { get() { throw Error('private-secret overridable call'); } });
  await readLightdInfo({ codec: wrappedCodec, transport: wrappedTransport, sourceId: 'x' });
  equal([encoded, called, decoded], [1, 1, 1]);
  const finalAbort = new AbortController();
  const abortCodec = { ...codec, decodeResponse(method, data) { const result = codec.decodeResponse(method, data); finalAbort.abort(); return result; } };
  await rejects(() => readLightdInfo({ codec: abortCodec, transport: create(), sourceId: 'x' }, { signal: finalAbort.signal }), 'ABORTED');
  const badCodec = { ...codec, decodeResponse() { throw Error('private-secret'); } };
  await rejects(() => readLightdInfo({ codec: badCodec, transport: create(), sourceId: 'x' }), 'PROTOCOL_MISMATCH');
  const earlyAbort = new AbortController();
  let earlyDispatch = 0;
  const encodeAbort = { ...codec, encodeRequest(method, json) { const data = codec.encodeRequest(method, json); earlyAbort.abort(); return data; } };
  await rejects(() => readLightdInfo({ codec: encodeAbort, transport: create('main', { headers: async () => { earlyDispatch++; return {}; } }), sourceId: 'x' }, { signal: earlyAbort.signal }), 'ABORTED');
  equal(earlyDispatch, 0);
  const capturedCodec = { ...codec };
  const capturedTransport = { unary: transport.unary };
  const capturedSource = { codec: capturedCodec, transport: capturedTransport, sourceId: 'snapshot' };
  const pending = readLightdInfo(capturedSource);
  capturedCodec.encodeRequest = capturedCodec.decodeResponse = capturedTransport.unary = () => { throw Error('private-secret replaced'); };
  equal((await pending).sourceId, 'snapshot');
  const spoofed = new AbortController(); spoofed.abort();
  Object.defineProperties(spoofed.signal, { aborted: { value: false }, addEventListener: { value() { throw Error('private-secret'); } } });
  await rejects(() => readLightdInfo(source(), { signal: spoofed.signal }), 'ABORTED');
  await rejects(() => readLightdInfo(source(), { signal: new Proxy(new AbortController().signal, {}) }), 'INVALID_ARGUMENT');
  const foreignTransport = { unary() { throw Error('private-secret'); } };
  await rejects(() => readLightdInfo({ codec, transport: foreignTransport, sourceId: 'x' }), 'TRANSPORT_ERROR');
  let terminalDecodes = 0;
  const terminalCodec = { ...codec, decodeResponse(method, data) { terminalDecodes++; return codec.decodeResponse(method, data); } };
  await rejects(() => readLightdInfo({ codec: terminalCodec, transport: create('status5'), sourceId: 'x' }), 'TRANSPORT_ERROR');
  equal(terminalDecodes, 0);
  claims.push('intrinsic-application-receivers-boundary-checks-sanitization');
  return { ok: true, claims };
}

// Ordinary page-owned module; WebDriver only observes this test.
const active = new Set(), results = [];
const root = `private-wallet-test-${crypto.randomUUID()}`;
const parameters = new TextEncoder().encode('{"encoding":"regtest","Overwinter":10,"Sapling":20,"Blossom":30,"Heartwood":40,"Canopy":50,"Nu5":60,"Nu6":70,"Nu6_1":80,"Nu6_2":90,"Nu6_3":100}');
const initialize = create => ({ op: 'initialize', root, create, format: 'zcash-js-network/1', parameters, genesis: new Uint8Array(32).fill(3) });
function check(value, message) { if (!value) throw Error(message); }
async function observe(body) {
  const response = await fetch('/lifecycle', { method: 'POST', body: JSON.stringify(body), signal: AbortSignal.timeout(15000) });
  const data = await response.json();
  if (!response.ok) throw Error(JSON.stringify(data));
  return data;
}
function start() {
  const token = crypto.randomUUID();
  const script = `/wallet-host/browser-worker.mjs?owner=${token}`;
  const worker = new Worker(script, { type: 'module' }); active.add(worker);
  let error, instance;
  worker.addEventListener('error', e => { error = Error(e.message); });
  return {
    async call(request) {
      if (error) throw error;
      return new Promise((resolve, reject) => {
        const done = (error, value) => {
          clearTimeout(timer); worker.removeEventListener('message', message); worker.removeEventListener('error', failed);
          error ? reject(error) : resolve(value);
        };
        const timer = setTimeout(() => { worker.terminate(); done(Error('worker deadline')); }, 30000);
        const message = e => { if (e.data.ok && e.data.instance) instance = e.data.instance; done(null, e.data); };
        const failed = e => done(Error(e.message));
        worker.addEventListener('message', message); worker.addEventListener('error', failed); worker.postMessage('instance' in request ? request : { ...request, instance });
      });
    },
    async destroy() {
      const creation = await observe({ script, state: 'created' });
      worker.terminate();
      const destruction = await observe({ script, state: 'destroyed', realm: creation.realm });
      active.delete(worker); results.push(destruction);
    },
  };
}
let outcome;
try {
  const first = start();
  const opened = await first.call(initialize(true));
  check(opened.ok, JSON.stringify(opened));
  check(opened.secure && !opened.isolated && opened.sab === 'undefined', 'dedicated no-SAB baseline');
  const contender = start();
  const busy = await contender.call(initialize(false));
  check(!busy.ok && busy.error === 'STORAGE_BUSY', `contention: ${JSON.stringify(busy)}`);
  await contender.destroy();
  check((await first.call({ op: 'close', generation: opened.generation })).ok, 'close');
  check(!(await first.call({ op: 'binding', generation: opened.generation })).ok, 'stale operation');
  await first.destroy();
  // No replacement until the server observed the original BiDi realm destroyed.
  const wrong = start(), wrongRequest = initialize(false); wrongRequest.genesis[0] = 4;
  check((await wrong.call(wrongRequest)).error === 'NETWORK_MISMATCH', 'wrong network');
  await wrong.destroy();
  const reopened = start();
  const again = await reopened.call(initialize(false)); check(again.ok, JSON.stringify(again));
  const stored = await reopened.call({ op: 'binding', generation: again.generation });
  check(stored.ok && stored.bytes.every((v, i) => v === parameters[i]) && stored.bytes.length === parameters.length, 'same DB binding');
  check((await reopened.call({ op: 'close', generation: again.generation })).ok, 'reopened close');
  await reopened.destroy();
  outcome = { pass: true, root, results, userAgent: navigator.userAgent, actualQuotaExhaustion: false, uaEviction: false };
} catch (e) { outcome = { pass: false, root, results, error: { name: e.name, message: e.message, stack: e.stack } }; }
finally { for (const worker of active) worker.terminate(); }
document.querySelector('#result').textContent = JSON.stringify(outcome, null, 2);
await fetch('/result', { method: 'POST', body: JSON.stringify(outcome) });

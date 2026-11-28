import assert from 'node:assert/strict';
import test from 'node:test';

const { LocalChannel, LocalPort, cloneMessage } = await import('../../dist/src/runtime/local-channel.js');
const next = port => new Promise(resolve => { port.onmessage = ({ data }) => resolve(data); });

test('local ports deliver in order, asynchronously, after start', async () => {
  const { port1, port2 } = new LocalChannel();
  const received = [];
  port1.postMessage(1);
  port1.postMessage(2);
  await new Promise(resolve => setTimeout(resolve, 5));
  assert.deepEqual(received, []); // Not started: queued.
  const done = new Promise(resolve => {
    port2.onmessage = ({ data }) => { received.push(data); if (received.length === 3) resolve(); };
  });
  port1.postMessage(3);
  assert.deepEqual(received, []); // Delivery is never synchronous.
  await done;
  assert.deepEqual(received, [1, 2, 3]);
});

test('messages are cloned: bytes copied, ports passed by reference', async () => {
  const { port1, port2 } = new LocalChannel();
  const inner = new LocalChannel();
  const secret = Uint8Array.of(1, 2, 3);
  const ledger = new Int32Array([4, 5]);
  const message = { secret, ledger, nested: [{ big: 10n, when: new Date(0) }], port: inner.port2, map: new Map([[1, 'a']]) };
  const received = next(port2);
  port1.postMessage(message, [inner.port2]);
  const data = await received;
  assert.notEqual(data.secret, secret);
  assert.deepEqual([...data.secret], [1, 2, 3]);
  data.secret.fill(0);
  assert.deepEqual([...secret], [1, 2, 3]);
  assert.ok(data.ledger instanceof Int32Array && data.ledger[1] === 5);
  assert.equal(data.nested[0].big, 10n);
  assert.equal(data.port, inner.port2);
  assert.ok(data.port instanceof LocalPort);
  assert.equal(data.map.get(1), 'a');
});

test('clone rejects functions and class instances like structured clone', () => {
  assert.throws(() => cloneMessage({ f() {} }), { name: 'DataCloneError' });
  assert.throws(() => cloneMessage(new (class X {})()), { name: 'DataCloneError' });
  const cycle = { a: 1 };
  cycle.self = cycle;
  const copy = cloneMessage(cycle);
  assert.equal(copy.self, copy);
});

test('closed ports drop pending and later messages', async () => {
  const { port1, port2 } = new LocalChannel();
  let count = 0;
  port2.onmessage = () => count++;
  port1.postMessage('x');
  port2.close();
  port1.postMessage('y');
  await new Promise(resolve => setTimeout(resolve, 5));
  assert.equal(count, 0);
});

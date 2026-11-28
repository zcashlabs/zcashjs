// Host (Node) test transport for the native shim: drives `zakura-native-bridge`
// over two FIFOs with blocking reads/writes, so `call` is synchronous like JSI and
// `start` resolves asynchronously while the owner thread works.
import { execFileSync, spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export function createFifoTransport(bridge) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'zakura-bridge-'));
  const requests = path.join(directory, 'requests'), responses = path.join(directory, 'responses');
  execFileSync('mkfifo', ['-m', '600', requests, responses]);
  const child = spawn(bridge, [requests, responses], { stdio: ['ignore', 'inherit', 'inherit'] });
  // Opening a FIFO blocks until its peer opens: the bridge opens requests, then responses.
  const writer = fs.openSync(requests, 'w');
  const reader = fs.openSync(responses, 'r');
  const encoder = new TextEncoder();

  function readExact(length) {
    const out = new Uint8Array(length);
    for (let at = 0; at < length;) {
      const n = fs.readSync(reader, out, at, length - at, null);
      if (n === 0) throw new Error('bridge closed');
      at += n;
    }
    return out;
  }
  function request(op, id, name = '', args = new Uint8Array()) {
    const nameBytes = encoder.encode(name);
    const frame = new Uint8Array(4 + 13 + nameBytes.length + args.length);
    const view = new DataView(frame.buffer);
    view.setUint32(0, frame.length - 4, true);
    frame[4] = op;
    view.setBigUint64(5, BigInt(id), true);
    view.setUint32(13, nameBytes.length, true);
    frame.set(nameBytes, 17);
    frame.set(args, 17 + nameBytes.length);
    for (let at = 0; at < frame.length;) at += fs.writeSync(writer, frame, at, frame.length - at);
    const length = new DataView(readExact(4).buffer).getUint32(0, true);
    return readExact(length);
  }
  const id = bytes => Number(new DataView(bytes.buffer, bytes.byteOffset, 8).getBigUint64(0, true));

  return {
    call: (runtime, name, args) => request(0, runtime, name, args),
    start(runtime, name, args) {
      const ticket = id(request(1, runtime, name, args));
      return new Promise((resolve, reject) => {
        const poll = () => {
          try {
            const result = request(2, ticket);
            if (result.length === 1 && result[0] === 3) setTimeout(poll, 2);
            else resolve(result);
          } catch (error) { reject(error); }
        };
        poll();
      });
    },
    createRuntime: () => id(request(3, 0)),
    destroyRuntime: runtime => { request(4, runtime); },
    close() {
      try { fs.closeSync(writer); } catch { /* closed */ }
      try { fs.closeSync(reader); } catch { /* closed */ }
      child.kill();
      fs.rmSync(directory, { recursive: true, force: true });
    },
  };
}

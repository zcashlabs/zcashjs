export const nodeRuntime = typeof (globalThis as {
  process?: { versions?: { node?: string } };
}).process?.versions?.node === 'string';

export interface RuntimeWorker {
  postMessage(value: unknown, transfer: Transferable[]): void;
  terminate(): unknown;
  removeEvents(): void;
}
interface WorkerEvents {
  message(value: unknown): void;
  error(): void;
  messageerror(): void;
}

type NodeModules = {
  fs: typeof import('node:fs');
  os: typeof import('node:os');
  path: typeof import('node:path');
  url: typeof import('node:url');
  worker_threads: typeof import('node:worker_threads');
};
const builtin = <K extends keyof NodeModules>(name: K): Promise<NodeModules[K]> => import(`node:${name}`);

/** Stage only verified JavaScript. The owner controls worker termination before asset removal. */
export async function stageWalletWorkers(copyFile: (name: string) => Uint8Array, threaded: boolean, check: () => void) {
  const urls: Record<string, string> = {};
  const names = ['wallet.mjs', 'worker.mjs', nodeRuntime ? 'node-fs.mjs' : 'opfs.mjs',
    ...(threaded ? ['thread-bootstrap.mjs'] : [])];
  if (nodeRuntime) {
    const [fs, os, path, url, threads] = await Promise.all([
      builtin('fs'), builtin('os'), builtin('path'), builtin('url'), builtin('worker_threads'),
    ]);
    check();
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'zcash-wallet-runtime-'));
    const dispose = () => fs.rmSync(directory, { recursive: true, force: true });
    try {
      for (const name of names) {
        const file = path.join(directory, name);
        fs.writeFileSync(file, copyFile(name), { flag: 'wx', mode: 0o600 });
        urls[name] = url.pathToFileURL(file).href;
      }
    } catch (error) {
      dispose();
      throw error;
    }
    return {
      urls,
      dispose,
      // Node ports implement the browser messaging API consumed by the host queue.
      channels: () => new threads.MessageChannel() as unknown as MessageChannel,
      spawn(name: string, events: WorkerEvents): RuntimeWorker {
        const worker = new threads.Worker(new URL(urls[name]!), { trackUnmanagedFds: true });
        // Bun's terminate() can resolve before the thread stops; descriptor reclaim
        // after termination must not race a still-running worker.
        const exited = new Promise<void>(resolve => worker.once('exit', () => resolve()));
        worker.on('message', events.message);
        worker.on('error', events.error);
        worker.on('exit', events.error);
        worker.on('messageerror', events.messageerror);
        return {
          postMessage: (value, transfer) => worker.postMessage(value,
            transfer as import('node:worker_threads').Transferable[]),
          terminate: async () => {
            await worker.terminate();
            await exited;
          },
          removeEvents() {
            worker.off('message', events.message);
            worker.off('error', events.error);
            worker.off('exit', events.error);
            worker.off('messageerror', events.messageerror);
          },
        };
      },
    };
  }
  check();
  const dispose = () => {
    for (const url of Object.values(urls)) URL.revokeObjectURL(url);
  };
  try {
    for (const name of names) {
      urls[name] = URL.createObjectURL(new Blob(
        [copyFile(name) as Uint8Array<ArrayBuffer>], { type: 'text/javascript' },
      ));
    }
  } catch (error) {
    dispose();
    throw error;
  }
  return {
    urls,
    dispose,
    channels: () => new MessageChannel(),
    spawn(name: string, events: WorkerEvents): RuntimeWorker {
      const worker = new Worker(urls[name]!, { type: 'module' });
      worker.onmessage = event => events.message(event.data);
      worker.onerror = (event) => {
        event.preventDefault();
        events.error();
      };
      worker.onmessageerror = events.messageerror;
      return {
        postMessage: (value, transfer) => worker.postMessage(value, transfer),
        terminate: () => worker.terminate(),
        removeEvents() {
          worker.onmessage = null;
          worker.onerror = null;
          worker.onmessageerror = null;
        },
      };
    },
  };
}

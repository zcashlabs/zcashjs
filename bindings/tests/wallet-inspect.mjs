import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createHash } from 'node:crypto';
const threaded = process.argv[3] === '--threaded';
assert.ok(process.argv.length === 3 || (process.argv.length === 4 && threaded));
const bytes = fs.readFileSync(`${process.argv[2]}/bindings_bg.wasm`);
const module = new WebAssembly.Module(bytes);
const imports = WebAssembly.Module.imports(module);
// time's pinned wasm-bindgen clock uses Date construction and getTime.
const generated = ['__wbg_getTime_65922ba0b59d55a7', '__wbg_new_0_35540e542ba689d2', '__wbg_getRandomValues_a678b7300e8ed57f', '__wbg_getRandomValues_436a51d0629d84e1', '__wbg___wbindgen_throw_5d9e815e6fdf150f', '__wbindgen_init_externref_table', '__wbindgen_generic_0000000000000001'];
// Shared-memory getrandom uses an ordinary Uint8Array, then copies into WASM.
const sharedGenerated = ['__wbg_getRandomValues_18a36ae0f9014eda', '__wbg_getRandomValues_104f2a2a337e0ecc', '__wbg_length_31bdaf014f5fbde2', '__wbg_prototypesetcall_ae9f5e7459250748', '__wbg_new_with_length_5ffeddb9d9fbb96f', '__wbg_subarray_1daff70dde20c145'];
const host = ['entropy', 'utc_ms', 'sleep', 'host_error', 'file_open', 'file_close', 'file_read', 'file_write', 'file_truncate', 'file_sync', 'file_size', 'file_lock', 'file_unlock', 'file_reserved', 'file_delete', 'file_access'];
for (const entry of imports) {
  if (threaded && entry.kind === 'memory') { assert.equal(entry.module, './bindings_bg.js'); assert.equal(entry.name, 'memory'); continue; }
  assert.equal(entry.kind, 'function');
  assert.ok(entry.module === './bindings_bg.js' && (generated.includes(entry.name) || threaded && sharedGenerated.includes(entry.name)) || entry.module === './wallet-host/storage-host.mjs' && host.includes(entry.name), JSON.stringify(entry));
}
// Read the memory limits from these same validated module bytes.
let at = 8, limits;
function uint() { let n = 0, shift = 0, byte; do { byte = bytes[at++]; n += (byte & 127) * 2 ** shift; shift += 7; assert.ok(shift <= 35); } while (byte & 128); return n; }
function memoryLimits() {
  const flags = uint(), initial = uint();
  assert.equal(flags, threaded ? 3 : 1, 'explicit bounded memory with expected sharedness');
  limits = { initial, maximum: uint() }; assert.ok(limits.maximum <= 4096, '256 MiB cap');
}
function text() { const n = uint(); at += n; }
while (at < bytes.length) {
  const id = bytes[at++], length = uint(), end = at + length;
  if (id === 2) {
    for (let n = uint(); n > 0; n--) {
      text(); text(); const kind = bytes[at++];
      if (kind === 0) uint();
      else { assert.equal(kind, 2); assert.ok(threaded); assert.equal(limits, undefined); memoryLimits(); }
    }
  }
  if (id === 5) { assert.ok(!threaded); assert.equal(uint(), 1, 'one memory'); memoryLimits(); }
  at = end;
}
assert.ok(limits);
console.log(JSON.stringify({ pass: true, sha256: createHash('sha256').update(bytes).digest('hex'), imports, exports: WebAssembly.Module.exports(module), memoryPages: limits }));

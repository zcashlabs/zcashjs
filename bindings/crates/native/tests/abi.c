/* C ABI smoke test: symbols, header, encoding and runtime lifecycle.
 *   cargo build --release -p zakura-bindings-native
 *   cc crates/native/tests/abi.c -Icrates/native/include -Ltarget/release -lzakura_bindings_native -o abi
 *   LD_LIBRARY_PATH=target/release ./abi        (DYLD_LIBRARY_PATH on macOS) */
#include <stdio.h>
#include <string.h>
#include "zakura_native.h"

#define CHECK(cond, label) do { if (!(cond)) { fprintf(stderr, "FAIL: %s\n", label); return 1; } } while (0)

int main(void) {
  CHECK(zb_abi_version() == 1, "abi version");
  /* identity() with no arguments: status 0 (ok), then a string value (tag 2). */
  ZbBuffer id = zb_call(0, (const uint8_t *)"identity", 8, NULL, 0);
  CHECK(id.len > 6 && id.ptr[0] == 0 && id.ptr[1] == 2, "identity result");
  CHECK(memmem(id.ptr, id.len, "zakura-native/1", 15) != NULL, "identity format");
  zb_buffer_free(id);
  /* transaction_id(bytes [1,2,3], u32 0): an error string (status 1). */
  const uint8_t args[] = {3, 3, 0, 0, 0, 1, 2, 3, 1, 0, 0, 0, 0};
  ZbBuffer tx = zb_call(0, (const uint8_t *)"transaction_id", 14, args, sizeof args);
  CHECK(tx.len > 2 && tx.ptr[0] == 1 && tx.ptr[1] == 2, "string error");
  zb_buffer_free(tx);
  /* Unknown function: fatal (status 2). Malformed arguments: error. */
  ZbBuffer unknown = zb_call(0, (const uint8_t *)"nope", 4, NULL, 0);
  CHECK(unknown.len > 1 && unknown.ptr[0] == 2, "unknown function is fatal");
  zb_buffer_free(unknown);
  const uint8_t bad[] = {9};
  ZbBuffer malformed = zb_call(0, (const uint8_t *)"identity", 8, bad, sizeof bad);
  CHECK(malformed.len > 1 && malformed.ptr[0] == 1, "malformed arguments");
  zb_buffer_free(malformed);
  /* A runtime runs owner-bound calls; poll eventually returns the result. */
  uint64_t runtime = zb_runtime_create();
  CHECK(runtime != 0, "runtime");
  uint64_t ticket = zb_call_start(runtime, (const uint8_t *)"storage_binding", 15, (const uint8_t[]){1, 1, 0, 0, 0}, 5);
  ZbBuffer polled;
  for (;;) {
    polled = zb_call_poll(ticket);
    if (!(polled.len == 1 && polled.ptr[0] == 3)) break;
    zb_buffer_free(polled);
  }
  CHECK(polled.ptr[0] == 1 && memmem(polled.ptr, polled.len, "STALE_HANDLE", 12) != NULL, "owner call result");
  zb_buffer_free(polled);
  zb_runtime_destroy(runtime);
  ZbBuffer closed = zb_call(runtime, (const uint8_t *)"storage_binding", 15, (const uint8_t[]){1, 1, 0, 0, 0}, 5);
  CHECK(closed.ptr[0] == 2, "destroyed runtime refuses calls");
  zb_buffer_free(closed);
  puts("abi ok");
  return 0;
}

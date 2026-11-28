/* zakura-bindings-native C ABI (version 1). See crates/native/src/wire.rs for the
 * argument/result encoding. Every ZbBuffer returned must be passed to zb_buffer_free. */
#ifndef ZAKURA_NATIVE_H
#define ZAKURA_NATIVE_H
#include <stddef.h>
#include <stdint.h>
#ifdef __cplusplus
extern "C" {
#endif
typedef struct { uint8_t *ptr; size_t len; } ZbBuffer;
uint32_t zb_abi_version(void);
uint64_t zb_runtime_create(void);
void zb_runtime_destroy(uint64_t runtime);
uint64_t zb_call_start(uint64_t runtime, const uint8_t *name, size_t name_len, const uint8_t *args, size_t args_len);
ZbBuffer zb_call_wait(uint64_t ticket);
ZbBuffer zb_call_poll(uint64_t ticket);
ZbBuffer zb_call(uint64_t runtime, const uint8_t *name, size_t name_len, const uint8_t *args, size_t args_len);
void zb_buffer_free(ZbBuffer buffer);
#ifdef __cplusplus
}
#endif
#endif

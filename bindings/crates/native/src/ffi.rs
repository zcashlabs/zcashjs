//! C ABI. All buffers returned to the caller must be released with `zb_buffer_free`.
use crate::{runtime, wire};
use std::slice;

#[repr(C)]
pub struct ZbBuffer { pub ptr: *mut u8, pub len: usize }

fn buffer(bytes: Vec<u8>) -> ZbBuffer {
    let boxed = bytes.into_boxed_slice();
    let len = boxed.len();
    ZbBuffer { ptr: Box::into_raw(boxed) as *mut u8, len }
}

/// # Safety
/// `buffer` must come from this library and be freed once.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn zb_buffer_free(buffer: ZbBuffer) {
    if buffer.ptr.is_null() { return; }
    let mut boxed = unsafe { Box::from_raw(slice::from_raw_parts_mut(buffer.ptr, buffer.len)) };
    boxed.iter_mut().for_each(|b| *b = 0);
}

#[unsafe(no_mangle)]
pub extern "C" fn zb_abi_version() -> u32 { crate::ABI_VERSION }

/// Create a runtime (one owner thread with its own wallet domain). 0 on failure.
#[unsafe(no_mangle)]
pub extern "C" fn zb_runtime_create() -> u64 { runtime::create().unwrap_or(0) }

/// Stop a runtime; queued calls finish, then its databases close.
#[unsafe(no_mangle)]
pub extern "C" fn zb_runtime_destroy(runtime: u64) { runtime::destroy(runtime) }

/// Start a call. `runtime` 0 runs stateless functions synchronously. Returns a ticket
/// (0 if the ticket table is full, in which case the result is unavailable).
///
/// # Safety
/// `name`/`args` must point to `name_len`/`args_len` readable bytes.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn zb_call_start(runtime: u64, name: *const u8, name_len: usize, args: *const u8, args_len: usize) -> u64 {
    let name = match std::str::from_utf8(unsafe { slice::from_raw_parts(name, name_len) }) { Ok(n) => n.to_owned(), Err(_) => return 0 };
    let bytes = if args_len == 0 { &[][..] } else { unsafe { slice::from_raw_parts(args, args_len) } };
    match wire::decode_args(bytes) {
        Ok(values) => runtime::start(runtime, name, wire::Args(values)),
        Err(code) => runtime::start(0, "__invalid".into(), wire::Args(vec![wire::Value::Str(code.into())])),
    }
}

/// Block until the call completes and take its result.
#[unsafe(no_mangle)]
pub extern "C" fn zb_call_wait(ticket: u64) -> ZbBuffer { buffer(runtime::wait(ticket)) }

/// Take the result if ready; otherwise a one-byte PENDING (3) buffer.
#[unsafe(no_mangle)]
pub extern "C" fn zb_call_poll(ticket: u64) -> ZbBuffer { buffer(runtime::poll(ticket)) }

/// Start and wait in one step.
///
/// # Safety
/// As for `zb_call_start`.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn zb_call(runtime: u64, name: *const u8, name_len: usize, args: *const u8, args_len: usize) -> ZbBuffer {
    let ticket = unsafe { zb_call_start(runtime, name, name_len, args, args_len) };
    buffer(runtime::wait(ticket))
}

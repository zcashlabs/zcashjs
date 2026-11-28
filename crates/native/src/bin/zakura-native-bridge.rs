//! Host test bridge: drives the native library over two FIFOs so Node tests can use
//! the same JS shim as React Native without an FFI dependency.
//!
//! Request:  u32 LE length, then [op u8][id u64 LE][name len u32 LE][name][args]
//!   op 0 = call (runtime id), 1 = start (runtime id), 2 = poll (ticket id),
//!   3 = create runtime, 4 = destroy runtime (id)
//! Response: u32 LE length, then the result buffer (or an 8-byte id for 1 and 3).
use std::io::{Read, Write};

fn main() {
    let mut args = std::env::args().skip(1);
    let (requests, responses) = (args.next().expect("request fifo"), args.next().expect("response fifo"));
    let mut input = std::fs::File::open(requests).expect("open requests");
    let mut output = std::fs::OpenOptions::new().write(true).open(responses).expect("open responses");
    loop {
        let mut length = [0u8; 4];
        if input.read_exact(&mut length).is_err() { return; }
        let mut frame = vec![0u8; u32::from_le_bytes(length) as usize];
        input.read_exact(&mut frame).expect("request frame");
        let op = frame[0];
        let id = u64::from_le_bytes(frame[1..9].try_into().unwrap());
        let name_len = u32::from_le_bytes(frame[9..13].try_into().unwrap()) as usize;
        let name = std::str::from_utf8(&frame[13..13 + name_len]).expect("name");
        let args = &frame[13 + name_len..];
        let reply: Vec<u8> = match op {
            0 => zakura_bindings_native::call(id, name, args),
            1 => zakura_bindings_native::start(id, name, args).to_le_bytes().to_vec(),
            2 => zakura_bindings_native::poll(id),
            3 => zakura_bindings_native::runtime_create().unwrap_or(0).to_le_bytes().to_vec(),
            4 => { zakura_bindings_native::runtime_destroy(id); Vec::new() }
            _ => panic!("unknown op"),
        };
        output.write_all(&(reply.len() as u32).to_le_bytes()).and_then(|()| output.write_all(&reply)).expect("response");
    }
}

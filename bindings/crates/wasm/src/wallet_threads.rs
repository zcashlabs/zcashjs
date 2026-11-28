//! Bounded retained Rayon handoff. SQLite and authority remain on the owner.
use rayon::{ThreadBuilder, ThreadPoolBuilder};
use std::cell::Cell;
use std::sync::{Mutex, Condvar};
use std::sync::atomic::{AtomicBool, AtomicU32, Ordering};
use wasm_bindgen::prelude::*;
static SLOTS: Mutex<Vec<Option<ThreadBuilder>>> = Mutex::new(Vec::new());
static CHANGED: Condvar = Condvar::new();
static PREPARED: AtomicBool = AtomicBool::new(false);
static READY: AtomicBool = AtomicBool::new(false);
static ENTERED: AtomicU32 = AtomicU32::new(0);
thread_local! { static ROLE: Cell<u32> = const { Cell::new(0) }; }
pub(crate) fn assert_ready() {
    ROLE.with(|r| assert_eq!(r.get(), 1, "owner-only export"));
    assert!(!std::thread::panicking() && READY.load(Ordering::Acquire), "pool not ready");
}
#[wasm_bindgen]
pub fn wallet_threaded_prepare(count: u32) {
    assert!((1..=8).contains(&count));
    assert!(!PREPARED.swap(true, Ordering::AcqRel), "one bootstrap per domain");
    ROLE.with(|r| { assert_eq!(r.get(), 0); r.set(1); });
    *SLOTS.lock().unwrap() = (0..count).map(|_| None).collect();
}
#[wasm_bindgen]
pub fn wallet_threaded_enter(index: u32) {
    assert!(index < 8);
    ROLE.with(|r| { assert_eq!(r.get(), 0); r.set(index + 2); });
    let thread = {
        let mut slots = SLOTS.lock().unwrap();
        assert!((index as usize) < slots.len());
        loop {
            if let Some(thread) = slots[index as usize].take() { break thread; }
            slots = CHANGED.wait(slots).unwrap();
        }
    };
    assert_eq!(ENTERED.fetch_or(1 << index, Ordering::AcqRel) & (1 << index), 0);
    thread.run();
}
#[wasm_bindgen]
pub fn wallet_threaded_build() {
    ROLE.with(|r| assert_eq!(r.get(), 1));
    assert!(!std::thread::panicking() && !READY.load(Ordering::Acquire));
    let count = SLOTS.lock().unwrap().len();
    ThreadPoolBuilder::new().num_threads(count).spawn_handler(|thread| {
        let mut slots = SLOTS.lock().unwrap();
        let index = thread.index();
        assert!(slots[index].is_none()); slots[index] = Some(thread);
        CHANGED.notify_all(); Ok(())
    }).build_global().unwrap();
    assert_eq!(ENTERED.load(Ordering::Acquire), (1 << count) - 1);
    READY.store(true, Ordering::Release);
}

#[wasm_bindgen]
pub fn wallet_threaded_check() { assert_ready(); }

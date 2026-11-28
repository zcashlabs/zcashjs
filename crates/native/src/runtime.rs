//! Runtimes and calls.
//!
//! A runtime is one owner thread. The core keeps wallet and signer state in
//! thread-locals, so each runtime has its own domain, exactly like one WASM instance
//! per worker. A Rust panic poisons only that runtime (later calls fail with
//! DOMAIN_INVALID), matching a trapped WASM instance.
//!
//! Every call returns a ticket. `wait` blocks until its result; `poll` does not.
use crate::wire::{self, Args, Value};
use std::collections::HashMap;
use std::panic::{catch_unwind, AssertUnwindSafe};
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::mpsc::{channel, Sender};
use std::sync::{Arc, Condvar, Mutex};

pub struct Ticket {
    result: Mutex<Option<Vec<u8>>>,
    ready: Condvar,
}
impl Ticket {
    fn new() -> Arc<Self> { Arc::new(Self { result: Mutex::new(None), ready: Condvar::new() }) }
    fn finish(&self, bytes: Vec<u8>) {
        *self.result.lock().unwrap_or_else(|p| p.into_inner()) = Some(bytes);
        self.ready.notify_all();
    }
}

struct Job { name: String, args: Args, ticket: Arc<Ticket> }

struct Runtime { jobs: Mutex<Option<Sender<Job>>> }

static RUNTIMES: Mutex<Option<HashMap<u64, Arc<Runtime>>>> = Mutex::new(None);
static TICKETS: Mutex<Option<HashMap<u64, Arc<Ticket>>>> = Mutex::new(None);
static NEXT: AtomicU64 = AtomicU64::new(1);
const MAX_RUNTIMES: usize = 64;
const MAX_TICKETS: usize = 4096;
/// Scanning, proving and SQLite recursion need more than the default 2 MiB stack.
const OWNER_STACK: usize = 16 * 1024 * 1024;

// Panic text can contain wallet data; report a fixed code only.
fn panic_message(_payload: &(dyn std::any::Any + Send)) -> String { "RUNTIME_PANIC".into() }

/// Run a stateless function on the calling thread.
pub fn run_stateless(name: &str, args: &Args) -> Vec<u8> {
    match catch_unwind(AssertUnwindSafe(|| crate::dispatch::stateless(name, args))) {
        Ok(Some(Ok(Ok(value)))) => wire::ok(value),
        Ok(Some(Ok(Err(code)))) => wire::error(code),
        Ok(Some(Err(crate::dispatch::ErrorObject(message)))) => wire::encode_result(wire::ERROR_OBJECT, &Value::Str(message)),
        Ok(None) => wire::fatal("METHOD_NOT_SUPPORTED"),
        Err(payload) => wire::fatal(panic_message(&*payload)),
    }
}

pub fn create() -> Result<u64, &'static str> {
    let mut runtimes = RUNTIMES.lock().map_err(|_| "DOMAIN_INVALID")?;
    let runtimes = runtimes.get_or_insert_with(HashMap::new);
    if runtimes.len() >= MAX_RUNTIMES { return Err("RESOURCE_LIMIT"); }
    let (tx, rx) = channel::<Job>();
    let flag = Arc::new(AtomicBool::new(false));
    std::thread::Builder::new().name("zakura-wallet-owner".into()).stack_size(OWNER_STACK).spawn(move || {
        for Job { name, mut args, ticket } in rx {
            if flag.load(Ordering::Acquire) { ticket.finish(wire::fatal("DOMAIN_INVALID")); continue; }
            let outcome = catch_unwind(AssertUnwindSafe(|| owned(&name, &mut args)));
            drop(args);
            ticket.finish(match outcome {
                Ok(bytes) => bytes,
                Err(payload) => {
                    flag.store(true, Ordering::Release);
                    wire::fatal(panic_message(&*payload))
                }
            });
        }
        // Channel closed: thread-local wallet domains drop here and close their databases.
    }).map_err(|_| "RUNTIME_UNAVAILABLE")?;
    let id = NEXT.fetch_add(1, Ordering::Relaxed);
    runtimes.insert(id, Arc::new(Runtime { jobs: Mutex::new(Some(tx)) }));
    Ok(id)
}

fn owned(name: &str, args: &mut Args) -> Vec<u8> {
    #[cfg(feature = "wallet")]
    if let Some(outcome) = crate::dispatch::owned(name, args) {
        return match outcome { Ok(value) => wire::ok(value), Err(code) => wire::error(code) };
    }
    // Stateless functions are also callable on an owner (e.g. from a worker-shaped host).
    run_stateless(name, args)
}

/// Stop accepting calls; queued calls complete, then the owner thread exits.
pub fn destroy(id: u64) {
    let runtime = RUNTIMES.lock().ok().and_then(|mut r| r.as_mut().and_then(|r| r.remove(&id)));
    if let Some(runtime) = runtime {
        runtime.jobs.lock().unwrap_or_else(|p| p.into_inner()).take();
    }
}

/// Start a call. Runtime 0 runs stateless functions immediately on this thread.
pub fn start(runtime: u64, name: String, args: Args) -> u64 {
    let ticket = Ticket::new();
    if runtime == 0 {
        ticket.finish(run_stateless(&name, &args));
    } else {
        let target = RUNTIMES.lock().ok().and_then(|r| r.as_ref().and_then(|r| r.get(&runtime).cloned()));
        let sent = target.and_then(|rt| {
            let jobs = rt.jobs.lock().unwrap_or_else(|p| p.into_inner());
            jobs.as_ref().map(|tx| tx.send(Job { name, args, ticket: ticket.clone() }).is_ok())
        });
        if sent != Some(true) { ticket.finish(wire::fatal("CLOSED")); }
    }
    let id = NEXT.fetch_add(1, Ordering::Relaxed);
    let mut tickets = TICKETS.lock().unwrap_or_else(|p| p.into_inner());
    let tickets = tickets.get_or_insert_with(HashMap::new);
    if tickets.len() >= MAX_TICKETS {
        // The call still runs; its result is dropped. Callers must wait/poll their tickets.
        return 0;
    }
    tickets.insert(id, ticket);
    id
}

fn ticket(id: u64) -> Option<Arc<Ticket>> {
    TICKETS.lock().ok().and_then(|t| t.as_ref().and_then(|t| t.get(&id).cloned()))
}
fn retire(id: u64) { if let Ok(mut t) = TICKETS.lock() { t.as_mut().map(|t| t.remove(&id)); } }

pub fn wait(id: u64) -> Vec<u8> {
    let Some(ticket) = ticket(id) else { return wire::fatal("RESOURCE_LIMIT") };
    let mut result = ticket.result.lock().unwrap_or_else(|p| p.into_inner());
    while result.is_none() { result = ticket.ready.wait(result).unwrap_or_else(|p| p.into_inner()); }
    let bytes = result.take().unwrap();
    drop(result);
    retire(id);
    bytes
}

pub fn poll(id: u64) -> Vec<u8> {
    let Some(ticket) = ticket(id) else { return wire::fatal("RESOURCE_LIMIT") };
    let taken = ticket.result.lock().unwrap_or_else(|p| p.into_inner()).take();
    match taken {
        Some(bytes) => { retire(id); bytes }
        None => vec![wire::PENDING],
    }
}

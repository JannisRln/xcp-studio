//! Serialized XCP session actor with bounded queuing and command deadlines.
//!
//! Each worker exclusively owns the master and executes complete MTA-dependent
//! transactions. Expired queued operations are discarded without touching the ECU.
//! An in-flight timeout faults the session because a write may have partially
//! reached the target. Recovery is always explicitly initiated by the caller.
//! Hardware transports must honor receive_with_timeout: synchronous driver calls
//! that ignore the bound cannot be interrupted by the actor.

use crate::xcp::{XcpError, XcpMaster, ERR_SEQUENCE};
use crate::CanTransport;
use std::sync::{
    atomic::{AtomicBool, Ordering},
    mpsc::{self, Receiver, Sender, SyncSender, TrySendError},
    Arc,
};
use std::thread::{self, JoinHandle};
use std::time::{Duration, Instant};

const QUEUE_CAPACITY: usize = 128;
const DEFAULT_COMMAND_TIMEOUT: Duration = Duration::from_secs(10);

/// Session state; faulted sessions reject I/O until explicit reconnect.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SessionState {
    Disconnected,
    Connected,
    Faulted,
}

#[derive(Debug, thiserror::Error)]
pub enum SessionError {
    #[error("XCP session is not connected")]
    Disconnected,
    #[error("XCP session has faulted; explicit reconnect is required")]
    Faulted,
    #[error("XCP session worker is no longer available")]
    WorkerStopped,
    #[error(transparent)]
    Xcp(#[from] XcpError),
}

#[derive(Clone)]
struct Ticket {
    deadline: Instant,
    cancelled: Arc<AtomicBool>,
}

impl Ticket {
    fn new(timeout: Duration) -> Self {
        let now = Instant::now();
        Self {
            deadline: now.checked_add(timeout).unwrap_or(now),
            cancelled: Arc::new(AtomicBool::new(false)),
        }
    }

    fn expired(&self) -> bool {
        self.cancelled.load(Ordering::Acquire) || Instant::now() >= self.deadline
    }
}

struct Request<T> {
    ticket: Ticket,
    reply: Sender<Result<T, SessionError>>,
}

impl<T> Request<T> {
    fn respond(self, value: Result<T, SessionError>) {
        let _ = self.reply.send(value);
    }
}

enum Command {
    Connect(Request<Vec<u8>>),
    Disconnect(Request<()>),
    Read {
        address: u32,
        count: usize,
        request: Request<Vec<u8>>,
    },
    Write {
        address: u32,
        data: Vec<u8>,
        request: Request<()>,
    },
    State(Request<SessionState>),
    Shutdown,
}

/// Clonable, bounded command endpoint; no caller can access the master/MTA.
#[derive(Clone)]
pub struct SessionHandle {
    commands: SyncSender<Command>,
    timeout: Duration,
}

impl SessionHandle {
    /// Configure a command deadline including time waiting in the actor queue.
    /// A timeout during write means the ECU memory outcome is unknown.
    pub fn with_timeout(mut self, timeout: Duration) -> Self {
        self.timeout = timeout;
        self
    }

    fn call<T>(&self, command: impl FnOnce(Request<T>) -> Command) -> Result<T, SessionError> {
        let (reply, receiver) = mpsc::channel();
        let ticket = Ticket::new(self.timeout);
        let request = Request {
            ticket: ticket.clone(),
            reply,
        };
        match self.commands.try_send(command(request)) {
            Ok(()) => {}
            Err(TrySendError::Full(_)) => return Err(SessionError::Xcp(XcpError::CommandQueueFull)),
            Err(TrySendError::Disconnected(_)) => return Err(SessionError::WorkerStopped),
        }
        match receiver.recv_timeout(self.timeout) {
            Ok(result) => result,
            Err(mpsc::RecvTimeoutError::Timeout) => {
                ticket.cancelled.store(true, Ordering::Release);
                Err(SessionError::Xcp(XcpError::DeadlineExceeded))
            }
            Err(mpsc::RecvTimeoutError::Disconnected) => Err(SessionError::WorkerStopped),
        }
    }

    pub fn connect(&self) -> Result<Vec<u8>, SessionError> {
        self.call(Command::Connect)
    }

    pub fn disconnect(&self) -> Result<(), SessionError> {
        self.call(Command::Disconnect)
    }

    /// Queue SET_MTA and all UPLOADs as one non-interleavable transaction.
    pub fn read(&self, address: u32, count: usize) -> Result<Vec<u8>, SessionError> {
        self.call(|request| Command::Read {
            address,
            count,
            request,
        })
    }

    /// Queue SET_MTA and all DOWNLOADs as one non-interleavable transaction.
    pub fn write(&self, address: u32, data: &[u8]) -> Result<(), SessionError> {
        self.call(|request| Command::Write {
            address,
            data: data.to_vec(),
            request,
        })
    }

    pub fn state(&self) -> Result<SessionState, SessionError> {
        self.call(Command::State)
    }
}

/// Owns the actor thread. Dropping it waits for the current bounded I/O call.
pub struct SessionActor {
    handle: SessionHandle,
    worker: Option<JoinHandle<()>>,
}

impl SessionActor {
    pub fn spawn<T: CanTransport + 'static>(master: XcpMaster<T>) -> Self {
        Self::spawn_with_timeout(master, DEFAULT_COMMAND_TIMEOUT)
    }

    /// Configure the default total deadline for a queued session operation.
    pub fn spawn_with_timeout<T: CanTransport + 'static>(
        master: XcpMaster<T>,
        timeout: Duration,
    ) -> Self {
        let (commands, receiver) = mpsc::sync_channel(QUEUE_CAPACITY);
        let worker = thread::spawn(move || run(master, receiver));
        Self {
            handle: SessionHandle { commands, timeout },
            worker: Some(worker),
        }
    }

    pub fn handle(&self) -> SessionHandle {
        self.handle.clone()
    }
}

impl Drop for SessionActor {
    fn drop(&mut self) {
        // Shutdown is ordered after already-queued operations. Expired
        // requests are skipped by the worker; transport I/O must be bounded.
        let _ = self.handle.commands.send(Command::Shutdown);
        if let Some(worker) = self.worker.take() {
            let _ = worker.join();
        }
    }
}

fn is_fatal(error: &XcpError) -> bool {
    matches!(
        error,
        XcpError::NoResponse
            | XcpError::Transport(_)
            | XcpError::InvalidResponse
            | XcpError::UnsupportedCapabilities
            | XcpError::Protocol(ERR_SEQUENCE)
    )
}

fn ensure_connected(state: SessionState) -> Result<(), SessionError> {
    match state {
        SessionState::Connected => Ok(()),
        SessionState::Disconnected => Err(SessionError::Disconnected),
        SessionState::Faulted => Err(SessionError::Faulted),
    }
}

/// A timed-out in-flight operation invalidates the session even when its
/// transport eventually returns Ok; the ECU outcome cannot be trusted.
fn finish<T>(
    ticket: &Ticket,
    state: &mut SessionState,
    result: Result<T, XcpError>,
    fault_on_error: bool,
) -> Result<T, SessionError> {
    if ticket.expired() {
        *state = SessionState::Faulted;
        return Err(SessionError::Xcp(XcpError::DeadlineExceeded));
    }
    result.map_err(|error| {
        if fault_on_error || is_fatal(&error) {
            *state = SessionState::Faulted;
        }
        SessionError::Xcp(error)
    })
}

fn run<T: CanTransport>(mut master: XcpMaster<T>, commands: Receiver<Command>) {
    let mut state = SessionState::Disconnected;
    let mut last_connect_response = Vec::new();

    while let Ok(command) = commands.recv() {
        match command {
            Command::Connect(request) => {
                if request.ticket.expired() {
                    request.respond(Err(SessionError::Xcp(XcpError::DeadlineExceeded)));
                    continue;
                }
                if state == SessionState::Connected {
                    request.respond(Ok(last_connect_response.clone()));
                    continue;
                }
                // A previous timeout may have left an old CTO in the receive
                // queue. Do not let that reply satisfy a new CONNECT.
                let result = if state == SessionState::Faulted {
                    master
                        .discard_pending()
                        .and_then(|()| master.connect_until(request.ticket.deadline))
                } else {
                    master.connect_until(request.ticket.deadline)
                };
                let result = finish(&request.ticket, &mut state, result, true);
                if let Ok(ref response) = result {
                    last_connect_response = response.clone();
                    state = SessionState::Connected;
                }
                request.respond(result);
            }
            Command::Disconnect(request) => {
                if request.ticket.expired() {
                    request.respond(Err(SessionError::Xcp(XcpError::DeadlineExceeded)));
                    continue;
                }
                if state == SessionState::Disconnected {
                    request.respond(Ok(()));
                    continue;
                }
                let result = if state == SessionState::Faulted {
                    master
                        .discard_pending()
                        .and_then(|()| master.disconnect_until(request.ticket.deadline))
                } else {
                    master.disconnect_until(request.ticket.deadline)
                };
                let result = finish(&request.ticket, &mut state, result, true);
                if result.is_ok() {
                    state = SessionState::Disconnected;
                    last_connect_response.clear();
                }
                request.respond(result);
            }
            Command::Read {
                address,
                count,
                request,
            } => {
                if request.ticket.expired() {
                    request.respond(Err(SessionError::Xcp(XcpError::DeadlineExceeded)));
                    continue;
                }
                let result = ensure_connected(state).and_then(|()| {
                    let result = master.read_until(address, count, request.ticket.deadline);
                    finish(&request.ticket, &mut state, result, false)
                });
                request.respond(result);
            }
            Command::Write {
                address,
                data,
                request,
            } => {
                if request.ticket.expired() {
                    request.respond(Err(SessionError::Xcp(XcpError::DeadlineExceeded)));
                    continue;
                }
                let result = ensure_connected(state).and_then(|()| {
                    let result = master.write_until(address, &data, request.ticket.deadline);
                    finish(&request.ticket, &mut state, result, false)
                });
                request.respond(result);
            }
            Command::State(request) => {
                if request.ticket.expired() {
                    request.respond(Err(SessionError::Xcp(XcpError::DeadlineExceeded)));
                } else {
                    request.respond(Ok(state));
                }
            }
            Command::Shutdown => break,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::xcp::{CanIds, SimulatedSlave, SimulatedTransport, ERR_OUT_OF_RANGE};
    use crate::{CanFrame, TransportError};

    fn actor() -> SessionActor {
        let ids = CanIds::default();
        let slave = SimulatedSlave::new(0x1000, 512);
        SessionActor::spawn(XcpMaster::new(SimulatedTransport::new(slave, ids), ids))
    }

    #[test]
    fn session_lifecycle_rejects_disconnected_reads_and_writes() {
        let actor = actor();
        let handle = actor.handle();
        assert_eq!(handle.state().unwrap(), SessionState::Disconnected);
        assert!(matches!(handle.read(0x1000, 4), Err(SessionError::Disconnected)));
        assert!(matches!(handle.write(0x1000, &[1]), Err(SessionError::Disconnected)));
        let response = handle.connect().unwrap();
        assert!(!response.is_empty());
        assert_eq!(handle.connect().unwrap(), response);
        assert_eq!(handle.state().unwrap(), SessionState::Connected);
        handle.disconnect().unwrap();
        handle.disconnect().unwrap();
        assert_eq!(handle.state().unwrap(), SessionState::Disconnected);
    }

    #[test]
    fn overlapping_multi_thread_read_write_transactions_are_atomic() {
        let actor = actor();
        let handle = actor.handle();
        handle.connect().unwrap();
        let workers: Vec<_> = (0..8u32)
            .map(|worker_index| {
                let session = handle.clone();
                thread::spawn(move || {
                    let address = 0x1000 + worker_index * 16;
                    for iteration in 0..100u8 {
                        let bytes = [worker_index as u8, iteration, 0x55, 0xaa];
                        session.write(address, &bytes).unwrap();
                        assert_eq!(session.read(address, bytes.len()).unwrap(), bytes);
                    }
                })
            })
            .collect();
        for worker in workers {
            worker.join().unwrap();
        }
        assert_eq!(handle.state().unwrap(), SessionState::Connected);
    }

    #[test]
    fn protocol_range_error_does_not_kill_session() {
        let actor = actor();
        let handle = actor.handle();
        handle.connect().unwrap();
        assert!(matches!(
            handle.read(0x11ff, 2),
            Err(SessionError::Xcp(XcpError::Protocol(ERR_OUT_OF_RANGE)))
        ));
        assert_eq!(handle.state().unwrap(), SessionState::Connected);
        assert_eq!(handle.read(0x1000, 1).unwrap(), vec![0]);
    }

    struct SilentTransport;

    impl CanTransport for SilentTransport {
        fn send(&mut self, _frame: CanFrame) -> Result<(), TransportError> {
            Ok(())
        }

        fn receive(&mut self) -> Result<Option<CanFrame>, TransportError> {
            Ok(None)
        }
    }

    #[test]
    fn timeouts_fault_the_actor_until_explicit_reconnect() {
        let actor = SessionActor::spawn(XcpMaster::new(SilentTransport, CanIds::default()));
        let handle = actor.handle();
        assert!(matches!(
            handle.connect(),
            Err(SessionError::Xcp(XcpError::NoResponse))
        ));
        assert_eq!(handle.state().unwrap(), SessionState::Faulted);
        assert!(matches!(handle.read(0x1000, 1), Err(SessionError::Faulted)));
    }

    #[test]
    fn cloned_handle_is_invalid_after_actor_shutdown() {
        let actor = actor();
        let handle = actor.handle();
        drop(actor);
        assert!(matches!(handle.state(), Err(SessionError::WorkerStopped)));
    }
}

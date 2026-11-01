//! Serialized XCP session actor for stateful command execution.
//!
//! A single worker owns the XcpMaster and is the only caller that may change
//! its MTA. Cloned handles submit whole read/write transactions, preventing
//! concurrent frontends or services from interleaving SET_MTA/UPLOAD/DOWNLOAD.
//! The underlying transport must impose a bounded timeout on receive calls.

use crate::xcp::{XcpError, XcpMaster};
use crate::CanTransport;
use std::sync::mpsc::{self, Receiver, Sender};
use std::thread::{self, JoinHandle};

/// Public session lifecycle exposed to service consumers.
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

type Reply<T> = Sender<Result<T, SessionError>>;

enum Command {
    Connect(Reply<Vec<u8>>),
    Disconnect(Reply<()>),
    Read {
        address: u32,
        count: usize,
        reply: Reply<Vec<u8>>,
    },
    Write {
        address: u32,
        data: Vec<u8>,
        reply: Reply<()>,
    },
    State(Sender<SessionState>),
    Shutdown,
}

/// A clonable command endpoint. It never exposes the underlying XCP master.
#[derive(Clone)]
pub struct SessionHandle {
    commands: Sender<Command>,
}

impl SessionHandle {
    fn call<T>(&self, command: impl FnOnce(Reply<T>) -> Command) -> Result<T, SessionError> {
        let (reply, receiver) = mpsc::channel();
        self.commands
            .send(command(reply))
            .map_err(|_| SessionError::WorkerStopped)?;
        receiver.recv().map_err(|_| SessionError::WorkerStopped)?
    }

    pub fn connect(&self) -> Result<Vec<u8>, SessionError> {
        self.call(Command::Connect)
    }

    pub fn disconnect(&self) -> Result<(), SessionError> {
        self.call(Command::Disconnect)
    }

    /// Read is queued as one atomic MTA + upload operation.
    pub fn read(&self, address: u32, count: usize) -> Result<Vec<u8>, SessionError> {
        self.call(|reply| Command::Read {
            address,
            count,
            reply,
        })
    }

    /// Write is queued as one atomic MTA + download operation.
    pub fn write(&self, address: u32, data: &[u8]) -> Result<(), SessionError> {
        self.call(|reply| Command::Write {
            address,
            data: data.to_vec(),
            reply,
        })
    }

    pub fn state(&self) -> Result<SessionState, SessionError> {
        let (reply, receiver) = mpsc::channel();
        self.commands
            .send(Command::State(reply))
            .map_err(|_| SessionError::WorkerStopped)?;
        receiver.recv().map_err(|_| SessionError::WorkerStopped)
    }
}

/// Owns the worker thread; dropping this owner gracefully stops the command loop.
///
/// Cloned handles stop accepting commands after the actor is dropped. A
/// transport with an unbounded blocking receive may delay shutdown, so
/// hardware adapters must enforce receive timeouts.
pub struct SessionActor {
    handle: SessionHandle,
    worker: Option<JoinHandle<()>>,
}

impl SessionActor {
    pub fn spawn<T: CanTransport + 'static>(master: XcpMaster<T>) -> Self {
        let (commands, receiver) = mpsc::channel();
        let worker = thread::spawn(move || run(master, receiver));
        Self {
            handle: SessionHandle { commands },
            worker: Some(worker),
        }
    }

    pub fn handle(&self) -> SessionHandle {
        self.handle.clone()
    }
}

impl Drop for SessionActor {
    fn drop(&mut self) {
        let _ = self.handle.commands.send(Command::Shutdown);
        if let Some(worker) = self.worker.take() {
            let _ = worker.join();
        }
    }
}

fn is_fatal(error: &XcpError) -> bool {
    matches!(
        error,
        XcpError::NoResponse | XcpError::Transport(_) | XcpError::InvalidResponse
    )
}

fn ensure_connected(state: SessionState) -> Result<(), SessionError> {
    match state {
        SessionState::Connected => Ok(()),
        SessionState::Disconnected => Err(SessionError::Disconnected),
        SessionState::Faulted => Err(SessionError::Faulted),
    }
}

fn run<T: CanTransport>(mut master: XcpMaster<T>, commands: Receiver<Command>) {
    let mut state = SessionState::Disconnected;
    let mut last_connect_response = Vec::new();

    while let Ok(command) = commands.recv() {
        match command {
            Command::Connect(reply) => {
                let result = if state == SessionState::Connected {
                    Ok(last_connect_response.clone())
                } else {
                    match master.connect() {
                        Ok(response) => {
                            last_connect_response = response.clone();
                            state = SessionState::Connected;
                            Ok(response)
                        }
                        Err(error) => {
                            state = SessionState::Faulted;
                            Err(SessionError::Xcp(error))
                        }
                    }
                };
                let _ = reply.send(result);
            }
            Command::Disconnect(reply) => {
                let result = if state == SessionState::Disconnected {
                    Ok(())
                } else {
                    match master.disconnect() {
                        Ok(()) => {
                            state = SessionState::Disconnected;
                            last_connect_response.clear();
                            Ok(())
                        }
                        Err(error) => {
                            state = SessionState::Faulted;
                            Err(SessionError::Xcp(error))
                        }
                    }
                };
                let _ = reply.send(result);
            }
            Command::Read {
                address,
                count,
                reply,
            } => {
                let result = ensure_connected(state).and_then(|()| {
                    master.read(address, count).map_err(|error| {
                        if is_fatal(&error) {
                            state = SessionState::Faulted;
                        }
                        SessionError::Xcp(error)
                    })
                });
                let _ = reply.send(result);
            }
            Command::Write {
                address,
                data,
                reply,
            } => {
                let result = ensure_connected(state).and_then(|()| {
                    master.write(address, &data).map_err(|error| {
                        if is_fatal(&error) {
                            state = SessionState::Faulted;
                        }
                        SessionError::Xcp(error)
                    })
                });
                let _ = reply.send(result);
            }
            Command::State(reply) => {
                let _ = reply.send(state);
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

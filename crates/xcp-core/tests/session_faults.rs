//! Deterministic concurrency and XCP fault-injection coverage.
//! Every fixture is simulated; none claims hardware bench verification.

use std::{
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc, Mutex,
    },
    thread,
    time::{Duration, Instant},
};
use xcp_core::{
    session::{SessionActor, SessionError, SessionState},
    xcp::{
        CanIds, SimulatedSlave, SimulatedTransport, XcpError, XcpMaster, CONNECT, DOWNLOAD, ERR,
        ERR_ACCESS_DENIED, ERR_OUT_OF_RANGE, ERR_SEQUENCE, RES, SET_MTA, UPLOAD,
    },
    CanFrame, CanTransport, TransportError,
};

fn simulator() -> SimulatedTransport {
    let ids = CanIds::default();
    SimulatedTransport::new(SimulatedSlave::new(0x1000, 512), ids)
}

struct TracedTransport {
    inner: SimulatedTransport,
    commands: Arc<Mutex<Vec<u8>>>,
}

impl CanTransport for TracedTransport {
    fn send(&mut self, frame: CanFrame) -> Result<(), TransportError> {
        self.commands.lock().unwrap().push(frame.data[0]);
        self.inner.send(frame)
    }

    fn receive(&mut self) -> Result<Option<CanFrame>, TransportError> {
        self.inner.receive()
    }
}

#[test]
fn concurrent_multiframe_transactions_have_no_interleaved_mta() {
    let commands = Arc::new(Mutex::new(Vec::new()));
    let transport = TracedTransport {
        inner: simulator(),
        commands: Arc::clone(&commands),
    };
    let actor = SessionActor::spawn(XcpMaster::new(transport, CanIds::default()));
    let session = actor.handle();
    session.connect().unwrap();

    let workers: Vec<_> = (0..8u8)
        .map(|worker| {
            let session = session.clone();
            thread::spawn(move || {
                let address = 0x1000 + u32::from(worker) * 32;
                for iteration in 0..30u8 {
                    let mut data = [0u8; 12];
                    data[0] = worker;
                    data[1] = iteration;
                    data[2..].fill(worker ^ iteration);
                    session.write(address, &data).unwrap();
                    assert_eq!(session.read(address, data.len()).unwrap(), data);
                }
            })
        })
        .collect();
    for worker in workers {
        worker.join().unwrap();
    }
    assert_eq!(session.state().unwrap(), SessionState::Connected);

    let commands = commands.lock().unwrap();
    assert_eq!(commands[0], CONNECT);
    let mut index = 1;
    let mut transactions = 0;
    while index < commands.len() {
        assert_eq!(commands[index], SET_MTA, "MTA at index {index}");
        let operation = commands[index + 1];
        assert!(operation == UPLOAD || operation == DOWNLOAD);
        // 12 bytes require two UPLOADs or two DOWNLOADs.
        assert_eq!(&commands[index + 1..index + 3], &[operation, operation]);
        index += 3;
        transactions += 1;
    }
    assert_eq!(transactions, 8 * 30 * 2);
}

struct SlowUpload {
    inner: SimulatedTransport,
    entered: Arc<AtomicBool>,
    commands: Arc<Mutex<Vec<u8>>>,
}

impl CanTransport for SlowUpload {
    fn send(&mut self, frame: CanFrame) -> Result<(), TransportError> {
        let opcode = frame.data[0];
        self.commands.lock().unwrap().push(opcode);
        self.inner.send(frame)?;
        if opcode == UPLOAD {
            self.entered.store(true, Ordering::Release);
            // Simulate a driver call that completed only after the caller
            // deadline. The worker must not execute an expired queued write.
            thread::sleep(Duration::from_millis(90));
        }
        Ok(())
    }

    fn receive(&mut self) -> Result<Option<CanFrame>, TransportError> {
        self.inner.receive()
    }
}

#[test]
fn expired_queued_write_is_never_dispatched_after_inflight_timeout() {
    let entered = Arc::new(AtomicBool::new(false));
    let commands = Arc::new(Mutex::new(Vec::new()));
    let transport = SlowUpload {
        inner: simulator(),
        entered: Arc::clone(&entered),
        commands: Arc::clone(&commands),
    };
    let master = XcpMaster::new(transport, CanIds::default())
        .with_response_timeout(Duration::from_millis(300));
    let actor = SessionActor::spawn(master);
    let session = actor.handle();
    session.connect().unwrap();

    let first = session.clone().with_timeout(Duration::from_millis(20));
    let reader = thread::spawn(move || first.read(0x1000, 1));
    let deadline = Instant::now() + Duration::from_secs(1);
    while !entered.load(Ordering::Acquire) && Instant::now() < deadline {
        thread::sleep(Duration::from_millis(1));
    }
    assert!(entered.load(Ordering::Acquire));

    let writer = session.clone().with_timeout(Duration::from_millis(15));
    assert!(matches!(writer.write(0x1020, &[0xaa]), Err(SessionError::Timeout)));
    assert!(matches!(reader.join().unwrap(), Err(SessionError::Timeout)));
    assert_eq!(session.state().unwrap(), SessionState::Faulted);
    drop(actor);

    let commands = commands.lock().unwrap();
    assert!(!commands.contains(&DOWNLOAD), "expired write reached transport");
}

struct StaleUpload {
    inner: SimulatedTransport,
    suppress_once: bool,
    holding_reply: bool,
}

impl CanTransport for StaleUpload {
    fn send(&mut self, frame: CanFrame) -> Result<(), TransportError> {
        if frame.data[0] == UPLOAD && self.suppress_once {
            self.suppress_once = false;
            self.holding_reply = true;
        }
        self.inner.send(frame)
    }

    fn receive(&mut self) -> Result<Option<CanFrame>, TransportError> {
        self.receive_with_timeout(Duration::from_millis(100))
    }

    fn receive_with_timeout(
        &mut self,
        timeout: Duration,
    ) -> Result<Option<CanFrame>, TransportError> {
        if self.holding_reply && !timeout.is_zero() {
            return Ok(None);
        }
        self.holding_reply = false;
        self.inner.receive()
    }
}

#[test]
fn explicit_reconnect_drains_late_reply_after_no_response_fault() {
    let transport = StaleUpload {
        inner: simulator(),
        suppress_once: true,
        holding_reply: false,
    };
    let master = XcpMaster::new(transport, CanIds::default())
        .with_response_timeout(Duration::from_millis(25));
    let actor = SessionActor::spawn(master);
    let session = actor.handle();
    session.connect().unwrap();

    assert!(matches!(
        session.read(0x1000, 1),
        Err(SessionError::Xcp(XcpError::NoResponse))
    ));
    assert_eq!(session.state().unwrap(), SessionState::Faulted);
    assert!(matches!(session.read(0x1000, 1), Err(SessionError::Faulted)));

    // An old UPLOAD positive response has no CONNECT capability payload.
    // Without draining it, this CONNECT would be incorrectly consumed.
    assert_eq!(session.connect().unwrap().len(), 7);
    assert_eq!(session.read(0x1000, 1).unwrap(), vec![0]);
    assert_eq!(session.state().unwrap(), SessionState::Connected);
    session.disconnect().unwrap();
    assert_eq!(session.state().unwrap(), SessionState::Disconnected);
}

struct DropOnUpload {
    inner: SimulatedTransport,
    fail_once: bool,
    fail_receive: bool,
}

impl CanTransport for DropOnUpload {
    fn send(&mut self, frame: CanFrame) -> Result<(), TransportError> {
        if frame.data[0] == UPLOAD && self.fail_once {
            self.fail_once = false;
            self.fail_receive = true;
        }
        self.inner.send(frame)
    }

    fn receive(&mut self) -> Result<Option<CanFrame>, TransportError> {
        if self.fail_receive {
            self.fail_receive = false;
            return Err(TransportError::Disconnected);
        }
        self.inner.receive()
    }
}

#[test]
fn transport_disconnect_faults_io_and_requires_reconnect() {
    let transport = DropOnUpload {
        inner: simulator(),
        fail_once: true,
        fail_receive: false,
    };
    let actor = SessionActor::spawn(XcpMaster::new(transport, CanIds::default()));
    let session = actor.handle();
    session.connect().unwrap();
    assert!(matches!(
        session.read(0x1000, 1),
        Err(SessionError::Xcp(XcpError::Transport(TransportError::Disconnected)))
    ));
    assert_eq!(session.state().unwrap(), SessionState::Faulted);
    assert!(matches!(session.write(0x1000, &[1]), Err(SessionError::Faulted)));
    session.connect().unwrap();
    assert_eq!(session.read(0x1000, 1).unwrap(), vec![0]);
}

struct RejectUpload {
    inner: SimulatedTransport,
    negative_pending: bool,
}

impl CanTransport for RejectUpload {
    fn send(&mut self, frame: CanFrame) -> Result<(), TransportError> {
        if frame.data[0] == UPLOAD {
            self.negative_pending = true;
            return Ok(());
        }
        self.inner.send(frame)
    }

    fn receive(&mut self) -> Result<Option<CanFrame>, TransportError> {
        if self.negative_pending {
            self.negative_pending = false;
            return Ok(Some(CanFrame {
                id: CanIds::default().response,
                data: vec![ERR, ERR_SEQUENCE],
            }));
        }
        self.inner.receive()
    }
}

#[test]
fn negative_sequence_error_is_fatal_but_access_denied_is_not() {
    let actor = SessionActor::spawn(XcpMaster::new(
        RejectUpload {
            inner: simulator(),
            negative_pending: false,
        },
        CanIds::default(),
    ));
    let session = actor.handle();
    session.connect().unwrap();
    assert!(matches!(
        session.read(0x1000, 1),
        Err(SessionError::Xcp(XcpError::Protocol(ERR_SEQUENCE)))
    ));
    assert_eq!(session.state().unwrap(), SessionState::Faulted);
    drop(actor);

    let mut slave = SimulatedSlave::new(0x1000, 8);
    slave.set_writable(false);
    let actor = SessionActor::spawn(XcpMaster::new(
        SimulatedTransport::new(slave, CanIds::default()),
        CanIds::default(),
    ));
    let session = actor.handle();
    session.connect().unwrap();
    assert!(matches!(
        session.write(0x1000, &[0x55]),
        Err(SessionError::Xcp(XcpError::Protocol(ERR_ACCESS_DENIED)))
    ));
    assert_eq!(session.state().unwrap(), SessionState::Connected);
    assert_eq!(session.read(0x1000, 1).unwrap(), vec![0]);
    assert!(matches!(
        session.write(0x1007, &[1, 2]),
        Err(SessionError::Xcp(XcpError::Protocol(ERR_OUT_OF_RANGE)))
    ));
    assert_eq!(session.state().unwrap(), SessionState::Connected);
}

struct IncompatibleConnect {
    inner: SimulatedTransport,
}

impl CanTransport for IncompatibleConnect {
    fn send(&mut self, frame: CanFrame) -> Result<(), TransportError> {
        self.inner.send(frame)
    }

    fn receive(&mut self) -> Result<Option<CanFrame>, TransportError> {
        let Some(mut frame) = self.inner.receive()? else {
            return Ok(None);
        };
        if frame.data.len() == 8 && frame.data[0] == RES && frame.data[3] == 8 {
            // Big-endian communication mode unsupported by the master.
            frame.data[2] = 1;
        }
        Ok(Some(frame))
    }
}

#[test]
fn incompatible_negotiated_byte_order_fails_before_memory_io() {
    let actor = SessionActor::spawn(XcpMaster::new(
        IncompatibleConnect { inner: simulator() },
        CanIds::default(),
    ));
    let session = actor.handle();
    assert!(matches!(
        session.connect(),
        Err(SessionError::Xcp(XcpError::UnsupportedCapabilities))
    ));
    assert_eq!(session.state().unwrap(), SessionState::Faulted);
    assert!(matches!(session.read(0x1000, 1), Err(SessionError::Faulted)));
}

#[test]
fn reconnect_requires_explicit_operator_action_after_timeout() {
    struct Silent;
    impl CanTransport for Silent {
        fn send(&mut self, _frame: CanFrame) -> Result<(), TransportError> {
            Ok(())
        }
        fn receive(&mut self) -> Result<Option<CanFrame>, TransportError> {
            Ok(None)
        }
    }
    let actor = SessionActor::spawn(XcpMaster::new(Silent, CanIds::default())
        .with_response_timeout(Duration::from_millis(20)));
    let session = actor.handle();
    assert!(matches!(
        session.connect(),
        Err(SessionError::Xcp(XcpError::NoResponse))
    ));
    assert_eq!(session.state().unwrap(), SessionState::Faulted);
    assert!(matches!(session.read(0x1000, 1), Err(SessionError::Faulted)));
}

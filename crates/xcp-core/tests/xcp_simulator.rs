use xcp_core::xcp::{
    CanIds, SimulatedSlave, SimulatedTransport, XcpError, XcpMaster, ERR_ACCESS_DENIED,
    ERR_OUT_OF_RANGE, ERR_SEQUENCE,
};

fn master() -> XcpMaster<SimulatedTransport> {
    let ids = CanIds::default();
    XcpMaster::new(
        SimulatedTransport::new(SimulatedSlave::new(0x1000, 256), ids),
        ids,
    )
}

#[test]
fn connect_and_disconnect() {
    let mut master = master();
    let response = master.connect().unwrap();
    assert_eq!(response[2], 8); // max CTO
    master.disconnect().unwrap();
    assert!(matches!(
        master.upload(1),
        Err(XcpError::Protocol(ERR_SEQUENCE))
    ));
}

#[test]
fn read_across_multiple_uploads() {
    let ids = CanIds::default();
    let mut slave = SimulatedSlave::new(0x1000, 256);
    let expected: Vec<u8> = (0..32).collect();
    slave.load(0x1010, &expected).unwrap();
    let mut master = XcpMaster::new(SimulatedTransport::new(slave, ids), ids);
    master.connect().unwrap();
    assert_eq!(master.read(0x1010, 32).unwrap(), expected);
}

#[test]
fn download_and_readback_across_can_frames() {
    let mut master = master();
    master.connect().unwrap();
    let data: Vec<u8> = (0..23).collect();
    master.write(0x1020, &data).unwrap();
    assert_eq!(master.read(0x1020, data.len()).unwrap(), data);
}

#[test]
fn rejects_out_of_bounds_access() {
    let mut master = master();
    master.connect().unwrap();
    assert!(matches!(
        master.read(0x10ff, 2),
        Err(XcpError::Protocol(ERR_OUT_OF_RANGE))
    ));
}

#[test]
fn rejects_write_when_calibration_locked() {
    let ids = CanIds::default();
    let mut slave = SimulatedSlave::new(0x1000, 32);
    slave.set_writable(false);
    let mut master = XcpMaster::new(SimulatedTransport::new(slave, ids), ids);
    master.connect().unwrap();
    assert!(matches!(
        master.write(0x1000, &[1]),
        Err(XcpError::Protocol(ERR_ACCESS_DENIED))
    ));
}

#[test]
fn rejects_oversized_cto_payload() {
    let mut master = master();
    master.connect().unwrap();
    assert!(matches!(
        master.download(&[0; 7]),
        Err(XcpError::InvalidParameters)
    ));
}

#[test]
fn no_response_returns_error() {
    use xcp_core::{CanFrame, CanTransport, TransportError};

    struct SilentTransport;

    impl CanTransport for SilentTransport {
        fn send(&mut self, _frame: CanFrame) -> Result<(), TransportError> {
            Ok(())
        }

        fn receive(&mut self) -> Result<Option<CanFrame>, TransportError> {
            Ok(None)
        }
    }

    let mut master = XcpMaster::new(SilentTransport, CanIds::default());
    assert!(matches!(master.connect(), Err(XcpError::NoResponse)));
}

#[test]
fn ignores_unrelated_can_frames() {
    use std::collections::VecDeque;
    use xcp_core::{CanFrame, CanTransport, TransportError};

    struct NoisyTransport {
        frames: VecDeque<CanFrame>,
    }

    impl CanTransport for NoisyTransport {
        fn send(&mut self, _frame: CanFrame) -> Result<(), TransportError> {
            Ok(())
        }

        fn receive(&mut self) -> Result<Option<CanFrame>, TransportError> {
            Ok(self.frames.pop_front())
        }
    }

    let ids = CanIds::default();
    let mut frames = VecDeque::new();
    for _ in 0..100 {
        frames.push_back(CanFrame {
            id: 0x123,
            data: vec![0xff],
        });
    }
    frames.push_back(CanFrame {
        id: ids.response,
        data: vec![0xff, 0x01],
    });
    let mut master = XcpMaster::new(NoisyTransport { frames }, ids);
    assert_eq!(master.connect().unwrap(), vec![0x01]);
}

#[test]
fn unrelated_traffic_respects_deadline() {
    use std::time::Duration;
    use xcp_core::{CanFrame, CanTransport, TransportError};

    struct BusyTransport;

    impl CanTransport for BusyTransport {
        fn send(&mut self, _frame: CanFrame) -> Result<(), TransportError> {
            Ok(())
        }

        fn receive(&mut self) -> Result<Option<CanFrame>, TransportError> {
            Ok(Some(CanFrame {
                id: 0x123,
                data: vec![0xff],
            }))
        }
    }

    let mut master =
        XcpMaster::new(BusyTransport, CanIds::default()).with_response_timeout(Duration::ZERO);
    assert!(matches!(master.connect(), Err(XcpError::NoResponse)));
}


#[test]
fn empty_and_overflowing_accesses_fail_before_transmission() {
    let mut master = master();
    assert!(matches!(master.read(0x1000, 0), Err(XcpError::InvalidParameters)));
    assert!(matches!(master.write(0x1000, &[]), Err(XcpError::InvalidParameters)));
    assert!(matches!(master.read(u32::MAX, 2), Err(XcpError::InvalidParameters)));
    assert!(matches!(master.write(u32::MAX, &[1, 2]), Err(XcpError::InvalidParameters)));
}

#[test]
fn last_possible_address_does_not_overflow_simulator_mta() {
    let ids = CanIds::default();
    let slave = SimulatedSlave::new(u32::MAX, 1);
    let mut master = XcpMaster::new(SimulatedTransport::new(slave, ids), ids);
    master.connect().unwrap();
    master.write(u32::MAX, &[0xa5]).unwrap();
    assert_eq!(master.read(u32::MAX, 1).unwrap(), [0xa5]);
}

#[test]
fn oversized_classic_can_responses_are_rejected() {
    use xcp_core::{CanFrame, CanTransport, TransportError};

    struct OversizedResponse;
    impl CanTransport for OversizedResponse {
        fn send(&mut self, _frame: CanFrame) -> Result<(), TransportError> {
            Ok(())
        }
        fn receive(&mut self) -> Result<Option<CanFrame>, TransportError> {
            Ok(Some(CanFrame {
                id: CanIds::default().response,
                data: vec![0xff; 9],
            }))
        }
    }
    let mut master = XcpMaster::new(OversizedResponse, CanIds::default());
    assert!(matches!(master.connect(), Err(XcpError::InvalidResponse)));
}

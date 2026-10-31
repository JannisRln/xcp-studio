use xcp_core::xcp::{
    CanIds, SimulatedSlave, SimulatedTransport, XcpError, XcpMaster,
    ERR_ACCESS_DENIED, ERR_OUT_OF_RANGE, ERR_SEQUENCE,
};

fn master() -> XcpMaster<SimulatedTransport> {
    let ids = CanIds::default();
    XcpMaster::new(SimulatedTransport::new(SimulatedSlave::new(0x1000, 256), ids), ids)
}

#[test]
fn connect_and_disconnect() {
    let mut master = master();
    let response = master.connect().unwrap();
    assert_eq!(response[2], 8); // max CTO
    master.disconnect().unwrap();
    assert!(matches!(master.upload(1), Err(XcpError::Protocol(ERR_SEQUENCE))));
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
    assert!(matches!(master.read(0x10ff, 2), Err(XcpError::Protocol(ERR_OUT_OF_RANGE))));
}

#[test]
fn rejects_write_when_calibration_locked() {
    let ids = CanIds::default();
    let mut slave = SimulatedSlave::new(0x1000, 32);
    slave.set_writable(false);
    let mut master = XcpMaster::new(SimulatedTransport::new(slave, ids), ids);
    master.connect().unwrap();
    assert!(matches!(master.write(0x1000, &[1]), Err(XcpError::Protocol(ERR_ACCESS_DENIED))));
}

#[test]
fn rejects_oversized_cto_payload() {
    let mut master = master();
    master.connect().unwrap();
    assert!(matches!(master.download(&[0; 7]), Err(XcpError::InvalidParameters)));
}

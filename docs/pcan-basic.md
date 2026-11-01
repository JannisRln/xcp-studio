# PCAN-Basic Adapter — Windows Integration Status

**Baseline:** xcp-core contains a Windows PCAN-Basic classic CAN adapter, but the running xcp-server currently constructs only a SimulatedTransport session. **A PCAN UI option is not proof of an active physical CAN connection.**

Related: [architecture](architecture.md), [hardware ticket T-0009](tickets/T-0009-can-hardware-adapters.md), [safety policy](security-safety.md), [test strategy](test-strategy.md).

## 1. Current adapter implementation

The Rust xcp-core::pcan::PcanTransport adapter uses the PEAK-System PCAN-Basic runtime and implements classic CAN send/receive through the shared transport trait. It owns its channel and calls CAN_Uninitialize when dropped. Receive polling waits up to the configured timeout; a timeout returns None, which the current XCP master maps to XcpError::NoResponse. Adapter errors include vendor status codes.

Standard/extended classic CAN frames can be handled; RTR and CAN FD receive frames are skipped. Vendor APIs and their distribution terms must be respected. The simulator build and ordinary CI tests **do not need** the PCAN DLL.

## 2. Local adapter example (not the production server API)

~~~rust
use std::time::Duration;
use xcp_core::pcan::{PcanTransport, PCAN_BAUD_500K, PCAN_USBBUS1};
use xcp_core::xcp::{CanIds, XcpMaster};

let transport = PcanTransport::open(
    PCAN_USBBUS1,
    PCAN_BAUD_500K,
    Duration::from_millis(100),
)?;
let mut master = XcpMaster::new(transport, CanIds::default());
master.connect()?;
# Ok::<(), Box<dyn std::error::Error>>(())
~~~

Requires the correct PCAN driver, runtime DLL architecture, permissions, physical adapter, correct channel/bitrate and ECU with compatible CAN IDs/XCP configuration. A successful compile is not a hardware connection test.

## 3. Required hardware integration work

Ticket T-0009 must implement:
- Runtime adapter discovery and validated channel/bitrate/CAN ID profiles.
- Backend session factory selecting simulator, PCAN or Vector explicitly; **no silent simulator fallback** on hardware failure.
- Structured driver/device/status errors, filtering, teardown and reconnect policy.
- Vector VN1640A driver integration through documented XL API, with independent HIL validation.
- Separate read-only bench test evidence including adapter model, driver/DLL version, ECU fixture, OS, bitrate, CAN IDs and result trace.
- Transport mock tests that run without hardware/vendor DLL on CI.

Hardware writing must remain disabled unless the separate calibration and safety tickets have passed; do not use an arbitrary production ECU for early test writes.

## 4. Safe bench procedure (read-only)

1. Confirm adapter model, driver version, power/termination and ECU permissions.
2. Configure channel and bitrate from an approved test setup; record XCP CAN IDs.
3. Perform CONNECT with read-only operation policy; log ECU response/capabilities.
4. Read a known safe address, compare expected bytes, record latency/errors.
5. DISCONNECT and verify bus and adapter cleanup.
6. Repeat with missing adapter, wrong bitrate and timeout to capture error handling.
7. Never classify a simulator-only or compile-only test as HIL evidence.

See [operator runbook](runbook.md) and [implementation status](implementation-status.md) for the latest verified scope.

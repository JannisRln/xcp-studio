# PCAN-Basic adapter (Windows)

The `xcp-core::pcan::PcanTransport` adapter implements classic CAN via the
PEAK-System PCAN-Basic API. Install the PEAK-System driver and PCAN-Basic
runtime DLL for your process architecture before using hardware.

Example:

```rust
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
```

The adapter owns the channel and calls `CAN_Uninitialize` on drop. Receive
polling waits up to the configured timeout; a timeout returns `None`, which
the current XCP master maps to `XcpError::NoResponse`. PCAN status codes
are included in transport errors. Standard and extended classic CAN frames
are supported; RTR and CAN FD receive frames are skipped.

Hardware integration must be tested with a real PCAN adapter and ECU.
The unit tests do not require the vendor DLL.

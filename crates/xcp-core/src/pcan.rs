//! Windows PCAN-Basic classic CAN adapter.
//! The vendor DLL is loaded at runtime; no import library is required.

use crate::{CanFrame, CanTransport, TransportError};
use std::time::{Duration, Instant};

/// PCAN-USB channel 1. Other channel handles can be supplied to `open`.
pub const PCAN_USBBUS1: u16 = 0x51;
/// PCAN-Basic bitrate constant for 500 kbit/s.
pub const PCAN_BAUD_500K: u16 = 0x001C;
const PCAN_ERROR_OK: u32 = 0;
const PCAN_ERROR_QRCVEMPTY: u32 = 0x00020;
const PCAN_MESSAGE_STANDARD: u8 = 0x00;
const PCAN_MESSAGE_EXTENDED: u8 = 0x02;
const PCAN_MESSAGE_RTR: u8 = 0x01;
const PCAN_MESSAGE_FD: u8 = 0x04;

#[repr(C)]
#[derive(Clone, Copy)]
struct PcanMessage {
    id: u32,
    msg_type: u8,
    len: u8,
    data: [u8; 8],
}

impl PcanMessage {
    fn from_frame(frame: CanFrame) -> Result<Self, TransportError> {
        if frame.data.len() > 8 || frame.id > 0x1fff_ffff {
            return Err(TransportError::Other("invalid classic CAN frame".into()));
        }
        let msg_type = if frame.id > 0x7ff {
            PCAN_MESSAGE_EXTENDED
        } else {
            PCAN_MESSAGE_STANDARD
        };
        let mut data = [0; 8];
        data[..frame.data.len()].copy_from_slice(&frame.data);
        Ok(Self {
            id: frame.id,
            msg_type,
            len: frame.data.len() as u8,
            data,
        })
    }

    fn into_frame(self) -> Result<Option<CanFrame>, TransportError> {
        if self.msg_type & (PCAN_MESSAGE_RTR | PCAN_MESSAGE_FD) != 0 {
            return Ok(None);
        }
        if self.len > 8 {
            return Err(TransportError::Other("invalid PCAN receive length".into()));
        }
        Ok(Some(CanFrame {
            id: self.id,
            data: self.data[..self.len as usize].to_vec(),
        }))
    }
}

#[repr(C)]
struct PcanTimestamp {
    millis: u32,
    millis_overflow: u16,
    micros: u16,
}

type Initialize = unsafe extern "system" fn(u16, u16, u32, u16, u16) -> u32;
type Uninitialize = unsafe extern "system" fn(u16) -> u32;
type Read = unsafe extern "system" fn(u16, *mut PcanMessage, *mut PcanTimestamp) -> u32;
type Write = unsafe extern "system" fn(u16, *const PcanMessage) -> u32;

/// An owned PCAN-Basic channel, released automatically on drop.
pub struct PcanTransport {
    _library: libloading::Library,
    channel: u16,
    uninitialize: Uninitialize,
    read: Read,
    write: Write,
    receive_timeout: Duration,
    poll_interval: Duration,
}

// PCAN-Basic calls are synchronous; the adapter is moved, never shared concurrently.
unsafe impl Send for PcanTransport {}

impl PcanTransport {
    /// Open a classic CAN channel using the installed PCAN-Basic DLL.
    ///
    /// `receive_timeout` is the maximum wait for a response frame.
    /// A zero timeout performs a non-blocking receive.
    pub fn open(
        channel: u16,
        bitrate: u16,
        receive_timeout: Duration,
    ) -> Result<Self, TransportError> {
        let dll = if cfg!(target_pointer_width = "64") {
            "PCANBasic.dll"
        } else {
            "PCANBasic.dll"
        };
        // SAFETY: The DLL and its symbols are the documented PCAN-Basic ABI.
        let library = unsafe { libloading::Library::new(dll) }
            .map_err(|e| TransportError::Other(format!("cannot load PCAN-Basic: {e}")))?;
        unsafe {
            let initialize: Initialize = *library
                .get(b"CAN_Initialize\0")
                .map_err(|e| TransportError::Other(format!("CAN_Initialize: {e}")))?;
            let uninitialize: Uninitialize = *library
                .get(b"CAN_Uninitialize\0")
                .map_err(|e| TransportError::Other(format!("CAN_Uninitialize: {e}")))?;
            let read: Read = *library
                .get(b"CAN_Read\0")
                .map_err(|e| TransportError::Other(format!("CAN_Read: {e}")))?;
            let write: Write = *library
                .get(b"CAN_Write\0")
                .map_err(|e| TransportError::Other(format!("CAN_Write: {e}")))?;
            let status = initialize(channel, bitrate, 0, 0, 0);
            if status != PCAN_ERROR_OK {
                return Err(status_error("CAN_Initialize", status));
            }
            Ok(Self {
                _library: library,
                channel,
                uninitialize,
                read,
                write,
                receive_timeout,
                poll_interval: Duration::from_millis(1),
            })
        }
    }
}

fn status_error(operation: &str, status: u32) -> TransportError {
    TransportError::Other(format!("{operation} failed with PCAN status 0x{status:08X}"))
}

impl CanTransport for PcanTransport {
    fn send(&mut self, frame: CanFrame) -> Result<(), TransportError> {
        let message = PcanMessage::from_frame(frame)?;
        // SAFETY: Channel is initialized and message is a valid C-compatible structure.
        let status = unsafe { (self.write)(self.channel, &message) };
        if status == PCAN_ERROR_OK {
            Ok(())
        } else {
            Err(status_error("CAN_Write", status))
        }
    }

    fn receive(&mut self) -> Result<Option<CanFrame>, TransportError> {
        let start = Instant::now();
        loop {
            let mut message = PcanMessage {
                id: 0,
                msg_type: 0,
                len: 0,
                data: [0; 8],
            };
            // SAFETY: Channel is initialized; a null timestamp is supported by PCAN-Basic.
            let status = unsafe { (self.read)(self.channel, &mut message, std::ptr::null_mut()) };
            match status {
                PCAN_ERROR_OK => {
                    if let Some(frame) = message.into_frame()? {
                        return Ok(Some(frame));
                    }
                }
                PCAN_ERROR_QRCVEMPTY => {
                    if start.elapsed() >= self.receive_timeout {
                        return Ok(None);
                    }
                    std::thread::sleep(self.poll_interval);
                }
                _ => return Err(status_error("CAN_Read", status)),
            }
        }
    }
}

impl Drop for PcanTransport {
    fn drop(&mut self) {
        // SAFETY: The DLL stays loaded until after this destructor completes.
        unsafe { (self.uninitialize)(self.channel) };
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn validates_classic_can_frames() {
        assert!(PcanMessage::from_frame(CanFrame { id: 0x123, data: vec![0; 9] }).is_err());
        assert!(PcanMessage::from_frame(CanFrame { id: 0x2000_0000, data: vec![] }).is_err());
        let msg = PcanMessage::from_frame(CanFrame { id: 0x123, data: vec![1, 2] }).unwrap();
        assert_eq!(msg.into_frame().unwrap().unwrap().data, vec![1, 2]);
    }
}

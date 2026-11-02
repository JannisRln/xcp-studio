//! XCP-on-CAN command transport and deterministic simulated ECU.
//! Implements a deliberately scoped subset of ASAM XCP CTO commands.
//! Multi-byte command fields use XCP little-endian byte order in this simulator.

use crate::{CanFrame, CanTransport, TransportError};
use std::time::{Duration, Instant};

pub const CONNECT: u8 = 0xFF;
pub const DISCONNECT: u8 = 0xFE;
pub const SET_MTA: u8 = 0xF6;
pub const UPLOAD: u8 = 0xF5;
pub const SHORT_UPLOAD: u8 = 0xF4;
pub const DOWNLOAD: u8 = 0xF0;
pub const RES: u8 = 0xFF;
pub const ERR: u8 = 0xFE;
pub const ERR_CMD_UNKNOWN: u8 = 0x20;
pub const ERR_CMD_SYNTAX: u8 = 0x21;
pub const ERR_OUT_OF_RANGE: u8 = 0x22;
pub const ERR_ACCESS_DENIED: u8 = 0x24;
pub const ERR_SEQUENCE: u8 = 0x29;

#[derive(Debug, Clone, Copy)]
pub struct CanIds {
    pub command: u32,
    pub response: u32,
}

impl Default for CanIds {
    fn default() -> Self {
        Self {
            command: 0x667,
            response: 0x666,
        }
    }
}

#[derive(Debug, thiserror::Error)]
pub enum XcpError {
    #[error(transparent)]
    Transport(#[from] TransportError),
    #[error("no response from ECU")]
    NoResponse,
    #[error("invalid XCP response")]
    InvalidResponse,
    #[error("XCP error 0x{0:02X}")]
    Protocol(u8),
    #[error("invalid command parameters")]
    InvalidParameters,
    #[error("unsupported XCP communication mode or maximum CTO")]
    UnsupportedCapabilities,
    #[error("XCP command deadline exceeded; the ECU outcome may be unknown")]
    DeadlineExceeded,
    #[error("XCP command queue is full")]
    CommandQueueFull,
}

pub struct XcpMaster<T: CanTransport> {
    transport: T,
    ids: CanIds,
    response_timeout: Duration,
    resources: Option<u8>,
}

impl<T: CanTransport> XcpMaster<T> {
    pub fn new(transport: T, ids: CanIds) -> Self {
        Self {
            transport,
            ids,
            response_timeout: Duration::from_millis(500),
            resources: None,
        }
    }

    /// Set the maximum time allowed for a command response.
    /// Transport receive calls should have their own bounded timeout.
    pub fn with_response_timeout(mut self, timeout: Duration) -> Self {
        self.response_timeout = timeout;
        self
    }

    /// Use the earlier of the per-CTO response timeout and the actor deadline.
    /// Hardware transports must honor receive_with_timeout for this to be a
    /// strict wall-clock bound; a synchronous blocked driver cannot be preempted.
    fn request_until(
        &mut self,
        command: &[u8],
        command_deadline: Option<Instant>,
    ) -> Result<Vec<u8>, XcpError> {
        if command.is_empty() || command.len() > 8 {
            return Err(XcpError::InvalidParameters);
        }
        let now = Instant::now();
        let response_deadline = now.checked_add(self.response_timeout).unwrap_or(now);
        let deadline = command_deadline
            .map(|outer| outer.min(response_deadline))
            .unwrap_or(response_deadline);
        if now >= deadline {
            return Err(XcpError::NoResponse);
        }

        self.transport.send(CanFrame {
            id: self.ids.command,
            data: command.to_vec(),
        })?;

        loop {
            let remaining = deadline.saturating_duration_since(Instant::now());
            if remaining.is_zero() {
                return Err(XcpError::NoResponse);
            }
            let frame = self.transport.receive_with_timeout(remaining)?;
            // A transport that returned after its deadline must not make a
            // late response appear to be the current command's success.
            if Instant::now() >= deadline {
                return Err(XcpError::NoResponse);
            }
            let Some(frame) = frame else {
                // Non-blocking mocks/adapters may report an empty receive
                // immediately. Poll without consuming a CPU core.
                std::thread::sleep(
                    Duration::from_millis(1)
                        .min(deadline.saturating_duration_since(Instant::now())),
                );
                continue;
            };
            if frame.id != self.ids.response {
                continue;
            }
            // Classic CAN CTOs carry at most eight bytes; never accept an
            // empty/malformed response or a negative response without a code.
            if frame.data.len() > 8 {
                return Err(XcpError::InvalidResponse);
            }
            match frame.data.first().copied() {
                Some(RES) => return Ok(frame.data[1..].to_vec()),
                Some(ERR) if frame.data.len() >= 2 => {
                    return Err(XcpError::Protocol(frame.data[1]));
                }
                _ => return Err(XcpError::InvalidResponse),
            }
        }
    }

    /// Discard queued/stale CTO replies after a fault and before reconnecting.
    /// This is best-effort: XCP-on-CAN CTO does not provide a transaction ID.
    pub(crate) fn discard_pending(&mut self) -> Result<(), XcpError> {
        const MAX_DRAIN: usize = 64;
        for _ in 0..MAX_DRAIN {
            if self
                .transport
                .receive_with_timeout(Duration::ZERO)?
                .is_none()
            {
                self.resources = None;
                return Ok(());
            }
        }
        Err(XcpError::InvalidResponse)
    }

    pub fn connect(&mut self) -> Result<Vec<u8>, XcpError> {
        self.connect_impl(None)
    }

    pub(crate) fn connect_until(&mut self, deadline: Instant) -> Result<Vec<u8>, XcpError> {
        self.connect_impl(Some(deadline))
    }

    fn connect_impl(&mut self, deadline: Option<Instant>) -> Result<Vec<u8>, XcpError> {
        self.resources = None;
        let response = self.request_until(&[CONNECT, 0], deadline)?;
        // CONNECT positive response includes resource bits, communication
        // mode, max CTO / max DTO and protocol/transport versions.
        if response.len() != 7 {
            return Err(XcpError::InvalidResponse);
        }
        // Only 8-byte, byte-addressed, little-endian classic CAN commands
        // are implemented. Refuse incompatible targets before memory I/O.
        if response[1] & 0x07 != 0 || response[2] != 8 {
            return Err(XcpError::UnsupportedCapabilities);
        }
        self.resources = Some(response[0]);
        Ok(response)
    }

    pub fn disconnect(&mut self) -> Result<(), XcpError> {
        self.disconnect_impl(None)
    }

    pub(crate) fn disconnect_until(&mut self, deadline: Instant) -> Result<(), XcpError> {
        self.disconnect_impl(Some(deadline))
    }

    fn disconnect_impl(&mut self, deadline: Option<Instant>) -> Result<(), XcpError> {
        self.request_until(&[DISCONNECT], deadline)?;
        self.resources = None;
        Ok(())
    }

    pub fn set_mta(&mut self, address: u32) -> Result<(), XcpError> {
        self.set_mta_impl(address, None)
    }

    fn set_mta_impl(&mut self, address: u32, deadline: Option<Instant>) -> Result<(), XcpError> {
        let a = address.to_le_bytes();
        self.request_until(&[SET_MTA, 0, 0, 0, a[0], a[1], a[2], a[3]], deadline)?;
        Ok(())
    }

    /// Read at most seven bytes per upload request for byte-granularity XCP.
    pub fn upload(&mut self, count: u8) -> Result<Vec<u8>, XcpError> {
        self.upload_impl(count, None)
    }

    fn upload_impl(&mut self, count: u8, deadline: Option<Instant>) -> Result<Vec<u8>, XcpError> {
        if count == 0 || count > 7 {
            return Err(XcpError::InvalidParameters);
        }
        let response = self.request_until(&[UPLOAD, count], deadline)?;
        if response.len() < count as usize {
            return Err(XcpError::InvalidResponse);
        }
        Ok(response[..count as usize].to_vec())
    }

    pub fn read(&mut self, address: u32, count: usize) -> Result<Vec<u8>, XcpError> {
        self.read_impl(address, count, None)
    }

    pub(crate) fn read_until(
        &mut self,
        address: u32,
        count: usize,
        deadline: Instant,
    ) -> Result<Vec<u8>, XcpError> {
        self.read_impl(address, count, Some(deadline))
    }

    fn read_impl(
        &mut self,
        address: u32,
        count: usize,
        deadline: Option<Instant>,
    ) -> Result<Vec<u8>, XcpError> {
        validate_access_range(address, count)?;
        self.set_mta_impl(address, deadline)?;
        let mut result = Vec::with_capacity(count);
        while result.len() < count {
            let n = (count - result.len()).min(7) as u8;
            result.extend(self.upload_impl(n, deadline)?);
        }
        Ok(result)
    }

    /// Download uses a maximum of six payload bytes in an 8-byte CAN CTO.
    pub fn download(&mut self, data: &[u8]) -> Result<(), XcpError> {
        self.download_impl(data, None)
    }

    fn download_impl(&mut self, data: &[u8], deadline: Option<Instant>) -> Result<(), XcpError> {
        if data.is_empty() || data.len() > 6 {
            return Err(XcpError::InvalidParameters);
        }
        let mut command = vec![DOWNLOAD, data.len() as u8];
        command.extend_from_slice(data);
        self.request_until(&command, deadline)?;
        Ok(())
    }

    pub fn write(&mut self, address: u32, data: &[u8]) -> Result<(), XcpError> {
        self.write_impl(address, data, None)
    }

    pub(crate) fn write_until(
        &mut self,
        address: u32,
        data: &[u8],
        deadline: Instant,
    ) -> Result<(), XcpError> {
        self.write_impl(address, data, Some(deadline))
    }

    fn write_impl(
        &mut self,
        address: u32,
        data: &[u8],
        deadline: Option<Instant>,
    ) -> Result<(), XcpError> {
        validate_access_range(address, data.len())?;
        if self
            .resources
            .is_some_and(|resources| resources & 0x01 == 0)
        {
            return Err(XcpError::Protocol(ERR_ACCESS_DENIED));
        }
        self.set_mta_impl(address, deadline)?;
        for chunk in data.chunks(6) {
            self.download_impl(chunk, deadline)?;
        }
        Ok(())
    }

    pub fn into_transport(self) -> T {
        self.transport
    }
}

/// Reject empty requests and ranges that cannot be represented by 32-bit ECU addresses.
fn validate_access_range(address: u32, count: usize) -> Result<(), XcpError> {
    let count = u32::try_from(count).map_err(|_| XcpError::InvalidParameters)?;
    if count == 0 || address.checked_add(count - 1).is_none() {
        return Err(XcpError::InvalidParameters);
    }
    Ok(())
}

/// A transport that runs the simulated slave immediately after each send.
pub struct SimulatedTransport {
    slave: SimulatedSlave,
    responses: std::collections::VecDeque<CanFrame>,
    ids: CanIds,
}

impl SimulatedTransport {
    pub fn new(slave: SimulatedSlave, ids: CanIds) -> Self {
        Self {
            slave,
            responses: Default::default(),
            ids,
        }
    }
    pub fn slave(&self) -> &SimulatedSlave {
        &self.slave
    }
}

impl CanTransport for SimulatedTransport {
    fn send(&mut self, frame: CanFrame) -> Result<(), TransportError> {
        if frame.id == self.ids.command {
            let response = self.slave.handle(&frame.data);
            self.responses.push_back(CanFrame {
                id: self.ids.response,
                data: response,
            });
        }
        Ok(())
    }

    fn receive(&mut self) -> Result<Option<CanFrame>, TransportError> {
        Ok(self.responses.pop_front())
    }
}

pub struct SimulatedSlave {
    memory: Vec<u8>,
    base: u32,
    mta: u32,
    connected: bool,
    writable: bool,
}

impl SimulatedSlave {
    pub fn new(base: u32, size: usize) -> Self {
        Self {
            memory: vec![0; size],
            base,
            mta: base,
            connected: false,
            writable: true,
        }
    }

    pub fn set_writable(&mut self, writable: bool) {
        self.writable = writable;
    }

    pub fn load(&mut self, address: u32, bytes: &[u8]) -> Result<(), XcpError> {
        let range = self
            .range(address, bytes.len())
            .ok_or(XcpError::Protocol(ERR_OUT_OF_RANGE))?;
        self.memory[range].copy_from_slice(bytes);
        Ok(())
    }

    pub fn inspect(&self, address: u32, count: usize) -> Option<&[u8]> {
        let range = self.range(address, count)?;
        Some(&self.memory[range])
    }

    fn range(&self, address: u32, count: usize) -> Option<std::ops::Range<usize>> {
        let offset = usize::try_from(address.checked_sub(self.base)?).ok()?;
        let end = offset.checked_add(count)?;
        if end > self.memory.len() {
            return None;
        }
        Some(offset..end)
    }

    fn handle(&mut self, cmd: &[u8]) -> Vec<u8> {
        let Some(&opcode) = cmd.first() else {
            return vec![ERR, ERR_CMD_SYNTAX];
        };
        if opcode == CONNECT {
            if cmd.len() != 2 {
                return vec![ERR, ERR_CMD_SYNTAX];
            }
            self.connected = true;
            // Resource=CAL/PAG, comm mode=byte/LE, max CTO=8, max DTO=8.
            return vec![RES, 0x01, 0x00, 8, 8, 0, 1, 1];
        }
        if !self.connected {
            return vec![ERR, ERR_SEQUENCE];
        }
        match opcode {
            DISCONNECT if cmd.len() == 1 => {
                self.connected = false;
                vec![RES]
            }
            SET_MTA if cmd.len() == 8 && cmd[2] == 0 && cmd[3] == 0 => {
                if cmd[1] != 0 {
                    return vec![ERR, ERR_OUT_OF_RANGE];
                }
                let address = u32::from_le_bytes([cmd[4], cmd[5], cmd[6], cmd[7]]);
                if self.range(address, 0).is_none() {
                    return vec![ERR, ERR_OUT_OF_RANGE];
                }
                self.mta = address;
                vec![RES]
            }
            UPLOAD if cmd.len() == 2 => self.read_bytes(self.mta, cmd[1] as usize),
            SHORT_UPLOAD if cmd.len() == 8 && cmd[2] == 0 && cmd[3] == 0 => {
                if cmd[1] == 0 || cmd[1] > 7 {
                    return vec![ERR, ERR_OUT_OF_RANGE];
                }
                let address = u32::from_le_bytes([cmd[4], cmd[5], cmd[6], cmd[7]]);
                self.read_bytes(address, cmd[1] as usize)
            }
            DOWNLOAD if cmd.len() >= 3 && cmd[1] as usize == cmd.len() - 2 => {
                let count = cmd[1] as usize;
                if count == 0 || count > 6 {
                    return vec![ERR, ERR_OUT_OF_RANGE];
                }
                if !self.writable {
                    return vec![ERR, ERR_ACCESS_DENIED];
                }
                let Some(range) = self.range(self.mta, count) else {
                    return vec![ERR, ERR_OUT_OF_RANGE];
                };
                self.memory[range].copy_from_slice(&cmd[2..]);
                self.mta = self.mta.checked_add(count as u32).unwrap_or(0);
                vec![RES]
            }
            SET_MTA | UPLOAD | SHORT_UPLOAD | DOWNLOAD | DISCONNECT => vec![ERR, ERR_CMD_SYNTAX],
            _ => vec![ERR, ERR_CMD_UNKNOWN],
        }
    }

    fn read_bytes(&mut self, address: u32, count: usize) -> Vec<u8> {
        if count == 0 || count > 7 {
            return vec![ERR, ERR_OUT_OF_RANGE];
        }
        let Some(range) = self.range(address, count) else {
            return vec![ERR, ERR_OUT_OF_RANGE];
        };
        let mut response = vec![RES];
        response.extend_from_slice(&self.memory[range]);
        self.mta = address.checked_add(count as u32).unwrap_or(0);
        response
    }
}

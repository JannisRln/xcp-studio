//! XCP-on-CAN command transport and deterministic simulated ECU.
//! Implements a deliberately scoped subset of ASAM XCP CTO commands.
//! Multi-byte command fields use XCP little-endian byte order in this simulator.

use crate::{CanFrame, CanTransport, TransportError};

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
        Self { command: 0x667, response: 0x666 }
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
}

pub struct XcpMaster<T: CanTransport> {
    transport: T,
    ids: CanIds,
}

impl<T: CanTransport> XcpMaster<T> {
    pub fn new(transport: T, ids: CanIds) -> Self {
        Self { transport, ids }
    }

    fn request(&mut self, command: &[u8]) -> Result<Vec<u8>, XcpError> {
        if command.is_empty() || command.len() > 8 {
            return Err(XcpError::InvalidParameters);
        }
        self.transport.send(CanFrame { id: self.ids.command, data: command.to_vec() })?;
        // The synchronous transport contract returns None when no frame is available.
        // Production adapters will add timeouts and response correlation.
        for _ in 0..64 {
            let Some(frame) = self.transport.receive()? else { break };
            if frame.id != self.ids.response { continue; }
            match frame.data.first().copied() {
                Some(RES) => return Ok(frame.data[1..].to_vec()),
                Some(ERR) if frame.data.len() >= 2 => return Err(XcpError::Protocol(frame.data[1])),
                _ => return Err(XcpError::InvalidResponse),
            }
        }
        Err(XcpError::NoResponse)
    }

    pub fn connect(&mut self) -> Result<Vec<u8>, XcpError> {
        self.request(&[CONNECT, 0])
    }

    pub fn disconnect(&mut self) -> Result<(), XcpError> {
        self.request(&[DISCONNECT])?;
        Ok(())
    }

    pub fn set_mta(&mut self, address: u32) -> Result<(), XcpError> {
        let a = address.to_le_bytes();
        self.request(&[SET_MTA, 0, 0, 0, a[0], a[1], a[2], a[3]])?;
        Ok(())
    }

    /// Read at most seven bytes per upload request for byte-granularity XCP.
    pub fn upload(&mut self, count: u8) -> Result<Vec<u8>, XcpError> {
        if count == 0 || count > 7 { return Err(XcpError::InvalidParameters); }
        let response = self.request(&[UPLOAD, count])?;
        if response.len() < count as usize { return Err(XcpError::InvalidResponse); }
        Ok(response[..count as usize].to_vec())
    }

    pub fn read(&mut self, address: u32, count: usize) -> Result<Vec<u8>, XcpError> {
        self.set_mta(address)?;
        let mut result = Vec::with_capacity(count);
        while result.len() < count {
            let n = (count - result.len()).min(7) as u8;
            result.extend(self.upload(n)?);
        }
        Ok(result)
    }

    /// Download uses a maximum of six payload bytes in an 8-byte CAN CTO.
    pub fn download(&mut self, data: &[u8]) -> Result<(), XcpError> {
        if data.is_empty() || data.len() > 6 { return Err(XcpError::InvalidParameters); }
        let mut command = vec![DOWNLOAD, data.len() as u8];
        command.extend_from_slice(data);
        self.request(&command)?;
        Ok(())
    }

    pub fn write(&mut self, address: u32, data: &[u8]) -> Result<(), XcpError> {
        self.set_mta(address)?;
        for chunk in data.chunks(6) { self.download(chunk)?; }
        Ok(())
    }

    pub fn into_transport(self) -> T { self.transport }
}

/// A transport that runs the simulated slave immediately after each send.
pub struct SimulatedTransport {
    slave: SimulatedSlave,
    responses: std::collections::VecDeque<CanFrame>,
    ids: CanIds,
}

impl SimulatedTransport {
    pub fn new(slave: SimulatedSlave, ids: CanIds) -> Self {
        Self { slave, responses: Default::default(), ids }
    }
    pub fn slave(&self) -> &SimulatedSlave { &self.slave }
}

impl CanTransport for SimulatedTransport {
    fn send(&mut self, frame: CanFrame) -> Result<(), TransportError> {
        if frame.id == self.ids.command {
            let response = self.slave.handle(&frame.data);
            self.responses.push_back(CanFrame { id: self.ids.response, data: response });
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
        Self { memory: vec![0; size], base, mta: base, connected: false, writable: true }
    }

    pub fn set_writable(&mut self, writable: bool) { self.writable = writable; }

    pub fn load(&mut self, address: u32, bytes: &[u8]) -> Result<(), XcpError> {
        let range = self.range(address, bytes.len()).ok_or(XcpError::Protocol(ERR_OUT_OF_RANGE))?;
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
        if end > self.memory.len() { return None; }
        Some(offset..end)
    }

    fn handle(&mut self, cmd: &[u8]) -> Vec<u8> {
        let Some(&opcode) = cmd.first() else { return vec![ERR, ERR_CMD_SYNTAX] };
        if opcode == CONNECT {
            if cmd.len() != 2 { return vec![ERR, ERR_CMD_SYNTAX]; }
            self.connected = true;
            // Resource=CAL/PAG, comm mode=byte/LE, max CTO=8, max DTO=8.
            return vec![RES, 0x01, 0x00, 8, 8, 0, 1, 1];
        }
        if !self.connected { return vec![ERR, ERR_SEQUENCE]; }
        match opcode {
            DISCONNECT if cmd.len() == 1 => {
                self.connected = false;
                vec![RES]
            }
            SET_MTA if cmd.len() == 8 && cmd[2] == 0 && cmd[3] == 0 => {
                if cmd[1] != 0 { return vec![ERR, ERR_OUT_OF_RANGE]; }
                let address = u32::from_le_bytes([cmd[4], cmd[5], cmd[6], cmd[7]]);
                if self.range(address, 0).is_none() { return vec![ERR, ERR_OUT_OF_RANGE]; }
                self.mta = address;
                vec![RES]
            }
            UPLOAD if cmd.len() == 2 => self.read_bytes(self.mta, cmd[1] as usize),
            SHORT_UPLOAD if cmd.len() == 8 && cmd[2] == 0 && cmd[3] == 0 => {
                if cmd[1] == 0 || cmd[1] > 7 { return vec![ERR, ERR_OUT_OF_RANGE]; }
                let address = u32::from_le_bytes([cmd[4], cmd[5], cmd[6], cmd[7]]);
                self.read_bytes(address, cmd[1] as usize)
            }
            DOWNLOAD if cmd.len() >= 3 && cmd[1] as usize == cmd.len() - 2 => {
                let count = cmd[1] as usize;
                if count == 0 || count > 6 { return vec![ERR, ERR_OUT_OF_RANGE]; }
                if !self.writable { return vec![ERR, ERR_ACCESS_DENIED]; }
                let Some(range) = self.range(self.mta, count) else { return vec![ERR, ERR_OUT_OF_RANGE] };
                self.memory[range].copy_from_slice(&cmd[2..]);
                self.mta += count as u32;
                vec![RES]
            }
            SET_MTA | UPLOAD | SHORT_UPLOAD | DOWNLOAD | DISCONNECT => vec![ERR, ERR_CMD_SYNTAX],
            _ => vec![ERR, ERR_CMD_UNKNOWN],
        }
    }

    fn read_bytes(&mut self, address: u32, count: usize) -> Vec<u8> {
        if count == 0 || count > 7 { return vec![ERR, ERR_OUT_OF_RANGE]; }
        let Some(range) = self.range(address, count) else { return vec![ERR, ERR_OUT_OF_RANGE] };
        let mut response = vec![RES];
        response.extend_from_slice(&self.memory[range]);
        self.mta = address + count as u32;
        response
    }
}

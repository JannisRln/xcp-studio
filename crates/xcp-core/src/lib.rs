//! Transport-independent CAN building blocks.

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CanFrame {
    pub id: u32,
    pub data: Vec<u8>,
}

#[derive(Debug, thiserror::Error)]
pub enum TransportError {
    #[error("transport disconnected")]
    Disconnected,
    #[error("transport failure: {0}")]
    Other(String),
}

pub trait CanTransport: Send {
    fn send(&mut self, frame: CanFrame) -> Result<(), TransportError>;
    fn receive(&mut self) -> Result<Option<CanFrame>, TransportError>;
}

#[derive(Default)]
pub struct LoopbackTransport {
    queue: std::collections::VecDeque<CanFrame>,
}

impl CanTransport for LoopbackTransport {
    fn send(&mut self, frame: CanFrame) -> Result<(), TransportError> {
        self.queue.push_back(frame);
        Ok(())
    }
    fn receive(&mut self) -> Result<Option<CanFrame>, TransportError> {
        Ok(self.queue.pop_front())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn loopback_roundtrip() {
        let mut bus = LoopbackTransport::default();
        let frame = CanFrame {
            id: 0x123,
            data: vec![0xff, 0x00],
        };
        bus.send(frame.clone()).unwrap();
        assert_eq!(bus.receive().unwrap(), Some(frame));
    }
}

pub mod xcp;
pub mod session;

#[cfg(windows)]
pub mod pcan;

pub mod elf;
pub mod metadata;

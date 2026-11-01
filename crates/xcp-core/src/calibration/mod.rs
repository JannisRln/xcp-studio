//! Simulator-only calibration planning and transaction outcome evaluation.
//!
//! This module does not read or write ECU memory. In particular, it does not
//! bypass the server's unconditional memory-write denial. A future integration
//! must provide a separately reviewed, serialized session operation and enforce
//! the hardware policy independently of these data-only types.

use std::cmp::Ordering;

/// The raw ECU scalar representation. Float readback uses bit-exact comparison.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum RawType {
    U8,
    I8,
    U16,
    I16,
    U32,
    I32,
    U64,
    I64,
    F32,
    F64,
}

impl RawType {
    pub const fn byte_width(self) -> usize {
        match self {
            Self::U8 | Self::I8 => 1,
            Self::U16 | Self::I16 => 2,
            Self::U32 | Self::I32 | Self::F32 => 4,
            Self::U64 | Self::I64 | Self::F64 => 8,
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum ByteOrder {
    Little,
    Big,
}

#[derive(Clone, Debug, PartialEq)]
pub enum RawValue {
    Unsigned(u64),
    Signed(i64),
    Float32(f32),
    Float64(f64),
}

/// An ELF link-time location cannot be used as a simulator runtime address.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum RuntimeLocation {
    /// Only an independently verified simulator mapping may use this variant.
    SimulatorMapped(u32),
    ElfLinkTime(u64),
    Unresolved,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct EcuIdentity {
    pub session: String,
    pub ecu: String,
    pub image: String,
}

/// A revision from a trusted simulator memory owner, not a UI counter.
#[derive(Clone, Debug, PartialEq)]
pub struct Snapshot {
    pub identity: EcuIdentity,
    pub revision: u64,
    pub raw: RawValue,
}

/// Physical conversion is optional. Invalid or precision-losing conversions
/// are rejected rather than silently rounding 64-bit integers via f64.
#[derive(Clone, Copy, Debug, PartialEq)]
pub enum Conversion {
    None,
    Linear {
        scale: f64,
        offset: f64,
        physical_min: f64,
        physical_max: f64,
    },
}

#[derive(Clone, Debug, PartialEq)]
pub struct Parameter {
    pub name: String,
    pub identity: EcuIdentity,
    pub location: RuntimeLocation,
    pub writable: bool,
    pub raw_type: RawType,
    pub byte_order: ByteOrder,
    pub raw_min: RawValue,
    pub raw_max: RawValue,
    pub conversion: Conversion,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct ConfirmationToken(u128);

impl ConfirmationToken {
    /// Supply a nonzero cryptographically random token from a trusted server.
    /// This library intentionally does not generate entropy or expose tokens
    /// to a browser, and it does not store or consume tokens across requests.
    pub fn from_trusted_random(value: u128) -> Result<Self, CalibrationError> {
        if value == 0 {
            Err(CalibrationError::InvalidToken)
        } else {
            Ok(Self(value))
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum CalibrationError {
    InvalidIdentity,
    IdentityMismatch,
    UnresolvedRuntimeAddress,
    InvalidAddressRange,
    PermissionDenied,
    WrongRawType,
    InvalidRawRange,
    OutOfRange,
    InvalidConversion,
    PrecisionLoss,
    InvalidToken,
    TokenMismatch,
    Expired,
    StaleBaseline,
}

fn encode(value: &RawValue, kind: RawType, byte_order: ByteOrder) -> Result<Vec<u8>, CalibrationError> {
    let width = kind.byte_width();
    let bytes = match (kind, value) {
        (RawType::U8 | RawType::U16 | RawType::U32 | RawType::U64, RawValue::Unsigned(number)) => {
            if width < 8 && u128::from(*number) >= (1_u128 << (width * 8)) {
                return Err(CalibrationError::OutOfRange);
            }
            match byte_order {
                ByteOrder::Little => number.to_le_bytes()[..width].to_vec(),
                ByteOrder::Big => number.to_be_bytes()[8 - width..].to_vec(),
            }
        }
        (RawType::I8 | RawType::I16 | RawType::I32 | RawType::I64, RawValue::Signed(number)) => {
            let bits = width * 8;
            if width < 8 && (i128::from(*number) < -(1_i128 << (bits - 1))
                || i128::from(*number) >= (1_i128 << (bits - 1)))
            {
                return Err(CalibrationError::OutOfRange);
            }
            match byte_order {
                ByteOrder::Little => number.to_le_bytes()[..width].to_vec(),
                ByteOrder::Big => number.to_be_bytes()[8 - width..].to_vec(),
            }
        }
        (RawType::F32, RawValue::Float32(number)) if number.is_finite() => {
            match byte_order {
                ByteOrder::Little => number.to_bits().to_le_bytes().to_vec(),
                ByteOrder::Big => number.to_bits().to_be_bytes().to_vec(),
            }
        }
        (RawType::F64, RawValue::Float64(number)) if number.is_finite() => {
            match byte_order {
                ByteOrder::Little => number.to_bits().to_le_bytes().to_vec(),
                ByteOrder::Big => number.to_bits().to_be_bytes().to_vec(),
            }
        }
        (RawType::F32, RawValue::Float32(_)) | (RawType::F64, RawValue::Float64(_)) => {
            return Err(CalibrationError::OutOfRange);
        }
        _ => return Err(CalibrationError::WrongRawType),
    };
    Ok(bytes)
}

fn raw_order(left: &RawValue, right: &RawValue) -> Option<Ordering> {
    match (left, right) {
        (RawValue::Unsigned(a), RawValue::Unsigned(b)) => Some(a.cmp(b)),
        (RawValue::Signed(a), RawValue::Signed(b)) => Some(a.cmp(b)),
        (RawValue::Float32(a), RawValue::Float32(b)) => a.partial_cmp(b),
        (RawValue::Float64(a), RawValue::Float64(b)) => a.partial_cmp(b),
        _ => None,
    }
}

fn physical(value: &RawValue, conversion: Conversion) -> Result<Option<f64>, CalibrationError> {
    let Conversion::Linear { scale, offset, physical_min, physical_max } = conversion else {
        return Ok(None);
    };
    if !scale.is_finite() || scale == 0.0 || !offset.is_finite()
        || !physical_min.is_finite() || !physical_max.is_finite()
        || physical_min > physical_max
    {
        return Err(CalibrationError::InvalidConversion);
    }
    const EXACT_INTEGER_LIMIT: u64 = 1_u64 << 53;
    let raw = match value {
        RawValue::Unsigned(n) if *n <= EXACT_INTEGER_LIMIT => *n as f64,
        RawValue::Signed(n) if n.unsigned_abs() <= EXACT_INTEGER_LIMIT => *n as f64,
        RawValue::Unsigned(_) | RawValue::Signed(_) => return Err(CalibrationError::PrecisionLoss),
        RawValue::Float32(n) => f64::from(*n),
        RawValue::Float64(n) => *n,
    };
    let result = raw.mul_add(scale, offset);
    if !result.is_finite() {
        return Err(CalibrationError::InvalidConversion);
    }
    if result < physical_min || result > physical_max {
        return Err(CalibrationError::OutOfRange);
    }
    Ok(Some(result))
}

fn validate(parameter: &Parameter, value: &RawValue) -> Result<Vec<u8>, CalibrationError> {
    let bytes = encode(value, parameter.raw_type, parameter.byte_order)?;
    if raw_order(&parameter.raw_min, value) == Some(Ordering::Greater)
        || raw_order(value, &parameter.raw_max) == Some(Ordering::Greater)
    {
        return Err(CalibrationError::OutOfRange);
    }
    physical(value, parameter.conversion)?;
    Ok(bytes)
}

/// A one-shot, data-only preview bound to a baseline and ECU identity.
#[derive(Debug)]
pub struct Preview {
    parameter: Parameter,
    baseline: Snapshot,
    desired: RawValue,
    original_bytes: Vec<u8>,
    desired_bytes: Vec<u8>,
    desired_physical: Option<f64>,
    token: ConfirmationToken,
    expires_at_ms: u64,
}

impl Preview {
    /// Times come from one trusted monotonic clock; expiry is exclusive.
    pub fn prepare(
        parameter: Parameter,
        baseline: Snapshot,
        desired: RawValue,
        token: ConfirmationToken,
        now_ms: u64,
        expires_at_ms: u64,
    ) -> Result<Self, CalibrationError> {
        if parameter.identity.session.is_empty() || parameter.identity.ecu.is_empty()
            || parameter.identity.image.is_empty()
        {
            return Err(CalibrationError::InvalidIdentity);
        }
        if parameter.identity != baseline.identity {
            return Err(CalibrationError::IdentityMismatch);
        }
        if !parameter.writable {
            return Err(CalibrationError::PermissionDenied);
        }
        match parameter.location {
            RuntimeLocation::SimulatorMapped(address) => {
                if address.checked_add(parameter.raw_type.byte_width() as u32 - 1).is_none() {
                    return Err(CalibrationError::InvalidAddressRange);
                }
            }
            RuntimeLocation::ElfLinkTime(_) | RuntimeLocation::Unresolved => {
                return Err(CalibrationError::UnresolvedRuntimeAddress);
            }
        }
        if now_ms >= expires_at_ms {
            return Err(CalibrationError::Expired);
        }
        encode(&parameter.raw_min, parameter.raw_type, parameter.byte_order)?;
        encode(&parameter.raw_max, parameter.raw_type, parameter.byte_order)?;
        if raw_order(&parameter.raw_min, &parameter.raw_max) != Some(Ordering::Less)
            && raw_order(&parameter.raw_min, &parameter.raw_max) != Some(Ordering::Equal)
        {
            return Err(CalibrationError::InvalidRawRange);
        }
        let original_bytes = validate(&parameter, &baseline.raw)?;
        let desired_bytes = validate(&parameter, &desired)?;
        let desired_physical = physical(&desired, parameter.conversion)?;
        Ok(Self {
            parameter,
            baseline,
            desired,
            original_bytes,
            desired_bytes,
            desired_physical,
            token,
            expires_at_ms,
        })
    }

    pub fn original(&self) -> &RawValue {
        &self.baseline.raw
    }

    pub fn desired(&self) -> &RawValue {
        &self.desired
    }

    pub fn original_bytes(&self) -> &[u8] {
        &self.original_bytes
    }

    pub fn desired_bytes(&self) -> &[u8] {
        &self.desired_bytes
    }

    pub fn desired_physical(&self) -> Option<f64> {
        self.desired_physical
    }

    /// Consumes the preview; a fresh, serialized baseline read is mandatory
    /// immediately before a separately authorized simulator dispatch.
    pub fn confirm(
        self,
        supplied: ConfirmationToken,
        now_ms: u64,
        current: &Snapshot,
    ) -> Result<Confirmed, CalibrationError> {
        if supplied != self.token {
            return Err(CalibrationError::TokenMismatch);
        }
        if now_ms >= self.expires_at_ms {
            return Err(CalibrationError::Expired);
        }
        if current.identity != self.parameter.identity {
            return Err(CalibrationError::IdentityMismatch);
        }
        if current.revision != self.baseline.revision
            || encode(&current.raw, self.parameter.raw_type, self.parameter.byte_order)?
                != self.original_bytes
        {
            return Err(CalibrationError::StaleBaseline);
        }
        Ok(Confirmed { preview: self })
    }
}

/// A confirmed intent, not permission to write ECU memory.
#[derive(Debug)]
pub struct Confirmed {
    preview: Preview,
}

impl Confirmed {
    pub fn requested_bytes(&self) -> &[u8] {
        &self.preview.desired_bytes
    }

    /// Evaluate only a trusted caller's dispatch evidence. This does no I/O.
    pub fn finish(self, recorded_at_ms: u64, evidence: DispatchEvidence) -> AuditRecord {
        let before = self.preview.baseline;
        let expected = self.preview.desired;
        let mut readback = None;
        let mut observed_revision = None;
        let outcome = match evidence {
            DispatchEvidence::NotSent(reason) => AuditOutcome::NotSent(reason),
            DispatchEvidence::Sent(SentEvidence::Rejected) => AuditOutcome::Rejected,
            DispatchEvidence::Sent(SentEvidence::Timeout) => {
                AuditOutcome::Unknown(UnknownReason::TimeoutAfterSend)
            }
            DispatchEvidence::Sent(SentEvidence::Disconnected) => {
                AuditOutcome::Unknown(UnknownReason::DisconnectAfterSend)
            }
            DispatchEvidence::Sent(SentEvidence::Observed(snapshot)) => {
                observed_revision = Some(snapshot.revision);
                readback = Some(snapshot.raw.clone());
                if snapshot.identity != self.preview.parameter.identity {
                    AuditOutcome::Unknown(UnknownReason::IdentityChanged)
                } else if snapshot.revision <= before.revision {
                    AuditOutcome::Unknown(UnknownReason::UnversionedReadback)
                } else {
                    match encode(
                        &snapshot.raw,
                        self.preview.parameter.raw_type,
                        self.preview.parameter.byte_order,
                    ) {
                        Ok(bytes) if bytes == self.preview.desired_bytes => AuditOutcome::Verified,
                        Ok(_) => AuditOutcome::ReadbackMismatch,
                        Err(_) => AuditOutcome::Unknown(UnknownReason::InvalidReadback),
                    }
                }
            }
        };
        AuditRecord {
            target: self.preview.parameter.name,
            location: self.preview.parameter.location,
            identity: self.preview.parameter.identity,
            baseline_revision: before.revision,
            before: before.raw,
            requested: expected,
            readback,
            observed_revision,
            recorded_at_ms,
            outcome,
        }
    }
}

/// The caller must distinguish a failed send from a send that may have taken effect.
#[derive(Clone, Debug, PartialEq)]
pub enum DispatchEvidence {
    NotSent(NotSentReason),
    Sent(SentEvidence),
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum NotSentReason {
    PolicyDenied,
    Disconnected,
    Expired,
    Cancelled,
}

#[derive(Clone, Debug, PartialEq)]
pub enum SentEvidence {
    Observed(Snapshot),
    Rejected,
    Timeout,
    Disconnected,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum UnknownReason {
    TimeoutAfterSend,
    DisconnectAfterSend,
    IdentityChanged,
    UnversionedReadback,
    InvalidReadback,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum AuditOutcome {
    Verified,
    NotSent(NotSentReason),
    Rejected,
    ReadbackMismatch,
    Unknown(UnknownReason),
}

/// An immutable-by-interface audit result; the integration must persist it.
#[derive(Debug, PartialEq)]
pub struct AuditRecord {
    target: String,
    location: RuntimeLocation,
    identity: EcuIdentity,
    baseline_revision: u64,
    before: RawValue,
    requested: RawValue,
    readback: Option<RawValue>,
    observed_revision: Option<u64>,
    recorded_at_ms: u64,
    outcome: AuditOutcome,
}

impl AuditRecord {
    pub fn target(&self) -> &str { &self.target }
    pub fn location(&self) -> RuntimeLocation { self.location }
    pub fn identity(&self) -> &EcuIdentity { &self.identity }
    pub fn baseline_revision(&self) -> u64 { self.baseline_revision }
    pub fn before(&self) -> &RawValue { &self.before }
    pub fn requested(&self) -> &RawValue { &self.requested }
    pub fn readback(&self) -> Option<&RawValue> { self.readback.as_ref() }
    pub fn observed_revision(&self) -> Option<u64> { self.observed_revision }
    pub fn recorded_at_ms(&self) -> u64 { self.recorded_at_ms }
    pub fn outcome(&self) -> AuditOutcome { self.outcome }
}

#[cfg(test)]
mod tests {
    use super::*;

    const NOW: u64 = 1_000;
    fn identity() -> EcuIdentity {
        EcuIdentity { session: "session-1".into(), ecu: "sim-ecu-1".into(), image: "build-1".into() }
    }
    fn parameter() -> Parameter {
        Parameter {
            name: "rpm-limit".into(),
            identity: identity(),
            location: RuntimeLocation::SimulatorMapped(0x1000),
            writable: true,
            raw_type: RawType::U16,
            byte_order: ByteOrder::Little,
            raw_min: RawValue::Unsigned(1000),
            raw_max: RawValue::Unsigned(8000),
            conversion: Conversion::Linear {
                scale: 0.5,
                offset: 0.0,
                physical_min: 500.0,
                physical_max: 4000.0,
            },
        }
    }
    fn snapshot(value: u64, revision: u64) -> Snapshot {
        Snapshot { identity: identity(), revision, raw: RawValue::Unsigned(value) }
    }
    fn token() -> ConfirmationToken {
        ConfirmationToken::from_trusted_random(123456789).unwrap()
    }
    fn preview() -> Preview {
        Preview::prepare(parameter(), snapshot(2000, 12), RawValue::Unsigned(2200), token(), NOW, NOW + 100).unwrap()
    }

    /// Only this test fixture mutates in-memory values; no product writer exists.
    struct MockMemory {
        current: Snapshot,
        sends: usize,
    }
    impl MockMemory {
        fn new() -> Self { Self { current: snapshot(2000, 12), sends: 0 } }
        fn read(&self) -> Snapshot { self.current.clone() }
        fn send_simulated(&mut self, value: u64) {
            self.sends += 1;
            self.current.raw = RawValue::Unsigned(value);
            self.current.revision += 1;
        }
    }

    #[test]
    fn mock_success_preview_confirmation_and_bit_exact_readback() {
        let mut memory = MockMemory::new();
        let preview = preview();
        assert_eq!(preview.original(), &RawValue::Unsigned(2000));
        assert_eq!(preview.desired(), &RawValue::Unsigned(2200));
        assert_eq!(preview.original_bytes(), [0xd0, 0x07]);
        assert_eq!(preview.desired_bytes(), [0x98, 0x08]);
        assert_eq!(preview.desired_physical(), Some(1100.0));
        assert_eq!(memory.sends, 0);
        let confirmed = preview.confirm(token(), NOW + 1, &memory.read()).unwrap();
        assert_eq!(confirmed.requested_bytes(), [0x98, 0x08]);
        memory.send_simulated(2200);
        let audit = confirmed.finish(NOW + 2, DispatchEvidence::Sent(SentEvidence::Observed(memory.read())));
        assert_eq!(audit.outcome(), AuditOutcome::Verified);
        assert_eq!(audit.before(), &RawValue::Unsigned(2000));
        assert_eq!(audit.requested(), &RawValue::Unsigned(2200));
        assert_eq!(audit.readback(), Some(&RawValue::Unsigned(2200)));
        assert_eq!(audit.baseline_revision(), 12);
        assert_eq!(audit.observed_revision(), Some(13));
        assert_eq!(audit.recorded_at_ms(), NOW + 2);
        assert_eq!(memory.sends, 1);
    }

    #[test]
    fn typed_range_permission_mapping_and_conversion_fail_closed() {
        let p = parameter();
        for desired in [RawValue::Unsigned(9000), RawValue::Unsigned(65536)] {
            assert_eq!(Preview::prepare(p.clone(), snapshot(2000, 12), desired, token(), NOW, NOW + 1).unwrap_err(), CalibrationError::OutOfRange);
        }
        assert_eq!(Preview::prepare(p.clone(), snapshot(2000, 12), RawValue::Signed(2200), token(), NOW, NOW + 1).unwrap_err(), CalibrationError::WrongRawType);
        let mut denied = p.clone();
        denied.writable = false;
        assert_eq!(Preview::prepare(denied, snapshot(2000, 12), RawValue::Unsigned(2200), token(), NOW, NOW + 1).unwrap_err(), CalibrationError::PermissionDenied);
        let mut link = p.clone();
        link.location = RuntimeLocation::ElfLinkTime(0x1000);
        assert_eq!(Preview::prepare(link, snapshot(2000, 12), RawValue::Unsigned(2200), token(), NOW, NOW + 1).unwrap_err(), CalibrationError::UnresolvedRuntimeAddress);
        let mut invalid = p;
        invalid.location = RuntimeLocation::SimulatorMapped(u32::MAX);
        assert_eq!(Preview::prepare(invalid, snapshot(2000, 12), RawValue::Unsigned(2200), token(), NOW, NOW + 1).unwrap_err(), CalibrationError::InvalidAddressRange);
    }

    #[test]
    fn identity_token_expiry_and_stale_baseline_prevent_dispatch() {
        let mut memory = MockMemory::new();
        assert_eq!(preview().confirm(ConfirmationToken::from_trusted_random(42).unwrap(), NOW + 1, &memory.read()).unwrap_err(), CalibrationError::TokenMismatch);
        assert_eq!(preview().confirm(token(), NOW + 100, &memory.read()).unwrap_err(), CalibrationError::Expired);
        memory.current.revision += 1;
        assert_eq!(preview().confirm(token(), NOW + 1, &memory.read()).unwrap_err(), CalibrationError::StaleBaseline);
        memory.current = snapshot(2300, 12);
        assert_eq!(preview().confirm(token(), NOW + 1, &memory.read()).unwrap_err(), CalibrationError::StaleBaseline);
        memory.current = snapshot(2000, 12);
        memory.current.identity.ecu = "another-ecu".into();
        assert_eq!(preview().confirm(token(), NOW + 1, &memory.read()).unwrap_err(), CalibrationError::IdentityMismatch);
        assert_eq!(memory.sends, 0);
    }

    #[test]
    fn mismatch_rejected_and_readback_faults_are_not_success() {
        let mut memory = MockMemory::new();
        let confirmed = preview().confirm(token(), NOW + 1, &memory.read()).unwrap();
        memory.send_simulated(2199);
        let audit = confirmed.finish(NOW + 2, DispatchEvidence::Sent(SentEvidence::Observed(memory.read())));
        assert_eq!(audit.outcome(), AuditOutcome::ReadbackMismatch);
        assert_eq!(audit.readback(), Some(&RawValue::Unsigned(2199)));

        let rejected = preview().confirm(token(), NOW + 1, &snapshot(2000, 12)).unwrap()
            .finish(NOW + 2, DispatchEvidence::Sent(SentEvidence::Rejected));
        assert_eq!(rejected.outcome(), AuditOutcome::Rejected);
        let stale = preview().confirm(token(), NOW + 1, &snapshot(2000, 12)).unwrap()
            .finish(NOW + 2, DispatchEvidence::Sent(SentEvidence::Observed(snapshot(2200, 12))));
        assert_eq!(stale.outcome(), AuditOutcome::Unknown(UnknownReason::UnversionedReadback));
    }

    #[test]
    fn timeout_or_disconnect_after_send_is_unknown_never_retried() {
        for (evidence, expected) in [
            (SentEvidence::Timeout, UnknownReason::TimeoutAfterSend),
            (SentEvidence::Disconnected, UnknownReason::DisconnectAfterSend),
        ] {
            let mut memory = MockMemory::new();
            let confirmed = preview().confirm(token(), NOW + 1, &memory.read()).unwrap();
            memory.send_simulated(2200); // The simulator may have applied it.
            let audit = confirmed.finish(NOW + 2, DispatchEvidence::Sent(evidence));
            assert_eq!(audit.outcome(), AuditOutcome::Unknown(expected));
            assert_eq!(audit.readback(), None);
            assert_eq!(memory.sends, 1);
        }
        let not_sent = preview().confirm(token(), NOW + 1, &snapshot(2000, 12)).unwrap()
            .finish(NOW + 2, DispatchEvidence::NotSent(NotSentReason::Disconnected));
        assert_eq!(not_sent.outcome(), AuditOutcome::NotSent(NotSentReason::Disconnected));
    }

    #[test]
    fn endian_float_exactness_and_invalid_input() {
        let mut p = parameter();
        p.raw_type = RawType::F32;
        p.byte_order = ByteOrder::Big;
        p.raw_min = RawValue::Float32(-100.0);
        p.raw_max = RawValue::Float32(100.0);
        p.conversion = Conversion::None;
        let initial = Snapshot { identity: identity(), revision: 10, raw: RawValue::Float32(-0.0) };
        let pv = Preview::prepare(p, initial.clone(), RawValue::Float32(0.0), token(), NOW, NOW + 100).unwrap();
        assert_eq!(pv.original_bytes(), [0x80, 0, 0, 0]);
        assert_eq!(pv.desired_bytes(), [0, 0, 0, 0]);
        let done = pv.confirm(token(), NOW + 1, &initial).unwrap();
        let mut readback = initial.clone();
        readback.revision = 11;
        assert_eq!(done.finish(NOW + 2, DispatchEvidence::Sent(SentEvidence::Observed(readback))).outcome(), AuditOutcome::ReadbackMismatch);
        assert_eq!(encode(&RawValue::Float32(f32::NAN), RawType::F32, ByteOrder::Little), Err(CalibrationError::OutOfRange));
        assert_eq!(ConfirmationToken::from_trusted_random(0), Err(CalibrationError::InvalidToken));
    }

    #[test]
    fn identity_revision_readback_and_exact_int_conversion() {
        let mut current = snapshot(2200, 13);
        current.identity.image = "new-image".into();
        let audit = preview().confirm(token(), NOW + 1, &snapshot(2000, 12)).unwrap()
            .finish(NOW + 2, DispatchEvidence::Sent(SentEvidence::Observed(current)));
        assert_eq!(audit.outcome(), AuditOutcome::Unknown(UnknownReason::IdentityChanged));

        let mut p = parameter();
        p.raw_type = RawType::U64;
        p.raw_min = RawValue::Unsigned(0);
        p.raw_max = RawValue::Unsigned(u64::MAX);
        assert_eq!(Preview::prepare(p, Snapshot {identity: identity(), revision: 12, raw: RawValue::Unsigned(2000)}, RawValue::Unsigned((1_u64 << 53) + 1), token(), NOW, NOW + 1).unwrap_err(), CalibrationError::PrecisionLoss);
    }
}

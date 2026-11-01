//! Bounded, read-only ECU runtime address resolution.
//!
//! This core does not connect to an ECU. A caller must independently authenticate
//! the target/image and verify its load mapping before constructing a mapping.
//! A link-time DWARF address without that evidence is never read as ECU memory.
//! Resolved addresses are observations, NOT write permissions or durable read tokens.

use std::collections::HashSet;
use std::time::SystemTime;

use crate::metadata::{
    AddressProvenance, TargetEndian, TargetInfo, TypeDescriptor, TypeKind, TypedVariable,
};

/// Maximum number of path operations, including member selections.
pub const MAX_PATH_STEPS: usize = 24;
/// Maximum number of pointer reads within one resolution.
pub const MAX_POINTER_HOPS: usize = 8;
/// Maximum number of approved memory regions.
pub const MAX_MEMORY_REGIONS: usize = 16;

/// A verified target identity snapshot. Generations must change on reconnect,
/// firmware replacement, and runtime mapping refresh respectively.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct EcuIdentity {
    pub ecu_fingerprint: [u8; 16],
    pub image_fingerprint: [u8; 16],
    pub session_generation: u64,
    pub mapping_generation: u64,
}

/// Inclusive range of addresses represented by a start and a nonzero length.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct MemoryRegion {
    pub start: u64,
    pub length: u64,
}

impl MemoryRegion {
    fn end(self) -> Option<u64> {
        self.length.checked_sub(1)?.checked_add(self.start)
    }

    fn contains(self, address: u64, bytes: u64) -> bool {
        matches!(
            (self.end(), bytes.checked_sub(1).and_then(|n| address.checked_add(n))),
            (Some(end), Some(last)) if address >= self.start && last <= end
        )
    }
}

/// Mapping established by a separate, trusted ECU/image verification step.
///
/// Construction alone does not verify a physical ECU: the future session adapter
/// MUST validate identity and link-to-runtime relocation independently. Both
/// regions must describe the same contiguous image segment.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct RuntimeMapping {
    pub identity: EcuIdentity,
    pub link_region: MemoryRegion,
    pub runtime_region: MemoryRegion,
    pub target_endian: TargetEndian,
    pub pointer_bytes: u8,
}

/// A deliberately restricted source of a runtime root location.
///
/// No variant accepts an arbitrary ELF address as a runtime address. Runtime
/// expressions, register locations and location lists need a later evaluator.
#[derive(Debug, Clone, Copy)]
pub enum RootLocation<'a> {
    Unmapped,
    Mapped(&'a RuntimeMapping),
}

/// A type-safe traversal step. The caller supplies the canonical pointee
/// descriptor; its name must match the pointer's DWARF element type.
#[derive(Debug, Clone, Copy)]
pub enum PathStep<'a> {
    Dereference { pointee: &'a TypeDescriptor },
    Member(&'a str),
}

/// Read-only, complete-or-error memory operations. The implementation must
/// bound its own latency and serialize XCP reads when connected in the future.
pub trait MemoryReader {
    type Error;

    fn current_identity(&self) -> Result<EcuIdentity, Self::Error>;
    fn read_exact(&mut self, address: u64, buffer: &mut [u8]) -> Result<(), Self::Error>;
}

#[derive(Debug, Clone, PartialEq, Eq, thiserror::Error)]
pub enum ResolveError {
    #[error("a runtime mapping is required for this link-time address")]
    UnverifiedLinkTime,
    #[error("unsupported DWARF location expression")]
    UnsupportedLocation,
    #[error("no usable variable location")]
    UnavailableLocation,
    #[error("invalid runtime image mapping or approved region")]
    InvalidMapping,
    #[error("ECU, image, session or mapping identity is stale")]
    StaleIdentity,
    #[error("memory reader could not verify the ECU identity")]
    IdentityUnavailable,
    #[error("memory read failed")]
    MemoryFault,
    #[error("unsupported or inconsistent pointer width or target endianness")]
    LayoutMismatch,
    #[error("path or pointer depth limit exceeded")]
    LimitExceeded,
    #[error("unsupported type or mismatched pointee")]
    TypeMismatch,
    #[error("missing or invalid struct member offset")]
    InvalidMember,
    #[error("missing or zero-sized type")]
    UnknownSize,
    #[error("address calculation overflow")]
    AddressOverflow,
    #[error("memory address is outside approved runtime regions")]
    OutOfRegion,
    #[error("NULL pointer cannot be dereferenced")]
    NullPointer,
    #[error("cyclic pointer chain")]
    PointerCycle,
}

/// Read-only resolution audit step, retained only in the core result.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ResolutionOperation {
    Dereference,
    Member(String),
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ResolutionStep {
    pub operation: ResolutionOperation,
    pub source_address: u64,
    pub resolved_address: u64,
}

/// A point-in-time observation; consumers must revalidate identity and refresh
/// pointer contents before subsequent reads. Never use this as write authority.
#[derive(Debug, Clone)]
pub struct ResolvedAddress {
    pub address: u64,
    pub byte_size: u64,
    pub type_kind: TypeKind,
    pub source: AddressProvenance,
    pub steps: Vec<ResolutionStep>,
    pub identity: EcuIdentity,
    pub observed_at: SystemTime,
    pub observation_version: u64,
}

impl ResolvedAddress {
    /// Check only identity freshness; it cannot prove pointer contents unchanged.
    pub fn identity_is_current<R: MemoryReader>(&self, reader: &R) -> bool {
        reader.current_identity().is_ok_and(|id| id == self.identity)
    }
}

fn check_identity<R: MemoryReader>(
    reader: &R,
    expected: EcuIdentity,
) -> Result<(), ResolveError> {
    let actual = reader
        .current_identity()
        .map_err(|_| ResolveError::IdentityUnavailable)?;
    if actual == expected {
        Ok(())
    } else {
        Err(ResolveError::StaleIdentity)
    }
}

fn check_address(address: u64, size: u64, pointer_bytes: u8) -> Result<(), ResolveError> {
    let last = address
        .checked_add(size.checked_sub(1).ok_or(ResolveError::UnknownSize)?)
        .ok_or(ResolveError::AddressOverflow)?;
    if pointer_bytes == 4 && last > u32::MAX as u64 {
        return Err(ResolveError::AddressOverflow);
    }
    Ok(())
}

fn allow_read(
    address: u64,
    size: u64,
    pointer_bytes: u8,
    regions: &[MemoryRegion],
) -> Result<(), ResolveError> {
    check_address(address, size, pointer_bytes)?;
    if regions.iter().any(|region| region.contains(address, size)) {
        Ok(())
    } else {
        Err(ResolveError::OutOfRegion)
    }
}

fn decode_pointer(bytes: &[u8], endian: TargetEndian) -> u64 {
    let mut buf = [0; 8];
    match endian {
        TargetEndian::Little => {
            buf[..bytes.len()].copy_from_slice(bytes);
            u64::from_le_bytes(buf)
        }
        TargetEndian::Big => {
            buf[8 - bytes.len()..].copy_from_slice(bytes);
            u64::from_be_bytes(buf)
        }
    }
}

/// Resolve a typed variable within a verified, bounded runtime image mapping.
///
/// The supplied mapping is external evidence, not inferred from DWARF. All reads
/// are explicitly allowlisted and scoped to the mapping's ECU identity. Caller
/// must supply a fresh observation version on every resolution attempt.
pub fn resolve<R: MemoryReader>(
    reader: &mut R,
    variable: &TypedVariable,
    target: &TargetInfo,
    root: RootLocation<'_>,
    path: &[PathStep<'_>],
    approved_regions: &[MemoryRegion],
    observation_version: u64,
) -> Result<ResolvedAddress, ResolveError> {
    if path.len() > MAX_PATH_STEPS
        || approved_regions.is_empty()
        || approved_regions.len() > MAX_MEMORY_REGIONS
    {
        return Err(ResolveError::LimitExceeded);
    }

    let mapping = match (&variable.address, root) {
        (AddressProvenance::LinkTime(_), RootLocation::Unmapped) => {
            return Err(ResolveError::UnverifiedLinkTime)
        }
        (AddressProvenance::RuntimeExpression, _) => {
            return Err(ResolveError::UnsupportedLocation)
        }
        (AddressProvenance::Unavailable, _) => return Err(ResolveError::UnavailableLocation),
        (AddressProvenance::LinkTime(_), RootLocation::Mapped(mapping)) => mapping,
    };

    if !matches!(mapping.pointer_bytes, 4 | 8)
        || target.elf_address_bytes != mapping.pointer_bytes
        || target.endian != mapping.target_endian
    {
        return Err(ResolveError::LayoutMismatch);
    }
    if mapping.link_region.end().is_none()
        || mapping.runtime_region.end().is_none()
        || mapping.link_region.length != mapping.runtime_region.length
        || approved_regions.iter().any(|region| region.end().is_none())
    {
        return Err(ResolveError::InvalidMapping);
    }

    check_identity(reader, mapping.identity)?;

    let link_address = match variable.address {
        AddressProvenance::LinkTime(address) => address,
        _ => unreachable!("location was checked above"),
    };
    if !mapping.link_region.contains(link_address, 1) {
        return Err(ResolveError::InvalidMapping);
    }
    let offset = link_address - mapping.link_region.start;
    let mut address = mapping
        .runtime_region
        .start
        .checked_add(offset)
        .ok_or(ResolveError::AddressOverflow)?;
    check_address(address, 1, mapping.pointer_bytes)?;

    let mut descriptor = &variable.descriptor;
    let mut steps = Vec::with_capacity(path.len());
    let mut visited = HashSet::new();
    let mut hops = 0;

    for step in path {
        match step {
            PathStep::Member(name) => {
                if !matches!(descriptor.kind, TypeKind::Structure | TypeKind::Union) {
                    return Err(ResolveError::TypeMismatch);
                }
                let member = descriptor
                    .members
                    .iter()
                    .find(|member| member.name == *name)
                    .ok_or(ResolveError::InvalidMember)?;
                let parent_size = descriptor.byte_size.ok_or(ResolveError::UnknownSize)?;
                let member_size = member.descriptor.byte_size.ok_or(ResolveError::UnknownSize)?;
                let offset = member.byte_offset.ok_or(ResolveError::InvalidMember)?;
                if member_size == 0 || offset.checked_add(member_size).is_none_or(|end| end > parent_size) {
                    return Err(ResolveError::InvalidMember);
                }
                let next = address.checked_add(offset).ok_or(ResolveError::AddressOverflow)?;
                allow_read(next, member_size, mapping.pointer_bytes, approved_regions)?;
                steps.push(ResolutionStep {
                    operation: ResolutionOperation::Member((*name).to_owned()),
                    source_address: address,
                    resolved_address: next,
                });
                address = next;
                descriptor = &member.descriptor;
            }
            PathStep::Dereference { pointee } => {
                hops += 1;
                if hops > MAX_POINTER_HOPS {
                    return Err(ResolveError::LimitExceeded);
                }
                if descriptor.kind != TypeKind::Pointer
                    || descriptor.byte_size != Some(u64::from(mapping.pointer_bytes))
                    || descriptor.element_type.as_deref() != Some(pointee.name.as_str())
                    || pointee.name.is_empty()
                {
                    return Err(ResolveError::TypeMismatch);
                }
                if !visited.insert(address) {
                    return Err(ResolveError::PointerCycle);
                }
                allow_read(
                    address,
                    u64::from(mapping.pointer_bytes),
                    mapping.pointer_bytes,
                    approved_regions,
                )?;
                check_identity(reader, mapping.identity)?;
                let mut buffer = [0_u8; 8];
                let bytes = usize::from(mapping.pointer_bytes);
                reader
                    .read_exact(address, &mut buffer[..bytes])
                    .map_err(|_| ResolveError::MemoryFault)?;
                check_identity(reader, mapping.identity)?;
                let next = decode_pointer(&buffer[..bytes], mapping.target_endian);
                if next == 0 {
                    return Err(ResolveError::NullPointer);
                }
                check_address(next, 1, mapping.pointer_bytes)?;
                steps.push(ResolutionStep {
                    operation: ResolutionOperation::Dereference,
                    source_address: address,
                    resolved_address: next,
                });
                address = next;
                descriptor = pointee;
            }
        }
    }

    let byte_size = descriptor.byte_size.ok_or(ResolveError::UnknownSize)?;
    allow_read(address, byte_size, mapping.pointer_bytes, approved_regions)?;
    check_identity(reader, mapping.identity)?;
    Ok(ResolvedAddress {
        address,
        byte_size,
        type_kind: descriptor.kind,
        source: variable.address.clone(),
        steps,
        identity: mapping.identity,
        observed_at: SystemTime::now(),
        observation_version,
    })
}

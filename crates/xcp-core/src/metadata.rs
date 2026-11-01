//! Read-only DWARF type inspection. Addresses from firmware images are not ECU runtime addresses.
//!
//! The parser deliberately does not evaluate arbitrary DWARF location expressions or
//! dereference pointer values. Consumers must perform separate runtime validation.

use std::collections::{HashMap, HashSet};
use std::rc::Rc;

use gimli::{AttributeValue, EndianRcSlice, Operation, Reader, ReaderOffset, RunTimeEndian};
use object::{Object, ObjectSection};

const MAX_ELF_SIZE: usize = 32 * 1024 * 1024;
const MAX_DIES: usize = 200_000;
const MAX_TYPE_DEPTH: usize = 16;
const MAX_MEMBERS: usize = 256;
const MAX_VARIABLES: usize = 50_000;
const MAX_EXPANDED_TYPES: usize = 100_000;
const MAX_LOCATION_OPERATIONS: usize = 16;

/// Target byte order encoded by the ELF, independent of the host machine.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum TargetEndian {
    Little,
    Big,
}

/// Static target information; a runtime ECU layout must be checked separately.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct TargetInfo {
    pub architecture: String,
    pub elf_address_bytes: u8,
    pub endian: TargetEndian,
}

/// Classified DWARF type family.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum TypeKind {
    SignedInteger,
    UnsignedInteger,
    FloatingPoint,
    Boolean,
    Enumeration,
    Pointer,
    Array,
    Structure,
    Union,
    Unknown,
}

/// Named struct/union member. A missing offset is never interpreted as zero.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct TypeMember {
    pub name: String,
    pub byte_offset: Option<u64>,
    pub descriptor: TypeDescriptor,
}

/// Bounded, owned type metadata, suitable for inspection without ECU I/O.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct TypeDescriptor {
    pub name: String,
    pub kind: TypeKind,
    pub byte_size: Option<u64>,
    pub element_count: Option<u64>,
    pub element_type: Option<String>,
    pub members: Vec<TypeMember>,
}

/// Why the firmware metadata cannot yet be used as an ECU address.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum AddressProvenance {
    /// DW_OP_addr in a firmware image: still requires ECU load/relocation validation.
    LinkTime(u64),
    /// A register, frame-relative, location-list or other expression needs evaluation.
    RuntimeExpression,
    /// The declaration has no supported location attribute.
    Unavailable,
}

/// A variable declaration with a resolved *static type*, not a resolved runtime address.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct TypedVariable {
    pub name: String,
    pub compilation_unit: Option<String>,
    pub descriptor: TypeDescriptor,
    pub address: AddressProvenance,
}

/// A bounded snapshot of compiler metadata.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct TypedDwarf {
    pub target: TargetInfo,
    pub has_debug_info: bool,
    pub compilation_units: usize,
    pub variables: Vec<TypedVariable>,
}

#[derive(Debug, thiserror::Error)]
pub enum MetadataError {
    #[error("invalid or unsupported object file: {0}")]
    Object(#[from] object::Error),
    #[error("malformed DWARF metadata: {0}")]
    Dwarf(#[from] gimli::Error),
    #[error("expected an ELF image")]
    NotElf,
    #[error("ELF image exceeds the 32 MiB metadata limit")]
    TooLarge,
    #[error("relocatable ELF needs DWARF relocation application before type inspection")]
    RelocatableUnsupported,
    #[error("DWARF metadata exceeds the bounded inspection limit")]
    LimitExceeded,
}

#[derive(Debug, Clone)]
struct Die {
    id: u64,
    parent: Option<u64>,
    tag: gimli::DwTag,
    name: Option<String>,
    type_id: Option<u64>,
    byte_size: Option<u64>,
    encoding: Option<u64>,
    count: Option<u64>,
    member_offset: Option<u64>,
    location: AddressProvenance,
}

fn numeric<R: Reader>(entry: &gimli::DebuggingInformationEntry<R>, name: gimli::DwAt) -> Result<Option<u64>, gimli::Error> {
    Ok(entry.attr(name)?.and_then(|attr| attr.udata_value()))
}

/// Interpret integer DWARF attributes without treating signed negative values as offsets.
fn scalar<R: Reader>(
    entry: &gimli::DebuggingInformationEntry<R>,
    name: gimli::DwAt,
) -> Result<Option<i128>, gimli::Error> {
    Ok(match entry.attr_value(name)? {
        Some(AttributeValue::Sdata(value)) => Some(i128::from(value)),
        Some(attribute) => attribute.udata_value().map(i128::from),
        None => None,
    })
}

/// DW_AT_count is an extent; DW_AT_upper_bound is an inclusive index.
/// An explicit lower bound must be subtracted before computing the extent.
/// For C-style subranges without a lower bound, DWARF defaults to zero.
fn subrange_count<R: Reader>(
    entry: &gimli::DebuggingInformationEntry<R>,
) -> Result<Option<u64>, gimli::Error> {
    if let Some(count) = numeric(entry, gimli::DW_AT_count)? {
        return Ok(Some(count));
    }
    let Some(upper) = scalar(entry, gimli::DW_AT_upper_bound)? else {
        return Ok(None);
    };
    let lower = scalar(entry, gimli::DW_AT_lower_bound)?.unwrap_or(0);
    Ok(upper
        .checked_sub(lower)
        .and_then(|difference| difference.checked_add(1))
        .and_then(|extent| u64::try_from(extent).ok()))
}

/// Decode only a single constant member-offset operation. DW_OP_plus_uconst
/// operates on the implicit containing-object address for a member attribute.
/// Register/frame calculations, dereferences, multiple operations and oversized
/// expressions cannot be promoted to a static member offset.
fn constant_member_expression<R: Reader>(
    expression: gimli::Expression<R>,
    encoding: gimli::Encoding,
) -> Result<Option<u64>, gimli::Error> {
    let mut operations = expression.operations(encoding);
    let mut offset = None;
    for index in 0..MAX_LOCATION_OPERATIONS {
        match operations.next()? {
            None => return Ok(offset),
            Some(operation) if index == 0 => {
                offset = match operation {
                    Operation::PlusConstant { value } | Operation::UnsignedConstant { value } => {
                        Some(value)
                    }
                    Operation::SignedConstant { value } => u64::try_from(value).ok(),
                    _ => None,
                };
            }
            Some(_) => return Ok(None),
        }
    }
    Ok(None)
}

fn member_location<R: Reader>(
    entry: &gimli::DebuggingInformationEntry<R>,
    unit: &gimli::Unit<R>,
) -> Result<Option<u64>, gimli::Error> {
    match entry.attr_value(gimli::DW_AT_data_member_location)? {
        Some(AttributeValue::Exprloc(expr)) => {
            constant_member_expression(expr, unit.encoding())
        }
        Some(AttributeValue::Sdata(value)) => Ok(u64::try_from(value).ok()),
        Some(value) => Ok(value.udata_value()),
        None => Ok(None),
    }
}

fn unit_reference<R: Reader>(
    entry: &gimli::DebuggingInformationEntry<R>,
) -> Result<Option<u64>, gimli::Error> {
    Ok(match entry.attr_value(gimli::DW_AT_type)? {
        Some(AttributeValue::UnitRef(offset)) => Some(offset.0.into_u64()),
        _ => None,
    })
}

fn short_name<R: Reader>(
    dwarf: &gimli::Dwarf<R>,
    unit: &gimli::Unit<R>,
    entry: &gimli::DebuggingInformationEntry<R>,
) -> Result<Option<String>, gimli::Error> {
    let Some(attr) = entry.attr_value(gimli::DW_AT_name)? else {
        return Ok(None);
    };
    let reader = dwarf.attr_string(unit, attr)?;
    let text = reader.to_string_lossy()?;
    Ok(Some(text.chars().take(512).collect()))
}

fn location<R: Reader>(
    entry: &gimli::DebuggingInformationEntry<R>,
    unit: &gimli::Unit<R>,
) -> Result<AddressProvenance, gimli::Error> {
    match entry.attr_value(gimli::DW_AT_location)? {
        Some(AttributeValue::Exprloc(expr)) => {
            let mut operations = expr.operations(unit.encoding());
            match (operations.next()?, operations.next()?) {
                (Some(Operation::Address { address }), None) => {
                    Ok(AddressProvenance::LinkTime(address))
                }
                _ => Ok(AddressProvenance::RuntimeExpression),
            }
        }
        Some(_) => Ok(AddressProvenance::RuntimeExpression),
        None => Ok(AddressProvenance::Unavailable),
    }
}

fn unknown_type() -> TypeDescriptor {
    TypeDescriptor {
        name: "<unresolved>".into(),
        kind: TypeKind::Unknown,
        byte_size: None,
        element_count: None,
        element_type: None,
        members: Vec::new(),
    }
}

fn resolve_type(
    id: Option<u64>,
    dies: &HashMap<u64, Die>,
    visiting: &mut HashSet<u64>,
    depth: usize,
    remaining: &mut usize,
) -> TypeDescriptor {
    let Some(id) = id else { return unknown_type(); };
    if depth >= MAX_TYPE_DEPTH || *remaining == 0 || !visiting.insert(id) {
        return unknown_type();
    }
    *remaining -= 1;
    let result = (|| {
        let Some(die) = dies.get(&id) else { return unknown_type(); };
        let tag = die.tag;
        let name = die.name.clone().unwrap_or_else(|| "<anonymous>".into());
        let mut desc = TypeDescriptor {
            name,
            kind: TypeKind::Unknown,
            byte_size: die.byte_size,
            element_count: None,
            element_type: None,
            members: Vec::new(),
        };
        match tag {
            gimli::DW_TAG_base_type => {
                desc.kind = match die.encoding {
                    Some(e) if e == u64::from(gimli::DW_ATE_signed.0)
                        || e == u64::from(gimli::DW_ATE_signed_char.0) => TypeKind::SignedInteger,
                    Some(e) if e == u64::from(gimli::DW_ATE_unsigned.0)
                        || e == u64::from(gimli::DW_ATE_unsigned_char.0)
                        || e == u64::from(gimli::DW_ATE_address.0) => TypeKind::UnsignedInteger,
                    Some(e) if e == u64::from(gimli::DW_ATE_float.0) => TypeKind::FloatingPoint,
                    Some(e) if e == u64::from(gimli::DW_ATE_boolean.0) => TypeKind::Boolean,
                    _ => TypeKind::Unknown,
                };
            }
            gimli::DW_TAG_enumeration_type => {
                desc.kind = TypeKind::Enumeration;
            }
            gimli::DW_TAG_pointer_type => {
                desc.kind = TypeKind::Pointer;
                desc.element_type = die.type_id.map(|pointee| {
                    dies.get(&pointee)
                        .and_then(|d| d.name.clone())
                        .unwrap_or_else(|| "<anonymous>".into())
                });
            }
            gimli::DW_TAG_array_type => {
                desc.kind = TypeKind::Array;
                let element = resolve_type(die.type_id, dies, visiting, depth + 1, remaining);
                desc.element_type = Some(element.name);
                let mut dimensions = 0_usize;
                let count = dies.values()
                    .filter(|child| child.parent == Some(id) && child.tag == gimli::DW_TAG_subrange_type)
                    .try_fold(1_u64, |count, child| {
                        dimensions += 1;
                        count.checked_mul(child.count?)
                    });
                desc.element_count = if dimensions == 0 { None } else { count };
                if desc.byte_size.is_none() {
                    desc.byte_size = element.byte_size
                        .and_then(|width| desc.element_count.and_then(|n| width.checked_mul(n)));
                }
            }
            gimli::DW_TAG_structure_type | gimli::DW_TAG_union_type => {
                desc.kind = if tag == gimli::DW_TAG_union_type {
                    TypeKind::Union
                } else {
                    TypeKind::Structure
                };
                let mut members: Vec<_> = dies.values()
                    .filter(|child| child.parent == Some(id) && child.tag == gimli::DW_TAG_member)
                    .collect();
                members.sort_by_key(|m| m.id);
                for member in members {
                    let descriptor = resolve_type(member.type_id, dies, visiting, depth + 1, remaining);
                    let byte_offset = match (member.member_offset, desc.byte_size, descriptor.byte_size) {
                        (Some(offset), Some(container_size), Some(member_size))
                            if offset.checked_add(member_size).is_none_or(|end| end > container_size) => None,
                        (offset, _, _) => offset,
                    };
                    desc.members.push(TypeMember {
                        name: member.name.clone().unwrap_or_else(|| "<anonymous>".into()),
                        byte_offset,
                        descriptor,
                    });
                }
            }
            gimli::DW_TAG_typedef | gimli::DW_TAG_const_type
                | gimli::DW_TAG_volatile_type | gimli::DW_TAG_restrict_type => {
                let mut underlying = resolve_type(die.type_id, dies, visiting, depth + 1, remaining);
                if let Some(alias) = &die.name {
                    underlying.name = alias.clone();
                }
                if desc.byte_size.is_some() {
                    underlying.byte_size = desc.byte_size;
                }
                return underlying;
            }
            _ => {}
        }
        desc
    })();
    visiting.remove(&id);
    result
}

/// Parse ELF and DWARF type metadata without accessing target ECU memory.
///
/// Constant DW_OP_addr values are always link-time provenance, never confirmed
/// read/write addresses. Unsupported location programs remain unevaluated.
pub fn inspect_typed_dwarf(bytes: &[u8]) -> Result<TypedDwarf, MetadataError> {
    if bytes.len() > MAX_ELF_SIZE {
        return Err(MetadataError::TooLarge);
    }
    let file = object::File::parse(bytes)?;
    if file.format() != object::BinaryFormat::Elf {
        return Err(MetadataError::NotElf);
    }
    let endian = if file.is_little_endian() {
        RunTimeEndian::Little
    } else {
        RunTimeEndian::Big
    };
    let target = TargetInfo {
        architecture: format!("{:?}", file.architecture()),
        elf_address_bytes: if file.is_64() { 8 } else { 4 },
        endian: if file.is_little_endian() { TargetEndian::Little } else { TargetEndian::Big },
    };
    let has_debug_info = file.section_by_name(".debug_info")
        .map(|section| section.size() > 0).unwrap_or(false);
    let mut result = TypedDwarf {
        target,
        has_debug_info,
        compilation_units: 0,
        variables: Vec::new(),
    };
    if !has_debug_info {
        return Ok(result);
    }
    if file.kind() == object::ObjectKind::Relocatable {
        return Err(MetadataError::RelocatableUnsupported);
    }
    let dwarf = gimli::Dwarf::load(|section_id| {
        let bytes = match file.section_by_name(section_id.name()) {
            Some(section) => section.uncompressed_data()?.into_owned(),
            None => Vec::new(),
        };
        if bytes.len() > MAX_ELF_SIZE {
            return Err(MetadataError::LimitExceeded);
        }
        Ok::<_, MetadataError>(EndianRcSlice::new(Rc::from(bytes), endian))
    })?;
    let mut units = dwarf.units();
    let mut total_dies = 0_usize;
    let mut expansion_budget = MAX_EXPANDED_TYPES;
    while let Some(header) = units.next()? {
        result.compilation_units += 1;
        let unit = dwarf.unit(header)?;
        let mut cursor = unit.entries();
        let mut depth = 0_isize;
        let mut parents: Vec<u64> = Vec::new();
        let mut dies = HashMap::new();
        let mut member_counts = HashMap::<u64, usize>::new();
        let mut variables = Vec::new();
        let mut unit_name = None;
        while let Some((delta, entry)) = cursor.next_dfs()? {
            total_dies += 1;
            if total_dies > MAX_DIES {
                return Err(MetadataError::LimitExceeded);
            }
            depth = (depth + delta).max(0);
            let depth = usize::try_from(depth).map_err(|_| MetadataError::LimitExceeded)?;
            if depth > MAX_TYPE_DEPTH * 16 {
                return Err(MetadataError::LimitExceeded);
            }
            parents.truncate(depth);
            let id = entry.offset().0.into_u64();
            let parent = parents.last().copied();
            let die = Die {
                id,
                parent,
                tag: entry.tag(),
                name: short_name(&dwarf, &unit, entry)?,
                type_id: unit_reference(entry)?,
                byte_size: numeric(entry, gimli::DW_AT_byte_size)?,
                encoding: numeric(entry, gimli::DW_AT_encoding)?,
                count: subrange_count(entry)?,
                member_offset: if entry.tag() == gimli::DW_TAG_member {
                    member_location(entry, &unit)?
                } else {
                    None
                },
                location: if entry.tag() == gimli::DW_TAG_variable {
                    location(entry, &unit)?
                } else {
                    AddressProvenance::Unavailable
                },
            };
            if die.tag == gimli::DW_TAG_member {
                let Some(parent) = die.parent else {
                    return Err(MetadataError::LimitExceeded);
                };
                let count = member_counts.entry(parent).or_insert(0);
                *count += 1;
                if *count > MAX_MEMBERS {
                    return Err(MetadataError::LimitExceeded);
                }
            }
            if die.tag == gimli::DW_TAG_compile_unit {
                unit_name = die.name.clone();
            }
            if die.tag == gimli::DW_TAG_variable && die.name.is_some() {
                variables.push(id);
            }
            dies.insert(id, die);
            parents.push(id);
        }
        for id in variables {
            if result.variables.len() >= MAX_VARIABLES {
                return Err(MetadataError::LimitExceeded);
            }
            let die = &dies[&id];
            let descriptor = resolve_type(
                die.type_id, &dies, &mut HashSet::new(), 0, &mut expansion_budget,
            );
            if expansion_budget == 0 {
                return Err(MetadataError::LimitExceeded);
            }
            result.variables.push(TypedVariable {
                name: die.name.clone().unwrap_or_default(),
                compilation_unit: unit_name.clone(),
                descriptor,
                address: die.location.clone(),
            });
        }
    }
    Ok(result)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn die(id: u64, tag: gimli::DwTag, name: &str, type_id: Option<u64>) -> Die {
        Die {
            id,
            parent: None,
            tag,
            name: Some(name.into()),
            type_id,
            byte_size: None,
            encoding: None,
            count: None,
            member_offset: None,
            location: AddressProvenance::Unavailable,
        }
    }

    #[test]
    fn rejects_invalid_and_oversized_input() {
        assert!(inspect_typed_dwarf(b"not an ELF").is_err());
        assert!(matches!(
            inspect_typed_dwarf(&vec![0; MAX_ELF_SIZE + 1]),
            Err(MetadataError::TooLarge)
        ));
    }

    #[test]
    fn describes_nested_types_without_inventing_offsets() {
        let mut nodes = HashMap::new();
        let mut integer = die(1, gimli::DW_TAG_base_type, "int32_t", None);
        integer.encoding = Some(u64::from(gimli::DW_ATE_signed.0));
        integer.byte_size = Some(4);
        nodes.insert(1, integer);
        nodes.insert(2, die(2, gimli::DW_TAG_structure_type, "Engine", None));
        let mut rpm = die(3, gimli::DW_TAG_member, "rpm", Some(1));
        rpm.parent = Some(2);
        rpm.member_offset = Some(8);
        nodes.insert(3, rpm);
        let mut spare = die(4, gimli::DW_TAG_member, "unknown_offset", Some(1));
        spare.parent = Some(2);
        nodes.insert(4, spare);
        let desc = resolve_type(Some(2), &nodes, &mut HashSet::new(), 0, &mut 1024);
        assert_eq!(desc.kind, TypeKind::Structure);
        assert_eq!(desc.members.len(), 2);
        assert_eq!(desc.members[0].byte_offset, Some(8));
        assert_eq!(desc.members[1].byte_offset, None);
        assert_eq!(desc.members[0].descriptor.kind, TypeKind::SignedInteger);
    }

    #[test]
    fn bounds_recursive_typedef_and_array_overflow() {
        let mut nodes = HashMap::new();
        nodes.insert(1, die(1, gimli::DW_TAG_typedef, "Self", Some(1)));
        assert_eq!(
            resolve_type(Some(1), &nodes, &mut HashSet::new(), 0, &mut 1024).kind,
            TypeKind::Unknown
        );
        let mut array = die(2, gimli::DW_TAG_array_type, "buffer", Some(3));
        array.byte_size = None;
        nodes.insert(2, array);
        let mut subrange = die(4, gimli::DW_TAG_subrange_type, "length", None);
        subrange.parent = Some(2);
        subrange.count = Some(u64::MAX);
        nodes.insert(4, subrange);
        let mut subrange2 = die(5, gimli::DW_TAG_subrange_type, "other", None);
        subrange2.parent = Some(2);
        subrange2.count = Some(2);
        nodes.insert(5, subrange2);
        let mut elt = die(3, gimli::DW_TAG_base_type, "u8", None);
        elt.byte_size = Some(1);
        nodes.insert(3, elt);
        let desc = resolve_type(Some(2), &nodes, &mut HashSet::new(), 0, &mut 1024);
        assert_eq!(desc.kind, TypeKind::Array);
        assert_eq!(desc.element_count, None);
        assert_eq!(desc.byte_size, None);
    }

    #[test]
    fn missing_subrange_is_not_assumed_to_have_one_element() {
        let mut nodes = HashMap::new();
        nodes.insert(1, die(1, gimli::DW_TAG_array_type, "unknown_length", None));
        let desc = resolve_type(Some(1), &nodes, &mut HashSet::new(), 0, &mut 1024);
        assert_eq!(desc.element_count, None);
    }

    #[test]
    fn member_expressions_accept_only_static_offsets() {
        let encoding = gimli::Encoding {
            format: gimli::Format::Dwarf32,
            version: 4,
            address_size: 8,
        };
        let decode = |bytes: &[u8]| {
            constant_member_expression(
                gimli::Expression(gimli::EndianSlice::new(bytes, RunTimeEndian::Little)),
                encoding,
            )
        };
        // DW_OP_plus_uconst 8, DW_OP_constu 42, and DW_OP_consts -1.
        assert_eq!(decode(&[0x23, 0x08]).unwrap(), Some(8));
        assert_eq!(decode(&[0x10, 0x2a]).unwrap(), Some(42));
        assert_eq!(decode(&[0x11, 0x7f]).unwrap(), None);
        // Runtime dereference must not become a static member offset.
        assert_eq!(decode(&[0x23, 0x08, 0x06]).unwrap(), None);
        // Truncated ULEB128 is invalid DWARF, not a zero offset.
        assert!(decode(&[0x23, 0x80]).is_err());
    }

    #[test]
    fn rejects_member_offsets_outside_aggregate_size() {
        let mut nodes = HashMap::new();
        let mut field = die(1, gimli::DW_TAG_base_type, "u32", None);
        field.byte_size = Some(4);
        nodes.insert(1, field);
        let mut structure = die(2, gimli::DW_TAG_structure_type, "Layout", None);
        structure.byte_size = Some(8);
        nodes.insert(2, structure);
        let mut good = die(3, gimli::DW_TAG_member, "good", Some(1));
        good.parent = Some(2);
        good.member_offset = Some(4);
        nodes.insert(3, good);
        let mut invalid = die(4, gimli::DW_TAG_member, "invalid", Some(1));
        invalid.parent = Some(2);
        invalid.member_offset = Some(u64::MAX);
        nodes.insert(4, invalid);
        let layout = resolve_type(Some(2), &nodes, &mut HashSet::new(), 0, &mut 1024);
        assert_eq!(layout.members[0].byte_offset, Some(4));
        assert_eq!(layout.members[1].byte_offset, None);
    }
}

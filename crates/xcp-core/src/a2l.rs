//! Read-only A2L snapshot, numeric conversions, and ELF/DWARF comparison.
//!
//! The A2L addresses are unverified declarations, not validated ECU runtime
//! addresses. This module never performs XCP memory accesses or calibration writes.

use std::collections::{HashMap, HashSet};

use a2lfile::{A2lObjectName, ConversionType, DataType};
use crate::metadata::{AddressProvenance, TypeKind, TypedVariable};

/// Input limit applied before handing untrusted text to the external parser.
pub const MAX_A2L_BYTES: usize = 8 * 1024 * 1024;
const MAX_OBJECTS: usize = 20_000;

#[derive(Debug, thiserror::Error)]
pub enum A2lError {
    #[error("A2L file is empty or exceeds the 8 MiB limit")]
    InputLimit,
    #[error("malformed A2L: {0}")]
    Parse(String),
    #[error("A2L object count exceeds the 20000-item limit")]
    ObjectLimit,
    #[error("invalid A2L limits for {0}")]
    InvalidLimits(String),
    #[error("unknown conversion method: {0}")]
    MissingConversion(String),
    #[error("unsupported conversion: {0}")]
    UnsupportedConversion(String),
    #[error("invalid or non-finite raw/physical value")]
    InvalidValue,
    #[error("physical value outside declared range")]
    OutOfRange,
    #[error("unsupported or missing raw data type / byte order")]
    UnsupportedEncoding,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum RawType {
    U8, I8, U16, I16, U32, I32, U64, I64, F16, F32, F64,
}
impl RawType {
    pub fn from_a2l(value: DataType) -> Self {
        match value {
            DataType::Ubyte => Self::U8,
            DataType::Sbyte => Self::I8,
            DataType::Uword => Self::U16,
            DataType::Sword => Self::I16,
            DataType::Ulong => Self::U32,
            DataType::Slong => Self::I32,
            DataType::AUint64 => Self::U64,
            DataType::AInt64 => Self::I64,
            DataType::Float16Ieee => Self::F16,
            DataType::Float32Ieee => Self::F32,
            DataType::Float64Ieee => Self::F64,
        }
    }
    pub fn width(self) -> u64 {
        match self {
            Self::U8 | Self::I8 => 1,
            Self::U16 | Self::I16 | Self::F16 => 2,
            Self::U32 | Self::I32 | Self::F32 => 4,
            Self::U64 | Self::I64 | Self::F64 => 8,
        }
    }
    fn kind(self) -> TypeKind {
        match self {
            Self::U8 | Self::U16 | Self::U32 | Self::U64 => TypeKind::UnsignedInteger,
            Self::I8 | Self::I16 | Self::I32 | Self::I64 => TypeKind::SignedInteger,
            Self::F16 | Self::F32 | Self::F64 => TypeKind::FloatingPoint,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ByteOrder { Little, Big }

fn byte_order(value: a2lfile::ByteOrderEnum) -> Option<ByteOrder> {
    match value {
        a2lfile::ByteOrderEnum::LittleEndian | a2lfile::ByteOrderEnum::MsbLast => Some(ByteOrder::Little),
        a2lfile::ByteOrderEnum::BigEndian | a2lfile::ByteOrderEnum::MsbFirst => Some(ByteOrder::Big),
        _ => None, // mixed-endian modes must not be guessed
    }
}

/// Conversion maps an exact/raw numeric input to an unrounded physical result.
/// RAT_FUNC specifies internal = (a*p²+b*p+c)/(d*p²+e*p+f);
/// only the unambiguous linear inverse is supported in this isolated phase.
#[derive(Debug, Clone, PartialEq)]
pub enum Conversion {
    Identity,
    Linear { scale: f64, offset: f64 },
    RatFuncLinearInverse { b: f64, c: f64, f: f64 },
    Unsupported(String),
}
impl Conversion {
    fn from_method(method: &a2lfile::CompuMethod) -> Self {
        match method.conversion_type {
            ConversionType::Identical => Self::Identity,
            ConversionType::Linear => match &method.coeffs_linear {
                Some(v) if v.a.is_finite() && v.b.is_finite() =>
                    Self::Linear { scale: v.a, offset: v.b },
                _ => Self::Unsupported("LINEAR missing finite COEFFS_LINEAR".into()),
            },
            ConversionType::RatFunc => match &method.coeffs {
                Some(v) if [v.a, v.b, v.c, v.d, v.e, v.f].iter().all(|n| n.is_finite())
                    && v.a == 0.0 && v.d == 0.0 && v.e == 0.0
                    && v.b != 0.0 && v.f != 0.0 =>
                    Self::RatFuncLinearInverse { b: v.b, c: v.c, f: v.f },
                _ => Self::Unsupported("nonlinear or degenerate RAT_FUNC".into()),
            },
            other => Self::Unsupported(format!("{other:?}")),
        }
    }
    pub fn apply(&self, raw: f64) -> Result<f64, A2lError> {
        if !raw.is_finite() { return Err(A2lError::InvalidValue); }
        let output = match self {
            Self::Identity => raw,
            Self::Linear { scale, offset } => raw.mul_add(*scale, *offset),
            Self::RatFuncLinearInverse { b, c, f } => (raw * *f - *c) / *b,
            Self::Unsupported(reason) => return Err(A2lError::UnsupportedConversion(reason.clone())),
        };
        if !output.is_finite() { return Err(A2lError::InvalidValue); }
        Ok(output)
    }
}

/// Address/extension and raw type are A2L declarations only.
#[derive(Debug, Clone)]
pub struct A2lObject {
    pub name: String,
    pub characteristic: bool,
    pub address: Option<u64>,
    pub address_extension: Option<i16>,
    pub raw_type: Option<RawType>,
    pub byte_order: Option<ByteOrder>,
    pub conversion_name: String,
    pub lower_limit: f64,
    pub upper_limit: f64,
    pub record_layout: Option<String>,
    pub unit_override: Option<String>,
}

#[derive(Debug, Clone)]
pub struct A2lMethod {
    pub unit: String,
    pub conversion: Conversion,
}

#[derive(Debug, Clone)]
pub struct A2lRecordLayout {
    pub name: String,
    pub fnc_type: Option<RawType>,
    pub fnc_position: Option<u16>,
}

/// The original A2ML-decoded IF_DATA remains available; non-matching vendor
/// payloads are exposed as invalid, never promoted to usable XCP settings.
#[derive(Debug, Clone)]
pub struct A2lIfData {
    pub scope: String,
    pub valid: bool,
    pub decoded: Option<a2lfile::GenericIfData>,
}

#[derive(Debug, Clone)]
pub struct A2lModule {
    pub name: String,
    pub objects: Vec<A2lObject>,
    pub methods: HashMap<String, A2lMethod>,
    pub layouts: HashMap<String, A2lRecordLayout>,
    pub if_data: Vec<A2lIfData>,
}

impl A2lModule {
    /// Convert numeric raw value to physical, checking *physical* A2L limits.
    /// Values are not rounded to the COMPU_METHOD display format.
    pub fn raw_to_physical(&self, object: &A2lObject, raw: f64) -> Result<PhysicalValue, A2lError> {
        let method = if object.conversion_name == "NO_COMPU_METHOD" {
            A2lMethod { unit: String::new(), conversion: Conversion::Identity }
        } else {
            self.methods.get(&object.conversion_name)
                .cloned().ok_or_else(|| A2lError::MissingConversion(object.conversion_name.clone()))?
        };
        let value = method.conversion.apply(raw)?;
        if value < object.lower_limit || value > object.upper_limit {
            return Err(A2lError::OutOfRange);
        }
        Ok(PhysicalValue {
            raw,
            physical: value,
            unit: object.unit_override.as_ref().unwrap_or(&method.unit).clone(),
        })
    }

    /// Decode no more than one scalar of an explicitly known byte order.
    /// 64-bit integers and float16 are not approximated through f64.
    pub fn decode_raw(&self, object: &A2lObject, bytes: &[u8], endian: ByteOrder) -> Result<PhysicalValue, A2lError> {
        let kind = object.raw_type.ok_or(A2lError::UnsupportedEncoding)?;
        if bytes.len() as u64 != kind.width() { return Err(A2lError::UnsupportedEncoding); }
        if let Some(declared) = object.byte_order {
            if declared != endian { return Err(A2lError::UnsupportedEncoding); }
        }
        let unsigned = |slice: &[u8]| -> u32 {
            let mut arr = [0u8; 4];
            match endian {
                ByteOrder::Little => arr[..slice.len()].copy_from_slice(slice),
                ByteOrder::Big => arr[4 - slice.len()..].copy_from_slice(slice),
            }
            match endian { ByteOrder::Little => u32::from_le_bytes(arr), ByteOrder::Big => u32::from_be_bytes(arr) }
        };
        let raw = match kind {
            RawType::U8 => f64::from(bytes[0]),
            RawType::I8 => f64::from(bytes[0] as i8),
            RawType::U16 => f64::from(unsigned(bytes)),
            RawType::I16 => f64::from(unsigned(bytes) as u16 as i16),
            RawType::U32 => f64::from(unsigned(bytes)),
            RawType::I32 => f64::from(unsigned(bytes) as i32),
            RawType::F32 => f64::from(f32::from_bits(unsigned(bytes))),
            RawType::F64 => {
                let arr: [u8; 8] = bytes.try_into().map_err(|_| A2lError::UnsupportedEncoding)?;
                match endian { ByteOrder::Little => f64::from_le_bytes(arr), ByteOrder::Big => f64::from_be_bytes(arr) }
            }
            RawType::U64 | RawType::I64 | RawType::F16 => return Err(A2lError::UnsupportedEncoding),
        };
        self.raw_to_physical(object, raw)
    }
}

#[derive(Debug, Clone, PartialEq)]
pub struct PhysicalValue {
    pub raw: f64,
    pub physical: f64,
    pub unit: String,
}

fn collect_if_data(scope: &str, data: &[a2lfile::IfData], output: &mut Vec<A2lIfData>) {
    output.extend(data.iter().map(|item| A2lIfData {
        scope: scope.into(),
        valid: item.ifdata_valid,
        decoded: item.ifdata_items.clone(),
    }));
}

/// Parse a bounded A2L file using a2lfile; no /include paths are opened.
/// Warnings from vendor extensions are not silently treated as validated XCP
/// configuration: every IF_DATA entry has its own validity flag.
pub fn parse_a2l(text: &str) -> Result<Vec<A2lModule>, A2lError> {
    if text.is_empty() || text.len() > MAX_A2L_BYTES { return Err(A2lError::InputLimit); }
    let (file, _warnings) = a2lfile::load_from_string(text, None, false)
        .map_err(|e| A2lError::Parse(e.to_string()))?;
    let mut count = 0usize;
    let mut modules = Vec::new();
    for module in &file.project.module {
        count = count.saturating_add(module.measurement.len())
            .saturating_add(module.characteristic.len())
            .saturating_add(module.compu_method.len())
            .saturating_add(module.record_layout.len());
        if count > MAX_OBJECTS { return Err(A2lError::ObjectLimit); }
        let mut result = A2lModule {
            name: module.get_name().into(),
            objects: Vec::new(),
            methods: HashMap::new(),
            layouts: HashMap::new(),
            if_data: Vec::new(),
        };
        collect_if_data("MODULE", &module.if_data, &mut result.if_data);
        for method in &module.compu_method {
            result.methods.insert(method.get_name().into(), A2lMethod {
                unit: method.unit.clone(),
                conversion: Conversion::from_method(method),
            });
        }
        for layout in &module.record_layout {
            result.layouts.insert(layout.get_name().into(), A2lRecordLayout {
                name: layout.get_name().into(),
                fnc_type: layout.fnc_values.as_ref().map(|item| RawType::from_a2l(item.datatype)),
                fnc_position: layout.fnc_values.as_ref().map(|item| item.position),
            });
        }
        let default_order = module.mod_common.as_ref()
            .and_then(|m| m.byte_order.as_ref())
            .and_then(|v| byte_order(v.byte_order));
        let mut names = HashSet::new();
        for m in &module.measurement {
            let name = m.get_name().to_string();
            if !names.insert(name.clone()) { return Err(A2lError::Parse(format!("duplicate object: {name}"))); }
            if !m.lower_limit.is_finite() || !m.upper_limit.is_finite() || m.lower_limit > m.upper_limit {
                return Err(A2lError::InvalidLimits(name));
            }
            collect_if_data(&name, &m.if_data, &mut result.if_data);
            result.objects.push(A2lObject {
                name,
                characteristic: false,
                address: m.ecu_address.as_ref().map(|a| u64::from(a.address)),
                address_extension: m.ecu_address_extension.as_ref().map(|a| a.extension),
                raw_type: Some(RawType::from_a2l(m.datatype)),
                byte_order: m.byte_order.as_ref().and_then(|a| byte_order(a.byte_order)).or(default_order),
                conversion_name: m.conversion.clone(),
                lower_limit: m.lower_limit,
                upper_limit: m.upper_limit,
                record_layout: None,
                unit_override: None,
            });
        }
        for c in &module.characteristic {
            let name = c.get_name().to_string();
            if !names.insert(name.clone()) { return Err(A2lError::Parse(format!("duplicate object: {name}"))); }
            if !c.lower_limit.is_finite() || !c.upper_limit.is_finite() || c.lower_limit > c.upper_limit {
                return Err(A2lError::InvalidLimits(name));
            }
            collect_if_data(&name, &c.if_data, &mut result.if_data);
            let raw_type = result.layouts.get(&c.deposit).and_then(|layout| layout.fnc_type);
            result.objects.push(A2lObject {
                name,
                characteristic: true,
                address: Some(u64::from(c.address)),
                address_extension: c.ecu_address_extension.as_ref().map(|a| a.extension),
                raw_type,
                byte_order: c.byte_order.as_ref().and_then(|a| byte_order(a.byte_order)).or(default_order),
                conversion_name: c.conversion.clone(),
                lower_limit: c.lower_limit,
                upper_limit: c.upper_limit,
                record_layout: Some(c.deposit.clone()),
                unit_override: None,
            });
        }
        modules.push(result);
    }
    Ok(modules)
}

/// Diagnostic-only comparison. Neither source's location is returned as a
/// resolved runtime address and neither source is modified.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum MetadataConflict {
    Address { a2l_declared: u64, elf_link_time: u64 },
    MissingDwarfAddress,
    Type { a2l: RawType, dwarf_kind: TypeKind, dwarf_width: Option<u64> },
    AddressExtension(i16),
    UnknownA2lType,
}
pub fn compare_to_dwarf(a2l: &A2lObject, dwarf: &TypedVariable) -> Vec<MetadataConflict> {
    let mut conflicts = Vec::new();
    if let Some(ext) = a2l.address_extension.filter(|value| *value != 0) {
        conflicts.push(MetadataConflict::AddressExtension(ext));
    }
    match (&a2l.address, &dwarf.address) {
        (Some(a), AddressProvenance::LinkTime(b)) if a != b =>
            conflicts.push(MetadataConflict::Address { a2l_declared: *a, elf_link_time: *b }),
        (Some(_), AddressProvenance::Unavailable | AddressProvenance::RuntimeExpression) =>
            conflicts.push(MetadataConflict::MissingDwarfAddress),
        _ => {}
    }
    match a2l.raw_type {
        Some(raw) if dwarf.descriptor.kind != TypeKind::Unknown &&
            (raw.kind() != dwarf.descriptor.kind || dwarf.descriptor.byte_size != Some(raw.width())) =>
            conflicts.push(MetadataConflict::Type {
                a2l: raw,
                dwarf_kind: dwarf.descriptor.kind.clone(),
                dwarf_width: dwarf.descriptor.byte_size,
            }),
        None => conflicts.push(MetadataConflict::UnknownA2lType),
        _ => {}
    }
    conflicts
}

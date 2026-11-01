//! Fixture-based acceptance tests for T-0008's isolated core phase.

use xcp_core::a2l::{
    compare_to_dwarf, parse_a2l, A2lError, ByteOrder, Conversion, MetadataConflict, RawType,
    MAX_A2L_BYTES,
};
use xcp_core::metadata::{
    AddressProvenance, TypeDescriptor, TypeKind, TypedVariable,
};

const GOLDEN: &str = include_str!("fixtures/t0008-golden.a2l");

fn dwarf(kind: TypeKind, width: Option<u64>, addr: AddressProvenance) -> TypedVariable {
    TypedVariable {
        name: "engine_speed".into(),
        compilation_unit: Some("fixture.c".into()),
        descriptor: TypeDescriptor {
            name: "fixture".into(),
            kind,
            byte_size: width,
            element_count: None,
            element_type: None,
            members: Vec::new(),
        },
        address: addr,
    }
}

#[test]
fn parses_real_asap2_blocks_and_record_layout_type() {
    let modules = parse_a2l(GOLDEN).unwrap();
    assert_eq!(modules.len(), 1);
    let m = &modules[0];
    assert_eq!(m.name, "powertrain");
    assert_eq!(m.objects.len(), 4);
    assert_eq!(m.layouts["scalar_u16"].fnc_type, Some(RawType::U16));
    let c = m.objects.iter().find(|o| o.name == "torque_request").unwrap();
    assert!(c.characteristic);
    assert_eq!(c.address, Some(0x2000));
    assert_eq!(c.record_layout.as_deref(), Some("scalar_u16"));
    assert_eq!(c.raw_type, Some(RawType::U16));
    assert_eq!(c.byte_order, Some(ByteOrder::Little));
}

#[test]
fn applies_signed_linear_scaling_offset_and_units_without_rounding() {
    let m = &parse_a2l(GOLDEN).unwrap()[0];
    let speed = m.objects.iter().find(|o| o.name == "engine_speed").unwrap();
    assert_eq!(speed.address, Some(0x1000));
    let physical = m.decode_raw(speed, &1850u16.to_le_bytes(), ByteOrder::Little).unwrap();
    assert_eq!(physical.raw, 1850.0);
    assert_eq!(physical.physical, 422.5);
    assert_eq!(physical.unit, "rpm");
    assert_eq!(m.raw_to_physical(speed, 1.0).unwrap().physical, -39.75);
    assert!(matches!(m.raw_to_physical(speed, -10.0), Err(A2lError::OutOfRange)));
}

#[test]
fn rational_conversion_inverts_int_of_phys_and_handles_negatives() {
    let m = &parse_a2l(GOLDEN).unwrap()[0];
    let temp = m.objects.iter().find(|o| o.name == "coolant_temp").unwrap();
    let val = m.decode_raw(temp, &20i16.to_le_bytes(), ByteOrder::Little).unwrap();
    assert_eq!(val.physical, 8.0); // internal = 2*physical + 4
    assert_eq!(val.unit, "degC");
    assert_eq!(m.decode_raw(temp, &(-4i16).to_le_bytes(), ByteOrder::Little).unwrap().physical, -4.0);
}

#[test]
fn invalid_raw_encoding_and_nan_are_never_converted() {
    let m = &parse_a2l(GOLDEN).unwrap()[0];
    let speed = m.objects.iter().find(|o| o.name == "engine_speed").unwrap();
    assert!(matches!(m.decode_raw(speed, &[0], ByteOrder::Little), Err(A2lError::UnsupportedEncoding)));
    assert!(matches!(m.decode_raw(speed, &[0x07, 0x3a], ByteOrder::Big), Err(A2lError::UnsupportedEncoding)));
    assert!(matches!(m.raw_to_physical(speed, f64::NAN), Err(A2lError::InvalidValue)));
    assert!(matches!(m.raw_to_physical(speed, f64::INFINITY), Err(A2lError::InvalidValue)));
}

#[test]
fn unsupported_table_and_nonlinear_rational_fail_explicitly() {
    let m = &parse_a2l(GOLDEN).unwrap()[0];
    let unsupported = m.objects.iter().find(|o| o.name == "unsupported").unwrap();
    assert!(matches!(m.raw_to_physical(unsupported, 42.0), Err(A2lError::UnsupportedConversion(_))));
    let conv = Conversion::Unsupported("nonlinear".into());
    assert!(matches!(conv.apply(10.0), Err(A2lError::UnsupportedConversion(_))));
    assert!(matches!(Conversion::Linear { scale: f64::MAX, offset: 1.0 }.apply(f64::MAX), Err(A2lError::InvalidValue)));
}

#[test]
fn rejects_malformed_truncated_oversize_and_invalid_ranges() {
    assert!(parse_a2l("").is_err());
    assert!(matches!(parse_a2l(&"x".repeat(MAX_A2L_BYTES + 1)), Err(A2lError::InputLimit)));
    assert!(parse_a2l("/begin PROJECT broken").is_err());
    let invalid = GOLDEN.replace("1 0 -40 8000", "1 0 9000 -40");
    assert!(matches!(parse_a2l(&invalid), Err(A2lError::InvalidLimits(_))));
}

#[test]
fn detects_conflicting_types_and_addresses_without_promoting_either() {
    let modules = parse_a2l(GOLDEN).unwrap();
    let speed = modules[0].objects.iter().find(|o| o.name == "engine_speed").unwrap();
    let good = dwarf(TypeKind::UnsignedInteger, Some(2), AddressProvenance::LinkTime(0x1000));
    assert!(compare_to_dwarf(speed, &good).is_empty());
    let incompatible = dwarf(TypeKind::FloatingPoint, Some(4), AddressProvenance::LinkTime(0x1200));
    let conflicts = compare_to_dwarf(speed, &incompatible);
    assert!(conflicts.contains(&MetadataConflict::Address { a2l_declared: 0x1000, elf_link_time: 0x1200 }));
    assert!(conflicts.iter().any(|c| matches!(c, MetadataConflict::Type { .. })));
    assert_eq!(speed.address, Some(0x1000)); // A2L never mutated
    assert_eq!(incompatible.address, AddressProvenance::LinkTime(0x1200)); // DWARF unchanged
}

#[test]
fn unresolved_dwarf_or_extended_address_requires_separate_validation() {
    let modules = parse_a2l(GOLDEN).unwrap();
    let speed = modules[0].objects.iter().find(|o| o.name == "engine_speed").unwrap();
    let unresolved = dwarf(TypeKind::UnsignedInteger, Some(2), AddressProvenance::RuntimeExpression);
    assert!(compare_to_dwarf(speed, &unresolved).contains(&MetadataConflict::MissingDwarfAddress));
    let mut extended = speed.clone();
    extended.address_extension = Some(2);
    assert!(compare_to_dwarf(&extended, &unresolved).contains(&MetadataConflict::AddressExtension(2)));
}

#[test]
fn allows_no_compu_method_only_as_identity() {
    let modules = parse_a2l(GOLDEN).unwrap();
    let m = &modules[0];
    let mut speed = m.objects.iter().find(|o| o.name == "engine_speed").unwrap().clone();
    speed.conversion_name = "NO_COMPU_METHOD".into();
    assert_eq!(m.raw_to_physical(&speed, 100.0).unwrap().physical, 100.0);
    speed.conversion_name = "missing_conversion".into();
    assert!(matches!(m.raw_to_physical(&speed, 100.0), Err(A2lError::MissingConversion(_))));
}

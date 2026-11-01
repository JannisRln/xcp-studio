//! Tests against a real compiler-emitted ELF/DWARF 4 fixture.

use xcp_core::metadata::{
    inspect_typed_dwarf, AddressProvenance, TargetEndian, TypeKind,
};

#[test]
fn parses_compiled_dwarf_struct_pointer_and_array() {
    // GCC 14 x86_64 relocatable ELF; .debug_info uses DWARF 4.
    let data = inspect_typed_dwarf(include_bytes!("fixtures/engine.o"))
        .expect("synthetic compiler fixture should parse");

    assert!(data.has_debug_info);
    assert_eq!(data.compilation_units, 1);
    assert_eq!(data.target.elf_address_bytes, 8);
    assert_eq!(data.target.endian, TargetEndian::Little);

    let engine = data.variables.iter().find(|var| var.name == "engine").unwrap();
    assert_eq!(engine.descriptor.kind, TypeKind::Structure);
    assert_eq!(engine.descriptor.byte_size, Some(12));
    let members = &engine.descriptor.members;
    assert_eq!(members.len(), 3);
    assert_eq!((members[0].name.as_str(), members[0].byte_offset), ("rpm", Some(0)));
    assert_eq!(members[0].descriptor.name, "rpm_t");
    assert_eq!(members[0].descriptor.kind, TypeKind::UnsignedInteger);
    assert_eq!((members[1].name.as_str(), members[1].byte_offset), ("coolant", Some(4)));
    assert_eq!(members[1].descriptor.kind, TypeKind::FloatingPoint);
    assert_eq!((members[2].name.as_str(), members[2].byte_offset), ("mode", Some(8)));
    assert_eq!(members[2].descriptor.kind, TypeKind::Enumeration);

    let ptr = data.variables.iter().find(|var| var.name == "engine_ptr").unwrap();
    assert_eq!(ptr.descriptor.kind, TypeKind::Pointer);
    assert_eq!(ptr.descriptor.byte_size, Some(8));
    assert_eq!(ptr.descriptor.element_type.as_deref(), Some("Engine"));

    let samples = data.variables.iter().find(|var| var.name == "samples").unwrap();
    assert_eq!(samples.descriptor.kind, TypeKind::Array);
    assert_eq!(samples.descriptor.element_count, Some(3));
    assert_eq!(samples.descriptor.byte_size, Some(3));

    // A relocatable .o stores a DW_OP_addr placeholder; it is NOT a valid
    // ECU memory address even though the parser can decode its link-time form.
    assert!(matches!(engine.address, AddressProvenance::LinkTime(_)));
    assert!(matches!(ptr.address, AddressProvenance::LinkTime(_)));
}

#[test]
fn stripped_elf_does_not_fabricate_typed_variables() {
    let data = inspect_typed_dwarf(include_bytes!("fixtures/engine-stripped.o"))
        .expect("synthetic stripped fixture should remain a valid ELF");
    assert!(!data.has_debug_info);
    assert_eq!(data.compilation_units, 0);
    assert!(data.variables.is_empty());
}

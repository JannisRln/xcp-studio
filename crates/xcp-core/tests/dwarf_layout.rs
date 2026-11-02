//! Regression tests against a GCC-compiled DWARF-4 fixture with nested aggregate types.
//! This metadata is not proof of a valid ECU runtime mapping.

use xcp_core::metadata::{inspect_typed_dwarf, AddressProvenance, TargetEndian, TypeKind};

#[test]
fn reads_nested_struct_union_array_typedef_and_pointer_layout() {
    let image = inspect_typed_dwarf(include_bytes!("fixtures/layout.elf"))
        .expect("synthetic DWARF-4 fixture should parse");
    assert!(image.has_debug_info);
    assert_eq!(image.compilation_units, 1);
    assert_eq!(image.target.elf_address_bytes, 8);
    assert_eq!(image.target.endian, TargetEndian::Little);

    let module = image
        .variables
        .iter()
        .find(|variable| variable.name == "module_state")
        .expect("module global");
    assert_eq!(module.descriptor.kind, TypeKind::Structure);
    assert_eq!(module.descriptor.byte_size, Some(20));
    assert_eq!(module.descriptor.members.len(), 2);
    let channels = &module.descriptor.members[0];
    assert_eq!(channels.name, "channels");
    assert_eq!(channels.byte_offset, Some(0));
    assert_eq!(channels.descriptor.kind, TypeKind::Array);
    assert_eq!(channels.descriptor.element_count, Some(2));
    assert_eq!(channels.descriptor.byte_size, Some(16));
    assert_eq!(channels.descriptor.element_type.as_deref(), Some("Channel"));

    let status = &module.descriptor.members[1];
    assert_eq!(status.name, "status");
    assert_eq!(status.byte_offset, Some(16));
    assert_eq!(status.descriptor.name, "word_t");
    assert_eq!(status.descriptor.kind, TypeKind::UnsignedInteger);
    assert_eq!(status.descriptor.byte_size, Some(2));
    assert!(matches!(module.address, AddressProvenance::LinkTime(_)));

    let channel = image
        .variables
        .iter()
        .find(|variable| variable.name == "channel_state")
        .expect("standalone channel global");
    assert_eq!(channel.descriptor.kind, TypeKind::Structure);
    assert_eq!(channel.descriptor.byte_size, Some(8));
    assert_eq!(channel.descriptor.members[0].byte_offset, Some(0));
    assert_eq!(channel.descriptor.members[1].byte_offset, Some(4));
    assert_eq!(
        channel.descriptor.members[1].descriptor.kind,
        TypeKind::Union
    );

    let value = image
        .variables
        .iter()
        .find(|variable| variable.name == "standalone_value")
        .expect("union global");
    assert_eq!(value.descriptor.kind, TypeKind::Union);
    assert_eq!(value.descriptor.byte_size, Some(4));
    assert_eq!(value.descriptor.members.len(), 2);
    assert_eq!(value.descriptor.members[0].name, "raw");
    assert_eq!(value.descriptor.members[1].name, "physical");
    // DWARF omits member offsets on this union. Do not silently invent zero.
    assert_eq!(value.descriptor.members[0].byte_offset, None);

    let pointer = image
        .variables
        .iter()
        .find(|variable| variable.name == "module_ptr")
        .expect("pointer global");
    assert_eq!(pointer.descriptor.kind, TypeKind::Pointer);
    assert_eq!(pointer.descriptor.byte_size, Some(8));
    assert_eq!(pointer.descriptor.element_type.as_deref(), Some("Module"));
    assert!(matches!(pointer.address, AddressProvenance::LinkTime(_)));
}

#[test]
fn truncated_elf_is_rejected_without_panicking() {
    let fixture = include_bytes!("fixtures/layout.elf");
    assert!(inspect_typed_dwarf(&fixture[..32]).is_err());
    assert!(inspect_typed_dwarf(&fixture[..fixture.len() / 2]).is_err());
}

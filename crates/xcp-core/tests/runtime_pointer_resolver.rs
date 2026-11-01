//! Deterministic synthetic ECU memory tests; no hardware or session I/O.

use std::collections::BTreeMap;

use xcp_core::ecu::resolver::{
    resolve, EcuIdentity, MemoryReader, MemoryRegion, PathStep, ResolveError, RootLocation,
    RuntimeMapping, MAX_MEMORY_REGIONS, MAX_PATH_STEPS, MAX_POINTER_HOPS,
};
use xcp_core::metadata::{
    AddressProvenance, TargetEndian, TargetInfo, TypeDescriptor, TypeKind, TypeMember, TypedVariable,
};

#[derive(Default)]
struct MockMemory {
    identity: Option<EcuIdentity>,
    flip_identity_on_read: Option<EcuIdentity>,
    memory: BTreeMap<u64, u8>,
    reads: usize,
}

impl MockMemory {
    fn new(identity: EcuIdentity) -> Self {
        Self {
            identity: Some(identity),
            ..Self::default()
        }
    }

    fn put_pointer(&mut self, address: u64, value: u64, width: u8, endian: TargetEndian) {
        let bytes = match endian {
            TargetEndian::Little => value.to_le_bytes(),
            TargetEndian::Big => value.to_be_bytes(),
        };
        let slice = match endian {
            TargetEndian::Little => &bytes[..usize::from(width)],
            TargetEndian::Big => &bytes[8 - usize::from(width)..],
        };
        for (index, value) in slice.iter().enumerate() {
            self.memory.insert(address + index as u64, *value);
        }
    }
}

impl MemoryReader for MockMemory {
    type Error = ();

    fn current_identity(&self) -> Result<EcuIdentity, Self::Error> {
        self.identity.ok_or(())
    }

    fn read_exact(&mut self, address: u64, buffer: &mut [u8]) -> Result<(), Self::Error> {
        self.reads += 1;
        for (index, byte) in buffer.iter_mut().enumerate() {
            *byte = *self.memory.get(&(address + index as u64)).ok_or(())?;
        }
        if let Some(new_identity) = self.flip_identity_on_read.take() {
            self.identity = Some(new_identity);
        }
        Ok(())
    }
}

fn identity() -> EcuIdentity {
    EcuIdentity {
        ecu_fingerprint: [0xA1; 16],
        image_fingerprint: [0xB2; 16],
        session_generation: 7,
        mapping_generation: 11,
    }
}

fn region(start: u64, length: u64) -> MemoryRegion {
    MemoryRegion { start, length }
}

fn target(width: u8, endian: TargetEndian) -> TargetInfo {
    TargetInfo {
        architecture: "synthetic-target".into(),
        elf_address_bytes: width,
        endian,
    }
}

fn mapping(width: u8, endian: TargetEndian) -> RuntimeMapping {
    RuntimeMapping {
        identity: identity(),
        link_region: region(0x100, 0x100),
        runtime_region: region(0x1000, 0x100),
        target_endian: endian,
        pointer_bytes: width,
    }
}

fn descriptor(name: &str, kind: TypeKind, byte_size: u64) -> TypeDescriptor {
    TypeDescriptor {
        name: name.to_owned(),
        kind,
        byte_size: Some(byte_size),
        element_count: None,
        element_type: None,
        members: Vec::new(),
    }
}

fn pointer(name: &str, width: u8) -> TypeDescriptor {
    let mut result = descriptor("Node*", TypeKind::Pointer, u64::from(width));
    result.element_type = Some(name.to_owned());
    result
}

fn node(width: u8) -> TypeDescriptor {
    let pointer = pointer("Node", width);
    let value = descriptor("u32", TypeKind::UnsignedInteger, 4);
    TypeDescriptor {
        name: "Node".to_owned(),
        kind: TypeKind::Structure,
        byte_size: Some(u64::from(width) + 4),
        element_count: None,
        element_type: None,
        members: vec![
            TypeMember {
                name: "next".to_owned(),
                byte_offset: Some(0),
                descriptor: pointer,
            },
            TypeMember {
                name: "value".to_owned(),
                byte_offset: Some(u64::from(width)),
                descriptor: value,
            },
        ],
    }
}

fn variable(width: u8) -> TypedVariable {
    TypedVariable {
        name: "global_head".to_owned(),
        compilation_unit: Some("fixture.c".to_owned()),
        descriptor: pointer("Node", width),
        address: AddressProvenance::LinkTime(0x120),
    }
}

fn solve<'a>(
    reader: &mut MockMemory,
    variable: &TypedVariable,
    target: &TargetInfo,
    mapping: &'a RuntimeMapping,
    path: &[PathStep<'a>],
) -> Result<xcp_core::ecu::resolver::ResolvedAddress, ResolveError> {
    resolve(
        reader,
        variable,
        target,
        RootLocation::Mapped(mapping),
        path,
        &[region(0x1000, 0x1000)],
        42,
    )
}

#[test]
fn resolves_nested_struct_member_chains_with_32_and_64_bit_endian_layouts() {
    for (width, endian) in [(4, TargetEndian::Little), (8, TargetEndian::Big)] {
        let image = target(width, endian);
        let mapping = mapping(width, endian);
        let var = variable(width);
        let node = node(width);
        let mut memory = MockMemory::new(identity());
        memory.put_pointer(0x1020, 0x1200, width, endian);
        memory.put_pointer(0x1200, 0x1300, width, endian);

        let path = [
            PathStep::Dereference { pointee: &node },
            PathStep::Member("next"),
            PathStep::Dereference { pointee: &node },
            PathStep::Member("value"),
        ];
        let result = solve(&mut memory, &var, &image, &mapping, &path).unwrap();
        assert_eq!(result.address, 0x1300 + u64::from(width));
        assert_eq!(result.byte_size, 4);
        assert_eq!(result.type_kind, TypeKind::UnsignedInteger);
        assert_eq!(result.source, AddressProvenance::LinkTime(0x120));
        assert_eq!(result.steps.len(), 4);
        assert_eq!(result.identity, identity());
        assert_eq!(result.observation_version, 42);
        assert!(result.identity_is_current(&memory));
        assert_eq!(memory.reads, 2);
    }
}

#[test]
fn refuses_unmapped_elf_address_without_any_ecu_read() {
    let mut memory = MockMemory::new(identity());
    let error = resolve(
        &mut memory,
        &variable(4),
        &target(4, TargetEndian::Little),
        RootLocation::Unmapped,
        &[],
        &[region(0x1000, 0x1000)],
        1,
    )
    .unwrap_err();
    assert_eq!(error, ResolveError::UnverifiedLinkTime);
    assert_eq!(memory.reads, 0);
}

#[test]
fn unsupported_runtime_locations_are_not_guessed() {
    for (location, expected) in [
        (AddressProvenance::RuntimeExpression, ResolveError::UnsupportedLocation),
        (AddressProvenance::Unavailable, ResolveError::UnavailableLocation),
    ] {
        let mut variable = variable(4);
        variable.address = location;
        let mut memory = MockMemory::new(identity());
        assert_eq!(
            solve(
                &mut memory,
                &variable,
                &target(4, TargetEndian::Little),
                &mapping(4, TargetEndian::Little),
                &[],
            )
            .unwrap_err(),
            expected
        );
        assert_eq!(memory.reads, 0);
    }
}

#[test]
fn null_and_out_of_region_pointers_fail_closed() {
    let node = node(4);
    let path = [PathStep::Dereference { pointee: &node }];
    let mut memory = MockMemory::new(identity());
    memory.put_pointer(0x1020, 0, 4, TargetEndian::Little);
    assert_eq!(
        solve(&mut memory, &variable(4), &target(4, TargetEndian::Little),
            &mapping(4, TargetEndian::Little), &path).unwrap_err(),
        ResolveError::NullPointer
    );

    memory.put_pointer(0x1020, 0x9000, 4, TargetEndian::Little);
    assert_eq!(
        solve(&mut memory, &variable(4), &target(4, TargetEndian::Little),
            &mapping(4, TargetEndian::Little), &path).unwrap_err(),
        ResolveError::OutOfRegion
    );
}

#[test]
fn detects_pointer_cycles_without_reusing_old_targets() {
    let node = node(4);
    let path = [
        PathStep::Dereference { pointee: &node },
        PathStep::Member("next"),
        PathStep::Dereference { pointee: &node },
        PathStep::Member("next"),
        PathStep::Dereference { pointee: &node },
    ];
    let mut memory = MockMemory::new(identity());
    memory.put_pointer(0x1020, 0x1200, 4, TargetEndian::Little);
    memory.put_pointer(0x1200, 0x1020, 4, TargetEndian::Little);
    assert_eq!(
        solve(&mut memory, &variable(4), &target(4, TargetEndian::Little),
            &mapping(4, TargetEndian::Little), &path).unwrap_err(),
        ResolveError::PointerCycle
    );
    assert_eq!(memory.reads, 2);
}

#[test]
fn stale_ecu_identity_is_rejected_before_and_after_each_read() {
    let node = node(4);
    let path = [PathStep::Dereference { pointee: &node }];
    let mut memory = MockMemory::new(identity());
    let mut newer = identity();
    newer.session_generation += 1;
    memory.identity = Some(newer);
    assert_eq!(
        solve(&mut memory, &variable(4), &target(4, TargetEndian::Little),
            &mapping(4, TargetEndian::Little), &path).unwrap_err(),
        ResolveError::StaleIdentity
    );
    assert_eq!(memory.reads, 0);

    memory.identity = Some(identity());
    memory.put_pointer(0x1020, 0x1200, 4, TargetEndian::Little);
    memory.flip_identity_on_read = Some(newer);
    assert_eq!(
        solve(&mut memory, &variable(4), &target(4, TargetEndian::Little),
            &mapping(4, TargetEndian::Little), &path).unwrap_err(),
        ResolveError::StaleIdentity
    );
    assert_eq!(memory.reads, 1);

    let mut stale_result_reader = MockMemory::new(newer);
    let observation = xcp_core::ecu::resolver::ResolvedAddress {
        address: 0x1200,
        byte_size: 4,
        type_kind: TypeKind::UnsignedInteger,
        source: AddressProvenance::LinkTime(0x120),
        steps: Vec::new(),
        identity: identity(),
        observed_at: std::time::SystemTime::now(),
        observation_version: 42,
    };
    assert!(!observation.identity_is_current(&stale_result_reader));
    stale_result_reader.identity = None;
    assert!(!observation.identity_is_current(&stale_result_reader));
}

#[test]
fn rejects_missing_memory_bad_offsets_and_target_width_overflow() {
    let node = node(4);
    let path = [PathStep::Dereference { pointee: &node }];
    let mut memory = MockMemory::new(identity());
    assert_eq!(
        solve(&mut memory, &variable(4), &target(4, TargetEndian::Little),
            &mapping(4, TargetEndian::Little), &path).unwrap_err(),
        ResolveError::MemoryFault
    );
    memory.put_pointer(0x1020, 0x1_0000_0000, 8, TargetEndian::Little);
    // The low 32 bits are zero on a 32-bit target, so this is NULL.
    assert_eq!(
        solve(&mut memory, &variable(4), &target(4, TargetEndian::Little),
            &mapping(4, TargetEndian::Little), &path).unwrap_err(),
        ResolveError::NullPointer
    );

    let mut node = node(4);
    node.members[1].byte_offset = None;
    memory.put_pointer(0x1020, 0x1200, 4, TargetEndian::Little);
    assert_eq!(
        solve(&mut memory, &variable(4), &target(4, TargetEndian::Little),
            &mapping(4, TargetEndian::Little),
            &[PathStep::Dereference { pointee: &node }, PathStep::Member("value")])
            .unwrap_err(),
        ResolveError::InvalidMember
    );
}

#[test]
fn rejects_mismatched_layout_or_pointee_metadata() {
    let mut memory = MockMemory::new(identity());
    let node = node(4);
    let wrong = descriptor("Other", TypeKind::Structure, 4);
    let path = [PathStep::Dereference { pointee: &wrong }];
    assert_eq!(
        solve(&mut memory, &variable(4), &target(4, TargetEndian::Little),
            &mapping(4, TargetEndian::Little), &path).unwrap_err(),
        ResolveError::TypeMismatch
    );
    assert_eq!(memory.reads, 0);
    assert!(solve(
        &mut memory, &variable(4), &target(8, TargetEndian::Little),
        &mapping(4, TargetEndian::Little), &[PathStep::Dereference { pointee: &node }]
    ).is_err());
    assert!(solve(
        &mut memory, &variable(4), &target(4, TargetEndian::Big),
        &mapping(4, TargetEndian::Little), &[PathStep::Dereference { pointee: &node }]
    ).is_err());
    assert_eq!(memory.reads, 0);
}

#[test]
fn guards_mapping_regions_and_address_arithmetic() {
    let mut memory = MockMemory::new(identity());
    let image = target(8, TargetEndian::Little);
    let mut mapping = mapping(8, TargetEndian::Little);
    mapping.link_region.length = 0;
    assert_eq!(
        solve(&mut memory, &variable(8), &image, &mapping, &[]).unwrap_err(),
        ResolveError::InvalidMapping
    );
    mapping = mapping(8, TargetEndian::Little);
    mapping.runtime_region.length = 0x200;
    assert_eq!(
        solve(&mut memory, &variable(8), &image, &mapping, &[]).unwrap_err(),
        ResolveError::InvalidMapping
    );

    let mut node = node(8);
    node.byte_size = Some(u64::MAX);
    node.members[1].byte_offset = Some(u64::MAX - 4);
    let mut memory = MockMemory::new(identity());
    memory.put_pointer(0x1020, 0x1200, 8, TargetEndian::Little);
    assert_eq!(
        solve(&mut memory, &variable(8), &image, &mapping(8, TargetEndian::Little),
            &[PathStep::Dereference { pointee: &node }, PathStep::Member("value")])
            .unwrap_err(),
        ResolveError::AddressOverflow
    );
}

#[test]
fn path_depth_pointer_depth_and_region_count_are_bounded() {
    let mut memory = MockMemory::new(identity());
    let image = target(4, TargetEndian::Little);
    let mapping = mapping(4, TargetEndian::Little);
    let node = node(4);
    let deep_path = vec![PathStep::Member("value"); MAX_PATH_STEPS + 1];
    assert_eq!(
        solve(&mut memory, &variable(4), &image, &mapping, &deep_path).unwrap_err(),
        ResolveError::LimitExceeded
    );
    let pointer_path: Vec<_> = (0..MAX_POINTER_HOPS + 1)
        .map(|_| PathStep::Dereference { pointee: &node })
        .collect();
    assert_eq!(
        solve(&mut memory, &variable(4), &image, &mapping, &pointer_path).unwrap_err(),
        ResolveError::MemoryFault
    );
    let too_many = vec![region(0x1000, 0x1000); MAX_MEMORY_REGIONS + 1];
    assert_eq!(
        resolve(&mut memory, &variable(4), &image, RootLocation::Mapped(&mapping),
            &[], &too_many, 0).unwrap_err(),
        ResolveError::LimitExceeded
    );
    assert_eq!(memory.reads, 1);
}

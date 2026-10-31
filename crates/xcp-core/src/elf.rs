//! ELF symbol table inspection for ECU firmware images.
//! DWARF type resolution and runtime relocation are not yet implemented.

use object::{Object, ObjectSymbol, SymbolKind};
use std::path::Path;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ElfSymbol {
    pub name: String,
    pub address: u64,
    pub size: u64,
    pub kind: String,
}

#[derive(Debug, thiserror::Error)]
pub enum ElfError {
    #[error("cannot read ELF file: {0}")]
    Io(#[from] std::io::Error),
    #[error("invalid ELF file: {0}")]
    Parse(#[from] object::Error),
    #[error("expected an ELF file")]
    NotElf,
}

/// Inspect symbols from an ELF file on disk.
pub fn inspect_file(path: impl AsRef<Path>) -> Result<Vec<ElfSymbol>, ElfError> {
    inspect_bytes(&std::fs::read(path)?)
}

/// Return defined, named symbols from ELF .symtab and .dynsym.
/// Addresses are link-time addresses and may require runtime relocation.
pub fn inspect_bytes(bytes: &[u8]) -> Result<Vec<ElfSymbol>, ElfError> {
    let file = object::File::parse(bytes)?;
    if file.format() != object::BinaryFormat::Elf {
        return Err(ElfError::NotElf);
    }
    let mut symbols = Vec::new();
    for symbol in file.symbols().chain(file.dynamic_symbols()) {
        if !symbol.is_definition() || symbol.address() == 0 {
            continue;
        }
        let Ok(name) = symbol.name() else {
            continue;
        };
        if name.is_empty() {
            continue;
        }
        let kind = match symbol.kind() {
            SymbolKind::Data => "data",
            SymbolKind::Text => "function",
            SymbolKind::Tls => "tls",
            SymbolKind::Section => continue,
            SymbolKind::File => continue,
            _ => "other",
        };
        symbols.push(ElfSymbol {
            name: name.to_owned(),
            address: symbol.address(),
            size: symbol.size(),
            kind: kind.to_owned(),
        });
    }
    symbols.sort_by(|a, b| a.address.cmp(&b.address).then(a.name.cmp(&b.name)));
    symbols.dedup_by(|a, b| a.address == b.address && a.name == b.name);
    Ok(symbols)
}

use gimli::{EndianRcSlice, RunTimeEndian};
use object::ObjectSection;
use std::rc::Rc;

/// Summary of DWARF information available in an ELF firmware image.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DwarfSummary {
    pub has_debug_info: bool,
    pub compilation_units: usize,
}

#[derive(Debug, thiserror::Error)]
pub enum DwarfError {
    #[error(transparent)]
    Object(#[from] object::Error),
    #[error(transparent)]
    Dwarf(#[from] gimli::Error),
    #[error("expected an ELF file")]
    NotElf,
}

/// Count DWARF compilation units without requiring the ECU to be connected.
/// An ELF without .debug_info returns an empty summary.
pub fn inspect_dwarf(bytes: &[u8]) -> Result<DwarfSummary, DwarfError> {
    let file = object::File::parse(bytes)?;
    if file.format() != object::BinaryFormat::Elf {
        return Err(DwarfError::NotElf);
    }

    let endian = if file.is_little_endian() {
        RunTimeEndian::Little
    } else {
        RunTimeEndian::Big
    };
    let has_debug_info = file
        .section_by_name(".debug_info")
        .map(|section| section.size() > 0)
        .unwrap_or(false);
    if !has_debug_info {
        return Ok(DwarfSummary {
            has_debug_info: false,
            compilation_units: 0,
        });
    }

    let dwarf = gimli::Dwarf::load(|section_id| {
        let data = match file.section_by_name(section_id.name()) {
            Some(section) => section.uncompressed_data()?.into_owned(),
            None => Vec::new(),
        };
        Ok::<_, object::Error>(EndianRcSlice::new(Rc::from(data), endian))
    })?;
    let mut units = dwarf.units();
    let mut compilation_units = 0;
    while units.next()?.is_some() {
        compilation_units += 1;
    }
    Ok(DwarfSummary {
        has_debug_info,
        compilation_units,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rejects_invalid_elf() {
        assert!(inspect_bytes(b"not an ELF").is_err());
        assert!(inspect_dwarf(b"not an ELF").is_err());
    }
}

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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rejects_invalid_elf() {
        assert!(inspect_bytes(b"not an ELF").is_err());
    }
}

# Architecture (draft)

Windows executable hosts the Rust HTTP API; React UI runs in the browser.
CAN adapter abstraction isolates PCAN and Vector drivers.
Future modules: XCP master, ELF/DWARF parser, A2L parser, pointer resolver,
measurement scheduler, calibration engine and simulated XCP slave.
Docker and Linux support are postponed until after the Windows MVP.

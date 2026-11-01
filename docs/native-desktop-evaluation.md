# Native desktop comparative experiment

Branch: experiment/native-egui-workspace-benchmark.
Status: experimental and **pending Windows measurements and integration review**.

This is **not** a claim on T-0006. That ticket and its React chart area are
already owned by the active Live View agent. This PR does not modify its ticket,
docs/tickets/INDEX.md, shared CI, React, REST/WS DTOs or session/hardware safety.
The integration owner must coordinate any later dedicated ticket or shared
workspace dependency review.

Safety boundaries: The backend owns the *only* ECU session and shared
acquisition. The optional native WebSocket connects to an existing backend
subscriber route only; no POST, ECU command, independent polling, or writes.
Only backend-originated numeric values are displayed as live. DWARF link-time
addresses are never passed as runtime addresses.

Pending, **not passed**: real Windows binary startup/screenshot; 2k/20k
native observations; React 2k baseline (not present in PR #53); matching
React/uPlot Windows observations; backend subscriber simulator E2E;
GPU present/input-to-photon latencies and comparable browser-process RSS.
Rust tests and branch CI must be checked on the exact PR head before review.

See crates/xcp-desktop/README.md for fixture formulas, benchmark steps,
limits, and explicit no-migration gate. Project integration and safety owner
sign-off is mandatory before considering this spike production-ready.

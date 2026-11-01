# Unabhängige Integrations-, Sicherheits- und GUI-Performance-Abnahme — 2026-11-01

**Urteil: NO-GO für die Gesamtfreigabe und NO-GO für einen Ersatz von React/uPlot durch egui/eframe.** Dies ist kein Bericht über einen fehlgeschlagenen vollständigen Produkttest: Die notwendigen integrierten Prüfungen und vergleichbaren nativen Messungen fehlen. Mehrere eng begrenzte Simulator- und CI-Tests sind erfolgreich.

## 1. Unveränderlicher Prüfgegenstand und Nachweisstufen

- **Integrierter Ausgangsstand:** `main` = [`8014d82a8ef39c85a3c441a93206b605af0d2c71`](https://github.com/JannisRln/xcp-studio/commit/8014d82a8ef39c85a3c441a93206b605af0d2c71), überprüft am 2026-11-01. Windows-`main`-CI: [41328558606](https://github.com/JannisRln/xcp-studio/actions/runs/41328558606), Jobs `rust`, `frontend`, `docs`, `live-view-e2e` erfolgreich. Separater Branch-Pruning-Workflow [41328558494](https://github.com/JannisRln/xcp-studio/actions/runs/41328558494) erfolgreich; dieser ersetzt keine Produktabnahme.
- **Nicht in `main`:** [#53](https://github.com/JannisRln/xcp-studio/pull/53) React/uPlot-Quality, E2E und Benchmark, Head `c6440783c3d9032460b4f1ecc5d4c549afcad6ed`, offener Draft. Sein erweitertes Windows-E2E **und** sein 20k-Benchmark wurden im CI-Lauf [41340881302](https://github.com/JannisRln/xcp-studio/actions/runs/41340881302) auf genau diesem Head ausgeführt und erfolgreich abgeschlossen. [#54](https://github.com/JannisRln/xcp-studio/pull/54) wurde **in den Feature-Branch #53**, nicht nach `main`, gemergt.
- **Nicht in `main`:** [#55](https://github.com/JannisRln/xcp-studio/pull/55) nativer egui/eframe-Prototyp, Head `59b8a67ac74c562abcfd02762f334be393be1534`, offener Draft. Windows-CI [41340891973](https://github.com/JannisRln/xcp-studio/actions/runs/41340891973) mit vier grünen Jobs; **keine native GUI-Laufzeitmessung, kein Windows-GUI-Screenshot und keine native Backend-Subscriber-E2E-Prüfung** nachgewiesen.
- Weitere noch **offene, nicht integrierte** Teilimplementierungen: [#49 Pointer-Core](https://github.com/JannisRln/xcp-studio/pull/49), [#50 Kalibrierungs-Core ohne Schreibpfad](https://github.com/JannisRln/xcp-studio/pull/50), [#51 Projektdatei-Core](https://github.com/JannisRln/xcp-studio/pull/51), [#52 Diagnostik-Core](https://github.com/JannisRln/xcp-studio/pull/52), [#48 A2L-Core](https://github.com/JannisRln/xcp-studio/pull/48). Grüne PR-CI bedeutet **nicht**, dass die Funktion bereits auf `main` oder Ende-zu-Ende freigegeben ist.
- **Methode:** Repository- und Programmcode-Review, GitHub-PR-/Commit-/CI-/Workflow-Logs und tatsächlich ausgegebene Benchmarkdaten. **Keine eigene lokale Windows-Ausführung, keine ECU/HIL-Hardware, kein identischer physischer Host für beide UIs.** Die Review-Perspektive ist unabhängig; Ausführungen anderer CI-Workflows sind als Fremdevidenz gekennzeichnet. `git clone` war in der Review-Laufzeitumgebung wegen fehlender GitHub-DNS-Auflösung nicht möglich. Daher keine behaupteten eigenen `cargo`-, `npm`- oder Browser-Testläufe.
- **Statusbezeichnungen:** `PASS (CI)` = konkret benannter nachweisbarer begrenzter Test auf angegebenem Commit; `CODE-REVIEW` = plausibler Implementierungsbefund ohne eigene Laufzeitausführung; `PARTIAL` = Test/Scope unvollständig; `NOT TESTED` = kein belastbarer Nachweis; `BLOCKER` = notwendige Freigabebedingung fehlt bzw. nachgewiesene Sicherheitsgrenze verhindert das vollständige Ziel. Kein `NOT TESTED` wird als fehlgeschlagener Test ausgegeben.

## 2. Teil A — funktionale Abnahme

| Abnahmekriterium | Ergebnis und belegbarer Umfang | Freigabelücke |
| --- | --- | --- |
| XCP-Simulator connect/disconnect | **PASS (CI, Simulator)**: `scripts/live-view-e2e.mjs` verbindet den Simulator, liest zwei feste XCP-Signale und prüft Stop, Disconnect und Ablehnung weiterer Reads; `main`-CI 41328558606. | Keine HIL-/PCAN-/Vector-Verbindungsabnahme. |
| Genau eine autoritative ECU-Session | **PASS (CODE-REVIEW + Unit/CI, Simulator)**: ein `SessionActor` in `xcp-server/src/main.rs`; `xcp-core/src/session.rs` serialisiert SET_MTA/UPLOAD/DOWNLOAD und CONNECT/DISCONNECT, begrenzte Queue/Deadlines, Fault-Semantik. | Driver-spezifische in-flight Cancellation und echte ECU-Identity/Capabilities nicht belegt. |
| Mehrere Live-Subscriber, keine doppelte Acquisition | **PASS (CI, v1)**: `scripts/live-view-e2e.mjs` prüft zwei WebSocket-Subscriber mit gleicher Acquisition-ID und fortlaufender Sequenz; `acquisition.rs` besitzt einen Scheduler und Broadcast-Kanal. | Legacy-`/api/xcp/stream` führt weiterhin pro Client Polling aus; keine pauschale Aussage über alle Endpunkte oder DAQ. |
| Pause/Resume + WebSocket-Reconnect | **PASS (CI, begrenzt)**: Basis-Browser-E2E auf `main`; erweitertes Browser-E2E auf **nicht gemergtem** #53-Head meldet `PASS pause/resume` und `PASS WebSocket reconnect reuses single backend acquisition`. | Reconnect mit langsamem Client, langem Ausfall und Neustart des Backends nicht durchgängig nachgewiesen. Display-Pause ist nicht Acquisition-Pause. |
| Datenqualität, STALE und tatsächliche Messlücken | **PARTIAL**: v1 Quality-/Zeitursprungsfelder und Sequenz-/Subscriber-Gaps, browserseitige STALE-Anzeige und qualitätsbewusste `null`-Gap-Linien im offenen #53. | `subscriber`-Lag ist nicht bewiesener ECU-/DAQ-Sampleverlust. Host-Zeitstempel entsteht nach sequentiellen Reads, keine ECU-synchrone Messzeit. Legacy-Qualität bleibt unverifiziert. Fehlende Samples, Uhrregression, echter DAQ-Verlust und Ende-zu-Ende-Quality nicht vollständig integriert. |
| CSV und A/B-Messcursor | **PASS (CI, eingeschränkt)**: Browser-Cursor/Chart auf `main`; #53-Head erweiterter realer Browser-E2E mit `PASS browser CSV export matches backend sequence, timestamps and values` sowie A/B-Messwerten. | CSV nur begrenzter Browser-Preview-Puffer (typisch 2.000 Frames), keine vollständige, dauerhafte Backend-Aufnahme, kein Replay/Disk-Fault-Test. Erweitertes E2E noch nicht auf `main`. |
| Pointer-Chains, NULL, Zyklen, ECU-Identitätswechsel | **NOT TESTED in integriertem System**: #49 besitzt isolierte Mock-Memory-Resolver-Tests für Breite, Endianness, NULL, Cycle, Bounds, Stale Identity; PR-CI grün. | #49 offen; kein realer XCP-Session-Reader/Mapping, kein atomisches Identity-/Reconnect-Invalidieren, keine dynamischen DWARF-Expressions. ELF-Link-Time-Adressen dürfen nie ungeprüft Runtime-Adressen werden. |
| A2L-Metadaten, Projektdatei, Diagnostik | **PARTIAL / NOT TESTED integriert**: DWARF-Typbasis auf `main`; isolierte A2L (#48), Projekt (#51), Diagnose (#52) in offenen PRs mit eigenen Tests. | Kein nachgewiesener gemeinsamer Import→Identitätsprüfung→Live-Konversion→Projekt-Restore→Diagnoseexport; A2L-Konflikt und beschädigte Dateien im integrierten Produkt offen. |
| Kalibrierung ausschließlich mit ausdrücklicher Simulatorfreigabe | **BLOCKER (Funktionsziel)**: #50 enthält nur isolierten, nicht in `main` gemergten Preview-/Verifikations-Core mit Mock-Test. Es existiert kein freigegebener HTTP/GUI-Commitpfad. | `read→preview→explicit confirm→write→readback→verify` gegen den realen Simulator fehlt; atomische Session-Bindung, Audit, post-send-`Unknown` und Sicherheitsfreigabe fehlen. Hardware-Schreiben bleibt strikt gesperrt. |
| Keine unautorisierten ECU-Schreibzugriffe | **PASS (begrenztes Code-/CI-Sicherheitsgate)**: `hardware_policy.rs` verweigert `WriteMemory` für Simulator und physische Ziele, einschließlich Startup-Self-Check; `main.rs` exponiert keinen ECU-Memory-Write-/Calibration-Commit-Endpunkt. | Dies ist keine formale Penetrationsprüfung; interne XCP-`write`-Methode existiert für Core-Nutzung. Jede künftige Exposition benötigt eine tatsächlich durchgesetzte Autorisierung an allen Write-Entry-Points, nicht nur ein unverbundenes Policy-Modul. |

### Bekannte Freigabeblocker und konkrete Risiken

- **B-01, Release:** Vollständiges Simulator-E2E inklusive autorisierter Kalibrierung und Readback fehlt ([T-0011](../tickets/T-0011-simulator-e2e-release.md), [T-0007](../tickets/T-0007-calibration-transaction.md)).
- **B-02, Safety:** Runtime-Adressmapping und Pointer-Identity-Invalidierung sind nicht mit der zentralen Session integriert ([T-0014](../tickets/T-0014-runtime-pointer-resolution.md)); unbestätigte ELF-Link-Time-Adressen dürfen nicht gelesen oder geschrieben werden.
- **B-03, Qualität/Datenverlust:** Keine End-to-End-Semantik und Akzeptanz für tatsächliche ECU-Lücken, Legacy-Quality, Roh-/physikalische Werte, durable Recording und Replay ([T-0005](../tickets/T-0005-shared-acquisition.md), [T-0015](../tickets/T-0015-backend-recording-store.md)).
- **B-04, Governance:** `main.protected=false` und `GET /repos/JannisRln/xcp-studio/rulesets` ergibt `[]`; erfolgreiche CI allein erzwingt keinen Review-/Check-Merge-Gate. T-0012 ist außerdem noch durch unabhängige DTO-Owner-Abnahme blockiert ([T-0001](../tickets/T-0001-ci-quality-gates.md), [T-0012](../tickets/T-0012-versioned-api-contracts.md)).
- **B-05, GUI-Migrationsentscheidung:** Keine validen identischen 2k/20k-Messreihen für beide Systeme und keine native Input-to-Present-/RSS-/CPU-/Packaging-Abnahme. Ein Ersatz der produktiv integrierten React-GUI ist derzeit **nicht gerechtfertigt**.
- **Kein bestätigter Produktions-Sicherheitsvorfall aus dem Review:** Die vorstehenden Punkte sind fehlende Release-/Integrationsnachweise oder explizite Grenzen; sie sind nicht als reproduzierter unautorisierter ECU-Write ausgegeben.

## 3. Teil B — Performance: reale Beobachtung und methodische Fallstricke

### 3.1 Messmatrix / belastbare Rohdaten

Test `frontend/src/features/measurements/live-view.bench.mjs` auf #53-Head `c6440783`; [Windows-CI 41340881302](https://github.com/JannisRln/xcp-studio/actions/runs/41340881302), Job `live-view-e2e`, Artefakt [xcp-uplot-20k-benchmark-windows](https://github.com/JannisRln/xcp-studio/actions/runs/41340881302/artifacts/13097084012). Protokoll: 2026-11-01T19:18:46Z. Windows `win32`, Build 10.0.26100; AMD EPYC 7763, 4 logische vCPUs des Runners, 17.174.360.064 Byte Host-Gesamtspeicher; Node v22.23.4, Microsoft Edge. Headless Edge wurde mit `--disable-gpu` gestartet.

Fixture: synthetisch, `timestamp_ms = 1761980000000 + i`, 2 Signale, RPM-Spike bei `i % 683 === 0`, Temperatur `88.5 + (i % 17)/10`; 20.000 Frames je Update, 80 Drop-/Append-Updates, 15.000-ms-Zeitfenster, maximal 1.400 Plotpunkte je Lane. **Kein XCP und keine physische ECU in diesem Benchmark.**

| Größe | React/uPlot 2k | React/uPlot 20k (ein CI-Lauf) | egui/eframe 2k | egui/eframe 20k |
| --- | ---: | ---: | ---: | ---: |
| Status | nicht instrumentiert | **gemessen**, synthetisch | nicht ausgeführt | nicht ausgeführt |
| Beobachtete FPS | — | 8,4281 (rAF, nicht GPU-Present) | — | — |
| Abgeschlossene Updates/s | — | 4,2141 | — | — |
| React synchronous commit p50/p95/p99 | — | 212,2 / 266,3 / 325,6 ms | nicht vergleichbar | nicht vergleichbar |
| Update→zweiter rAF p50/p95/p99 | — | 232,7 / 284,0 / 342,9 ms | nicht vergleichbar | nicht vergleichbar |
| JS Heap vorher/nachher/delta | — | 10.014.520 / 75.844.948 / +65.830.428 Bytes | kein JS Heap | kein JS Heap |
| CPU gesamt, OS-Prozess-RSS, GPU-Present, Pan/Zoom/Cursor p50/p95/p99 | — | **nicht gemessen** | **nicht gemessen** | **nicht gemessen** |

Die 8,43 rAF-FPS und die gemessene Update-Latenz sind **ein auffälliges Performance-Symptom** dieser konkreten Browser-Testschleife. Sie sind **weder ein reproduzierter Produktions-Throughput-Einbruch noch ein Beweis für einen GUI-Library-Vorteil**. Kein Mittelwert aus wiederholten Läufen und kein Messunsicherheitsintervall liegt vor. Das Protokoll misst unter headless `--disable-gpu`, also nicht identisch zu einer interaktiven Desktop-GPU-Pipeline.

### 3.2 Browser-Benchmark auf Verzerrung geprüft (konkrete Codepfade)

1. `benchmarkHarness.tsx`: Pro Iteration `frames = [...frames.slice(1), frame(...)]` kopiert einen kompletten 20k-Datensatz und `flushSync(render)` erzwingt einen **synchronen vollständigen React-Commit**. Das ist absichtlich ein Worst-Case-Update, nicht automatisch der normale Live-View-Takt.
2. `TimeSeriesChart.tsx`: Jede neue `frames`-Referenz invalidiert `useMemo`, filtert den sichtbaren Bereich und berechnet je Lane `alignedPlotData` neu; `gapsRef.current` filtert separat. `uPlot.setData` **und** `setScale` werden bei Änderungen ausgeführt. Deren Kosten dürfen nicht pauschal als reine Canvas-Draw-Kosten etikettiert werden.
3. `plotData.ts`: `[...frames].filter(...).sort(...)` sortiert bei jeder Aufbereitung, obwohl das Streaming gewöhnlich nach Sequenz geordnet ist; `new Map(frame.samples.map(...))` wird **für jeden Frame erneut** gebaut; neue X/Y-Spalten und Indizes werden allokiert. Die 1.400-Punkt-Decimation reduziert die **Zeichendaten**, nicht diese vorgelagerten Full-History-Allokationen.
4. Prüfaufgabe: Ringpuffer oder indexbasierter View, monotone append-Pipeline statt Full-Sort, wiederverwendete Lookup-Indizes/Spalten, viewport-indexiertes Decimieren; pro Schritt getrennt Ingest, Preprocessing, React Commit, uPlot API, Paint und Gesamt-Input-Latenz instrumentieren. Danach den unveränderten Vorher-Nachher-Vergleich **neu** messen; keine ungeprüfte Verbesserung behaupten.

### 3.3 Versteckte native Kosten und Vergleichbarkeit

- #55 `fixture.rs` nutzt `VecDeque.pop_front()/push_back()`: der Fixture-Update selbst kopiert im Gegensatz zum Browser-Test **nicht** 20.000 Frames. Das ist ein **methodischer Unterschied** der zu trennenden Ingest-Kosten, auch wenn die numerischen Eingangssamples gleich sind.
- #55 `main.rs` und `fixture.rs`: `chart_segments` traversiert und allokiert Plot-Segmente/Linien je sichtbarer Lane und Repaint neu; Gap-Filter sowie Cursor-`nearest_value` durchsuchen vorhandene Frames. `request_repaint_after(16 ms)` kann Repaints ohne neue XCP-Daten anfordern. Diese CPU-/Allokations-/Energie-Kosten müssen mit Profiler und 20k-/Gap-Stress geprüft werden.
- #55 `benchmark.rs` erfasst `App::ui` CPU-Zeit, vorherigen eframe-Frame-CPU-Wert und Callback-Intervalle, **nicht GPU-Present**. Native Prozess-RSS ist nur ein Zeitpunkt nach dem Lauf, nicht der Peak. Browser-`Runtime.getHeapUsage` ist **nicht** OS-RSS. `clickToNextUpdateProxyMs` ist nicht Input-to-Photon und braucht echte Klickproben; Zoom/Pan fehlen als vergleichbare Wiederholtests.
- Beide Lösungen zeigen zwei Lanes und arbeiten mit demselben numerischen Fixture; das macht die Daten korrekt vergleichbar, **nicht die derzeitige Messmethodik**. Native GUI wurde auf CI nur kompiliert/getestet, nicht visuell auf realem Windows-Desktop ausgeführt. Der vorhandene PowerShell-Benchmark ist ein **Rezept**, kein Laufbeweis.

### 3.4 Wiederholbarer fairer Benchmarkplan (keine erfundenen Zahlen)

Auf **demselben interaktiven Windows-PC**, für beide Systeme denselben Git-SHA-Stand je Kandidat sowie 2.000 und 20.000 Frames, 80+ Updates, identische 15s-Viewport-/1.400-Plotpunkt-/Gap-/Spike-Fixtures dokumentieren. Windows-Build, CPU/GPU, RAM, Display-Auflösung, Skalierung/Hz, Treiber, Energieprofil, Browser/eframe-Version, Debug-vs-Release, Hintergrundlast und Prozess-Grenzen erfassen. Mindestens 3 Wiederholungen pro Kombination, Warmup und Reihenfolge randomisieren, jeweils Median und p50/p95/p99 plus Rohdaten/Traces aufbewahren.

**Messreihen getrennt:** (a) rein synthetischer Draw-/Preprocess-Benchmark, (b) identischer Append-/Drop-Update einschließlich Framework, (c) native und Browser-Zoom/Pan/A/B-Cursor mit OS-Input→GPU-Present oder expliziter Proxymetrik, (d) realer Simulator-XCP-Backend-Durchsatz mit 1 und 2 Subscribern, Sequenz-Gaps, Queue-Max und Rate/Jitter, **ohne** den UI-FPS-Wert als ECU-DAQ-Rate zu verkaufen. Gleiche Messgrenzen für Prozess-CPU, Peak-/steady RSS und GPU verwenden; im Browser Renderer/GPU-/Browser-Prozesse sauber spezifizieren. Für vergleichbare Browser-GPU-Present-Tests `--disable-gpu` nicht unbemerkt aktiv lassen.

**Reproduktionsbefehle für den jeweiligen Quell-Branch** (nicht auf unverändertem `main` verfügbar):

```powershell
# Aus PR #53, Node >=22, Edge/Chromium; Rust-Simulator für E2E
cargo build -p xcp-server
cd frontend
npm ci
cd ..
node frontend/src/features/measurements/live-view.browser-e2e.mjs
node frontend/src/features/measurements/live-view.bench.mjs

# Aus PR #55, nur auf interaktivem Windows-Rechner:
cargo test -p xcp-desktop
cargo run --release -p xcp-desktop -- --benchmark
pwsh -File crates/xcp-desktop/scripts/windows-benchmark.ps1
```

Ein normaler `cargo test --workspace` ist **kein** Test der realen GUI-Präsentation. Keine native Messzahl aus einem erfolgreichen CI-Build ableiten.

## 4. Teil C — Architektur- und Sicherheitsgrenzen

- **Backend-Acquisition/Thread-Grenze (CODE-REVIEW):** zentraler `SessionActor` als eigener serieller Rust-Worker; asynchrone Axum-API lagert synchrone Session-Aktionen mit `tokio::task::spawn_blocking` aus. `AcquisitionService` startet einen Tokio-Scheduler je aktiver Acquisition mit einem `tokio::sync::broadcast`-Fanout; Browser/egui sind Subscriber, keine eigene ECU-Polling-Autorität. `/api/xcp/stream` bleibt als **Legacy-Client-Poller** und darf nicht als Teil der neuen Shared-API gezählt werden.
- **Ressourcen/Backpressure (CODE-REVIEW):** v1: 20–10.000 ms Polling-Konfiguration, ein aktiver Acquisition-Run, `broadcast`-Kapazität 128, maximal 16 Subscriber, `Lagged`-Gap-Ereignisse und WS-Send-Timeout; die native Bridge hat eine Queue von 256 Events und konsumiert höchstens 128 je UI-Pass. Grenzen existieren; fehlende Last-/Langzeittests und Drop-Korrelation bleiben Freigabelücken. Es gibt keine garantierte 1-kHz-DAQ-Erfassung.
- **Reconnect/Fail-Closed:** Session faultet bei nicht sicher abgeschlossenem Timeout und fordert explizite Wiederherstellung; Disconnect stoppt aktive Acquisition. Status-/Gap-Ursprung ist nicht mit physischem ECU-Sampleverlust gleichzusetzen. Unbekannter Write-Ausgang nach Timeout darf nicht automatisch wiederholt/rollbackt werden.
- **Schreibsicherheit:** bindet REST-Backend an `127.0.0.1:8080`, lokale Host/Origin-/Request-Grenzen, keine exponierte Memory-Write-Route. Die standalone Hardware-Policy verweigert alle ECU-Memory-Writes. Für zukünftige Simulator-Kalibrierung ist ein separat genehmigter, technisch durchgesetzter Simulationskontext mit Confirmation, autorisierter Session und Readback erforderlich. Keine Aufweichung für reale ECUs.
- **Wartbarkeit:** React/uPlot ist bereits in Browser-E2E, Komponenten-Tests, typed API und Produktnavigation integriert; klare Backend-Grenze ist unabhängig vom View-Technologieentscheid. egui erhöht mindestens Rust-UI-/GPU-/Docking-/Bridging-/Packaging-Oberfläche und benötigt neue Zugänglichkeits-, Stabilitäts-, Input-, Multi-Monitor- und Windows-Distributionstests. Ein dokumentiertes signiertes MSI/MSIX/Auto-Update- und Crash-Diagnostik-Verhalten liegt für **keine** Seite als Vergleichsnachweis vor.
- **Migration:** React/uPlot bleibt die **vorläufig bevorzugte produktive GUI**, nicht wegen nachgewiesener schnellerer FPS, sondern wegen des vorhandenen integrierten Funktions- und Testumfangs bei **fehlender valider Überlegenheit von egui**. Falls später belastbare Vorteile nachgewiesen werden: zunächst **read-only native Live-View als optionaler Subscriber** über die unveränderte v1-Backend-API, ohne Session/DTO-/Sicherheitsduplizierung. Danach eigenständiges UX-/Packaging-/Security-Gate und erst danach eine Entscheidung über weitere Migration.

## 5. Konkrete nächste Tickets, priorisiert

Dies sind **neue, noch nicht als GitHub-Issues angelegte QA-Follow-ups** unter bestehenden kanonischen Markdown-Tickets. Kein Ticket ist hiermit erledigt oder entgegen bestehender Eigentümerschaft übernommen.

| Priorität / Arbeitspaket | Referenz / Done-Kriterium |
| --- | --- |
| **P0 QA-F01 – Integrierte Simulator-Release-Abnahme** | [T-0011](../tickets/T-0011-simulator-e2e-release.md), QA-003: connect→zwei Subscriber→Pause/Resume/Disconnect→CSV→simulator-autorisierter Preview/Write/Readback-Mismatch; alle negativen Fehlerpfade, frischer Head, Windows-Rohlogs. **Abhängig von T-0007.** |
| **P0 QA-F02 – Native/Web-Paritätsmessung** | [T-0011](../tickets/T-0011-simulator-e2e-release.md), QA-007: identischer Host, 2k/20k, 3+ Runs, CPU/RSS/GPU-Present, Zoom/Pan/Cursor p50/p95/p99; Fixture-Hashes/Traces und Bewertung im PR. Bis dahin keine Migration. |
| **P0 QA-F03 – Browser-Preprocessing entflechten** | [T-0006](../tickets/T-0006-measurement-workspace.md): Full-copy/`flushSync`/Full-sort/`Map`-Kosten isolieren, Vergleich vor/nach Optimierung unter identischer Semantik/Gap- und Spike-Tests. Abstimmung mit aktivem #53-Owner. |
| **P0 QA-F04 – Runtime-Pointer-XCP-Identity-Gate** | [T-0014](../tickets/T-0014-runtime-pointer-resolution.md): #49 nach Review, frische validierte ECU-/Image-/Session-Identität, Runtime-Map, Read-Bounds, Wechsel/NULL/Zyklus/Stale-Reconnect-Tests **im serialisierten Actor**, kein ELF-Auto-Mapping. Vertrag nur nach T-0012-Owner-Abstimmung. |
| **P0 QA-F05 – Kalibrierungs-Sicherheitsintegration** | [T-0007](../tickets/T-0007-calibration-transaction.md), [T-0013](../tickets/T-0013-security-safety-policy.md): explizit nur Simulator, Einmal-Token, Wertebereich, Readback und Unknown-nach-Send; alle anderen Write-Pfade demonstrativ DENY; unabhängige Security-Review. |
| **P0 QA-F06 – Shared-Acquisition-Fault-/Lagentest** | [T-0005](../tickets/T-0005-shared-acquisition.md), MEAS-005/-012: 2/16 Subscriber, >128 Event-Lag, WS-Slow-Send, Reconnect, Drop-/Gap-Korrelation und konstant ein Scheduler; Legacy-Route getrennt vermessen. |
| **P0 QA-F07 – Branch-Governance und Contract-Sign-off** | [T-0001](../tickets/T-0001-ci-quality-gates.md), [T-0012](../tickets/T-0012-versioned-api-contracts.md): geschützte `main`-Checks/Review inklusive absichtlich blockiertem Merge nachweisen; unabhängige API-Owner-Freigabe. |
| **P1 QA-F08 – Metadaten/Projekt/Diagnose-Reopen-E2E** | [T-0008](../tickets/T-0008-a2l-import-mapping.md), [T-0010](../tickets/T-0010-project-persistence.md), [T-0016](../tickets/T-0016-diagnostics-observability.md): A2L-Konflikte/Conversion, Schema-Migration/beschädigte Dateien/ECU-Fingerprint-Stale, erlaubte Diagnoseexporte ohne Pfad-/Secret-Leak und gezielte Fault-Injection. |
| **P1 QA-F09 – Backend-Aufzeichnung & echte Lücken** | [T-0015](../tickets/T-0015-backend-recording-store.md), [T-0005](../tickets/T-0005-shared-acquisition.md): unabhängiger Recorder/CSV vs. Referenzbatches, Disk-Full, Replay, unbekannte/ungültige Qualität, DAQ-vs-Subscriber-Verluste getrennt. |
| **P1 QA-F10 – Read-only native Subscriber- und Windows-Packaging-Spike** | [#55](https://github.com/JannisRln/xcp-studio/pull/55), in einem **separat koordinierten** GUI-Ticket: echter Simulator-Subscriber, Backpressure/Gaps/Disconnect, GUI-Input/CPU/GPU-Profiling, High-DPI/Undock/Keyboard, Startup, signiertes Packaging und reproduzierbares Rollback. |

## 6. Klare Schlussentscheidung und nächste Review-Gates

1. **Bestanden:** Windows `main`-CI; begrenzte Simulator-Connect-/Disconnect-, Session-Actor-, Shared-Acquisition-/Zwei-Subscriber- und Live-View-Tests. Auf offenem #53-Head zusätzlich erweiterte Browser-E2E für Pause/Resume, Reconnect, A/B und CSV. Die derzeitige öffentliche Schreibsperre ist durch Code und Unit-Tests gestützt.
2. **Fehlend:** integrierte Sicherheits-/Metadaten-/Pointer-/Kalibrierungs-/Recording-Abnahme, HIL, Last-/Fault-Tests, reale native Windows-UI-Ausführung, React-2k-Lauf und faire native/Web-Performance-Matrix.
3. **Freigabeblocker:** B-01 bis B-05 oben. Keine Produkt-, Hardware- oder Kalibrierungsfreigabe auf Basis dieses Reviews.
4. **GUI-Entscheid:** **React/uPlot vorerst beibehalten und Browser-Datenpfad optimieren; keine native Migration genehmigen.** Die einmalig gemessenen 8,43 FPS im 20k-Worst-Case sind ein Untersuchungssignal, kein gültiger Cross-Framework-Sieg.
5. **Handoff:** QA-F01..QA-F10 mit klarer Ticketzuordnung und messbaren Done-Kriterien. Änderungen in diesem QA-PR sind ausschließlich Dokumentation; keine Änderungen an Feature-Branches, Session-Protokollen, DTOs, Lockfiles, CI oder Hardware-Safety.

**Rollback:** QA-Dokument aus dem Branch/PR entfernen. Keine Produktmigration, keine Daten- oder Schnittstellenänderung.

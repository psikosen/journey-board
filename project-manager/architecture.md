# Client-Side SOP Agent (WASM) — Architecture & MVP Blueprint

## Product Goal
Enable privacy-preserving discovery, documentation, and optimization of website workflows entirely on-device using WebAssembly/WebGPU accelerators. The agent observes user sessions, extracts semantic events, mines process candidates, and generates SOPs plus automation suggestions without network egress.

## Operating Modes
### Mode A — Zero-Code Screenshare
- **Permissions**: `navigator.mediaDevices.getDisplayMedia()` with user-selected surface.
- **Capture Strategy**: Adaptive frame sampling (5–10s baseline, faster during high-change periods).
- **Perception Stack**: Vision classifier for page type and UI keypoints, selective OCR for textual elements, coarse action inference.
- **Output**: Semantic event stream → process mining → SOP drafts.
- **Trade-offs**: Universal coverage with minimal setup at the cost of reduced DOM semantics and OCR reliance.

### Mode B — First-Party JS SDK
- **Integration**: Lightweight snippet emitting semantic beacons (`data-sop` attributes) and high-fidelity DOM signals.
- **Enhancements**: Route changes, form commits, API success/error events, optional thumbnails per event.
- **Trade-offs**: Requires integration but unlocks richer semantics, lower OCR load, and higher accuracy.

## High-Level Flow
```
[User Consent & Capture]
   │  getDisplayMedia (tab/window)
   ▼
[Frame Sampler]───►[OCR (WASM)]
   │               (Tesseract.js w/ regions)
   ▼
[Vision Classifier (WASM/WebGPU)]  ─┐
   (ViT/CLIP‑mini)                 │
                                   ├─►[Event Fusion]─►[Event JSONL]
[SDK Events (optional)]────────────┘
                                      │
                                      ├─►[Scribe LLM (WebLLM)] → Human log
                                      │
                                      └─►[Process Miner] → Candidates
                                                │
                                                └─►[SOP Builder] → SOP.md / SOP.yaml / BPMN.xml
```

## Core Components Overview
1. **Consent & Redaction**: Browser picker plus overlay for region/keyword masking. Default offline processing toggle.
2. **Frame Sampler**: Adaptive cadence (0.2–1 Hz), OffscreenCanvas rendering, LRU cache of frames.
3. **Vision Module**: Quantized ViT/CLIP mini models with multi-head outputs (page type, UI keypoints, action inference).
4. **OCR Module**: Tesseract.js WASM with region targeting, deduplication, and on-demand language packs.
5. **Event Fusion**: Merge vision/OCR outputs (and SDK signals) into deduplicated semantic events.
6. **Scribe LLM**: WebLLM (Llama-3.1 3B/8B INT4) streaming log summarizer.
7. **Process Miner**: Prefix-tree mining for frequent contiguous subsequences with support, duration, variants, and drop-offs.
8. **SOP Builder**: Generates Markdown/YAML/BPMN-ready SOPs with cues, actions, pitfalls, and optional thumbnails.
9. **Exporter**: Local file save, optional encrypted bundles, future integrations (Git, Confluence, Notion, Google Drive).

## Data Schemas
### Observation
```json
{
  "t": 1731305405.23,
  "frameId": 124,
  "vision": {"page": "CheckoutStep2", "confidence": 0.83},
  "ocr": {"title": "Shipping", "buttons": ["Continue", "Back"], "alerts": ["Invalid ZIP"]},
  "signals": {"scroll": true, "typing": false},
  "redactions": ["email", "credit_card"]
}
```

### Event
```json
{
  "t": 1731305406.01,
  "type": "page:view",
  "name": "CheckoutStep2",
  "props": {"title": "Shipping", "alerts": []}
}
```

### Process Candidate
```json
{
  "id": "proc_checkout_v1",
  "support": 0.41,
  "sequence": [
    {"type": "page:view", "name": "Cart"},
    {"type": "action:click", "name": "Checkout"},
    {"type": "page:view", "name": "CheckoutStep1"},
    {"type": "page:view", "name": "CheckoutStep2"}
  ],
  "avgDurationSec": 182,
  "variants": 3,
  "dropoffs": [{"atStep": 2, "rate": 0.24}]
}
```

### SOP (YAML)
```yaml
id: SOP-CHK-001
name: Standard Checkout Flow
preconditions:
  - User is logged in
  - Cart has ≥ 1 item
steps:
  - id: 1
    title: Open Cart
    cues: ["Cart", "Subtotal"]
    action: Click the Cart icon in the top nav
    success: Cart page visible
    pitfalls: ["Stale cart cache"]
  - id: 2
    title: Start Checkout
    cues: ["Checkout", "Secure"]
    action: Click **Checkout**
    success: Checkout Step 1 visible
  - id: 3
    title: Enter Shipping Details
    cues: ["Shipping", "Address"]
    action: Complete required fields and click **Continue**
    success: Step 2 visible
postconditions:
  - Order review page visible
```

## Prompt Templates
- **Scribe (session log)**: Summarizes event JSONL into timestamped activity log plus friction bullets without inventing steps.
- **Reducer (process consolidation)**: Produces top canonical processes from multiple sessions with variants and errors.

## Models & Runtimes
- **Text LLM**: WebLLM Llama-3.1 Instruct (3B default, 8B optional) INT4 quant.
- **Vision**: ViT-tiny/CLIP-mini via Transformers.js or ONNX Runtime Web (prefer WebGPU, fallback to WASM).
- **OCR**: Tesseract.js WASM with lazy language pack loading.
- **Acceleration**: WebGPU preferred; fallback to WASM+SIMD+Threads with IndexedDB caching of weights.

## Privacy & Security Principles
- Offline-only default, no automatic network calls.
- Redaction overlay and regex presets for sensitive data.
- Ephemeral buffers with auto-purge and panic erase.
- Visible capture banner while active.

## Performance Targets
- ≤75 ms per sampled frame on WebGPU, ≤250 ms on WASM.
- Frame cadence 5 s baseline, 2 s during active input, 10–15 s idle.
- OCR budget: ≤1 region every other frame with text dedupe via perceptual hash.
- Lazy model loading with small resident tokenizer/runner.

## UX Outline
1. Start Capture → Browser picker → Redaction overlay → Start.
2. Live HUD: page type, last event, timer, privacy status.
3. Events Pane: JSONL inspector with copy/export.
4. Processes Pane: Candidate rankings with "Generate SOP" triggers.
5. SOP Editor: Markdown/YAML editing with optional thumbnails and export buttons.

## Process Mining Approach
- Prefix-tree mining over contiguous k-grams (k=2..K) with support threshold θ.
- Merge sessions into shared trie, prune low-support nodes.
- Variant detection via Levenshtein distance; drop-off analysis via prefix counts.

## Automation Opportunity Mining (Post-MVP)
- Heuristics: repetition, copy-paste, error-prone steps, latency, multi-hop, schedule-able tasks.
- Scoring formula factoring support, duration saved, error rate boost, friction.
- Backlog item schema for ROI estimation and macro hints.

## MVP Scope (6–8 Weeks)
- Mode A screenshare with redaction overlay.
- Vision classifier + selective OCR.
- Event fusion + JSONL export.
- Scribe log + lightweight process miner.
- SOP Builder → Markdown & YAML with local export.
- Basic UX (HUD, Events, Processes, Editor).

### Non-Goals
- Full DOM SDK, BPMN export, macro playback, team sync.

## Acceptance Criteria Highlights
- Consent flow with capture banner.
- Accurate page classification and SOP generation on demo ecommerce site.
- Offline-only operation.
- Verified redaction effectiveness.
- Downloadable event/SOP files under 10 MB per session.

## Risks & Mitigations
- **OCR Noise**: Region targeting, dedupe, confidence thresholds.
- **GPU Variability**: WASM fallback, cadence control, progressive loading.
- **PII Leakage**: Default redactions, offline processing, user control.
- **Ambiguous UIs**: Combine OCR + vision labels and allow user hinting.

## Roadmap Snapshot
- v0.1 MVP → v0.2 SDK integration → v1.0 BPMN/macro export → v1.1 improvement suggestions → v1.2 team share vault.

## Engineering Epics & Stories
- **EPIC-1** Capture & Privacy (Consent flow, redaction overlay, adaptive sampler).
- **EPIC-2** Vision & OCR (Transformers.js ViT, Tesseract.js integration).
- **EPIC-3** Event Fusion (schema, dedupe window).
- **EPIC-4** Scribe LLM (WebLLM integration).
- **EPIC-5** Process Miner (prefix tree, variant detection).
- **EPIC-6** SOP Builder & Export (Markdown/YAML generator, editor, BPMN later).
- **EPIC-7** UX (HUD, events/process panes, performance targets).
- **EPIC-8** Domain Discovery (corpus, clustering, entity-action graph, automation scoring).

## Extension Roadmap Snapshot (Zero-Egress Chrome Extension)
- **Permissions**: Minimal MV3 (`activeTab`, `scripting`, `storage`, `downloads`, `tabCapture`, `offscreen`).
- **Egress Guardrails**: CSP `connect-src 'none'`, runtime fetch/XHR patching, CI enforcement.
- **Component Layout**: Service worker, content script, offscreen document, popup UI, libraries, models, mining utilities.
- **Core Flow**: Start capture, sample frames, collect DOM events, fuse events, mine processes, export local artifacts.
- **Exports**: Session JSONL, business profile, SOP docs, automation backlog, manifest with hashes.
- **Acceptance Criteria**: Visible banner, offline success, analytics outputs, redaction verification, bounded export size.

## Sample Code Snippets
- `getDisplayMedia` capture stub, JSONL exporter, MV3 manifest/service worker/content script/offscreen document skeleton for zero-egress extension.

## Demo Script (MVP)
1. Start capture and select demo shop tab.
2. Apply redaction mask and begin capture.
3. System logs flow across checkout journey.
4. Processes pane surfaces checkout candidate with support ≈43%.
5. Generate SOP, review, and export Markdown/YAML/JSONL locally.

## Next Steps
- Scaffold Vite + TypeScript app leveraging WebLLM and Transformers.js.
- Prioritize EPIC-1 through EPIC-3 for immediate development sprint.

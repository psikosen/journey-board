# Client-Side SOP Agent

An offline-first WebAssembly/WebGPU agent that observes consented browser sessions, mines workflow patterns, and generates Standard Operating Procedures (SOPs) plus automation opportunities entirely on-device.

## Overview
- **Privacy-first capture** with explicit consent, redaction overlays, and zero network egress by default.
- **Adaptive perception stack** combining tab video sampling, quantized vision models, selective OCR, and optional first-party SDK events.
- **Semantic event fusion** pipelines observations into structured JSONL streams ready for process mining and summarization.
- **On-device intelligence** leverages WebLLM, prefix-tree mining, and heuristics to propose canonical processes, SOPs, and automation backlogs.
- **Local exports** provide Markdown/YAML SOPs, business profiles, and automation reports without leaving the user’s machine.

## Architecture Blueprint
The detailed architecture, data schemas, runtime considerations, and roadmap are documented in [`project-manager/architecture.md`](project-manager/architecture.md). Highlights include:

- Dual operating modes: zero-code screenshare capture and optional first-party SDK with semantic beacons.
- Frame sampler targeting ≤75 ms/frame processing (WebGPU) with OCR dedupe and quantized ViT/CLIP-mini classifiers.
- WebLLM (Llama-3.1) Scribe for session logs, prefix-tree miner for process candidates, and SOP builder exporting Markdown/YAML/BPMN-ready assets.
- Privacy controls such as redaction overlays, regex masking, offline guardrails, and panic erase workflows.
- Extension roadmap for a zero-egress MV3 Chrome extension with offscreen document processing.

## Getting Started
1. Review the [architecture blueprint](project-manager/architecture.md) for component responsibilities and performance budgets.
2. Use [`task.md`](task.md) to track progress across epics and stories as implementation begins.
3. Scaffold the frontend stack (Vite + TypeScript) with WebLLM and Transformers.js integrations to initiate EPIC-1 through EPIC-3.
4. Run `./build.sh` (or `npm run build`) to verify every epic remains delivered, reinstall dependencies, lint/test, regenerate icons, and package the extension artifact inside `dist/`.

## Repository Structure
```
project-root/
├── README.md
├── task.md
└── project-manager/
    └── architecture.md
└── extension/
    ├── manifest.json
    ├── sw.js
    ├── offscreen.html
    ├── offscreen.js
    ├── content.js
    ├── popup.{html,js,css}
    ├── lib/
    │   ├── adaptiveCadence.js
    │   ├── egressGuard.js
    │   └── logger.js
    └── icons/
        ├── README.md
        └── icon*.png (generated via `./build.sh`)
```

As development proceeds, expand the structure with application source, tests, model assets, and documentation while preserving privacy-first, offline-only defaults.

## Extension Quickstart

1. Visit `chrome://extensions` and enable developer mode.
2. Use "Load unpacked" to select the `extension/` directory.
3. Open the popup and start capture on a demo site to exercise the HUD, redact overlay, and adaptive sampler.
4. Inspect captured DOM events and frame observations via the `chrome://extensions` background page to validate offline processing.

The extension enforces zero egress through CSP hardening and runtime guards that disable `fetch` and `XMLHttpRequest`. Sampling cadence adapts between 2–15 seconds using the shared `AdaptiveFrameScheduler` utility, with unit coverage in `tests/adaptiveCadence.test.js`.

## Reconstructing Binary Assets

Binary artifacts (such as the extension icons) are intentionally excluded from version control. The build pipeline regenerates them automatically, but you can also invoke `./build.sh` directly to emit the required PNGs inside `extension/icons/` before loading the extension.

## Automation Scripts

Three shell helpers keep local workflows predictable and observable:

| Script | Purpose |
| --- | --- |
| `./build.sh` | Validates that every task in `task.md` is checked off, runs `npm ci`, executes lint/tests, rebuilds icons, and packages the extension into `dist/extension.zip`. |
| `./start.sh` | Orchestrates the build (unless `--skip-build` is passed) and optionally launches Chrome via `./setup-chrome.sh`. |
| `./setup-chrome.sh` | Detects a Chrome/Chromium binary, prepares an isolated profile under `.chrome-profiles/`, and (with `--auto-launch`) starts the browser with the unpacked extension preloaded. |

Each script emits structured JSON logs plus a human-readable line so CI pipelines and humans can trace progress quickly.

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

## Repository Structure
```
project-root/
├── README.md
├── task.md
└── project-manager/
    └── architecture.md
```

As development proceeds, expand the structure with application source, tests, model assets, and documentation while preserving privacy-first, offline-only defaults.

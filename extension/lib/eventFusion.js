import { EVENT_TYPES, createEventRecord, dedupe } from './eventSchema.js';

const DEFAULT_WINDOW = 1500;

function groupKey(event) {
  switch (event.type) {
    case EVENT_TYPES.CLICK:
    case EVENT_TYPES.INPUT:
      return `${event.type}:${event.selector ?? 'unknown'}`;
    case EVENT_TYPES.ROUTE:
      return `${event.type}:${event.route ?? 'unknown'}`;
    case EVENT_TYPES.OCR:
      return `${event.type}:${event.normalized ?? ''}`;
    default:
      return `${event.type}:${event.frameId ?? 'global'}`;
  }
}

export class EventFusion {
  constructor(options = {}) {
    this.windowMs = options.windowMs ?? DEFAULT_WINDOW;
    this.timeline = [];
    this.groups = new Map();
  }

  ingest(event) {
    const record = createEventRecord(event);
    this.timeline.push(record);
    const key = groupKey(record);
    const events = this.groups.get(key) ?? [];
    events.push(record);
    this.groups.set(key, events);
    this.#trim(record.t ?? Date.now());
    return record;
  }

  ingestBatch(events) {
    return events.map((event) => this.ingest(event));
  }

  #trim(now) {
    const cutoff = now - this.windowMs;
    this.timeline = this.timeline.filter((event) => (event.t ?? 0) >= cutoff);
    for (const [key, events] of this.groups.entries()) {
      const filtered = events.filter((event) => (event.t ?? 0) >= cutoff);
      if (filtered.length === 0) {
        this.groups.delete(key);
      } else {
        this.groups.set(key, filtered);
      }
    }
  }

  fuse(now = Date.now()) {
    this.#trim(now);
    const fused = [];
    for (const events of this.groups.values()) {
      if (!events.length) continue;
      const sorted = [...events].sort((a, b) => (a.t ?? 0) - (b.t ?? 0));
      const windowed = dedupe(sorted, this.windowMs);
      const head = windowed[0];
      const tail = windowed[windowed.length - 1];
      fused.push({
        type: head.type,
        start: head.t,
        end: tail.t,
        selector: head.selector ?? null,
        route: head.route ?? null,
        text: head.text ?? head.normalized ?? null,
        count: windowed.length,
        source: head.source,
        signals: mergeSignals(windowed),
      });
    }
    fused.sort((a, b) => (a.start ?? 0) - (b.start ?? 0));
    return fused;
  }

  clear() {
    this.timeline = [];
    this.groups.clear();
  }
}

function mergeSignals(events) {
  const combined = {};
  for (const event of events) {
    if (!event.signals) continue;
    for (const [key, value] of Object.entries(event.signals)) {
      if (typeof value === 'number') {
        const entry = combined[key] ?? { min: Number.POSITIVE_INFINITY, max: 0, avg: 0, count: 0 };
        entry.min = Math.min(entry.min, value);
        entry.max = Math.max(entry.max, value);
        entry.avg += value;
        entry.count += 1;
        combined[key] = entry;
      }
    }
  }
  for (const entry of Object.values(combined)) {
    entry.avg = Number(entry.avg / entry.count || 0);
  }
  return combined;
}

export function buildSession(events) {
  const fusion = new EventFusion();
  fusion.ingestBatch(events);
  return fusion.fuse();
}


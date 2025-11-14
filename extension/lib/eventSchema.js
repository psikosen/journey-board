export const EVENT_TYPES = {
  CLICK: 'click',
  INPUT: 'input',
  ROUTE: 'route',
  OBSERVATION: 'observation',
  OCR: 'ocr',
};

const VALID_SOURCES = new Set(['dom', 'vision', 'ocr', 'system']);

export function coerceTimestamp(value) {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === 'string') {
    const parsed = Number.parseFloat(value);
    if (!Number.isNaN(parsed)) {
      return parsed;
    }
  }
  return Date.now();
}

export function normalizeDomEvent(event) {
  if (!event || typeof event !== 'object') {
    throw new TypeError('DOM event payload must be an object');
  }
  const type = event.type;
  if (!Object.values(EVENT_TYPES).includes(type)) {
    throw new TypeError(`Unsupported DOM event type: ${type}`);
  }
  return {
    type,
    t: coerceTimestamp(event.t ?? Date.now()),
    selector: event.selector ?? null,
    text: event.text ?? null,
    route: event.route ?? null,
    source: VALID_SOURCES.has(event.source) ? event.source : 'dom',
  };
}

export function normalizeObservation(observation) {
  if (!observation || typeof observation !== 'object') {
    throw new TypeError('Observation payload must be an object');
  }
  return {
    type: EVENT_TYPES.OBSERVATION,
    t: coerceTimestamp(observation.t ?? Date.now()),
    frameId: observation.frameId ?? null,
    capture: observation.capture ?? {},
    signals: observation.signals ?? {},
    redactions: observation.redactions ?? 0,
    vision: observation.vision ?? null,
    source: 'vision',
  };
}

export function normalizeOcrResult(result) {
  if (!result || typeof result !== 'object') {
    throw new TypeError('OCR result must be an object');
  }
  return {
    type: EVENT_TYPES.OCR,
    t: coerceTimestamp(result.t ?? Date.now()),
    text: result.text ?? '',
    normalized: result.normalized ?? '',
    region: result.region ?? null,
    confidence: result.confidence ?? null,
    source: 'ocr',
  };
}

export function createEventRecord(event) {
  switch (event?.type) {
    case EVENT_TYPES.CLICK:
    case EVENT_TYPES.INPUT:
    case EVENT_TYPES.ROUTE:
      return normalizeDomEvent(event);
    case EVENT_TYPES.OBSERVATION:
      return normalizeObservation(event);
    case EVENT_TYPES.OCR:
      return normalizeOcrResult(event);
    default:
      throw new TypeError(`Unsupported event type: ${event?.type}`);
  }
}

export function dedupe(events, windowMs = 1000) {
  const result = [];
  const seen = new Map();
  for (const event of events) {
    const key = JSON.stringify([
      event.type,
      event.selector,
      event.text,
      event.normalized,
      event.route,
    ]);
    const timestamp = event.t ?? 0;
    const last = seen.get(key);
    if (!last || timestamp - last > windowMs) {
      result.push(event);
      seen.set(key, timestamp);
    }
  }
  return result;
}


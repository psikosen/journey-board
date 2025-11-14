import { createLogger } from './lib/logger.js';
import { installEgressGuard } from './lib/egressGuard.js';
import {
  getGlobalPrefs,
  getOriginPrefs,
  saveOriginMasks,
  setOriginConsent,
  updateGlobalPrefs,
} from './lib/preferences.js';
import { EventFusion } from './lib/eventFusion.js';
import { ScribeLLM } from './lib/scribe.js';
import { PrefixTreeMiner } from './lib/processMiner.js';
import { buildMarkdown, buildYaml, buildBpmn, hashProcess } from './lib/sopBuilder.js';
import { CorpusBuilder, kmeans, buildEntityActionGraph, scoreAutomation } from './lib/domainDiscovery.js';
import { ZipExporter } from './lib/exporter.js';

installEgressGuard(globalThis);

const logger = createLogger('extension/sw.js', 'ServiceWorker');

const EVENT_BUFFER_LIMIT = 5000;
const state = {
  active: false,
  tabId: null,
  hudEnabled: true,
  redactEnabled: false,
  masks: [],
  tabTitle: '',
  events: [],
  observations: [],
  origin: null,
  prefsLoaded: false,
  fusion: new EventFusion({ windowMs: 2500 }),
  fusedEvents: [],
  fusedIndex: new Map(),
  scribe: new ScribeLLM({ chunkSize: 80 }),
  notes: '',
  miner: new PrefixTreeMiner({ minSupport: 2, minLength: 2 }),
  trace: [],
  traces: [],
  corpus: new CorpusBuilder(),
  ocrDocuments: [],
  automation: [],
  processes: [],
};

function resetSessionState() {
  state.events = [];
  state.observations = [];
  state.fusion = new EventFusion({ windowMs: 2500 });
  state.fusedEvents = [];
  state.fusedIndex = new Map();
  state.scribe = new ScribeLLM({ chunkSize: 80 });
  state.notes = '';
  state.miner = new PrefixTreeMiner({ minSupport: 2, minLength: 2 });
  state.trace = [];
  state.traces = [];
  state.corpus = new CorpusBuilder();
  state.ocrDocuments = [];
  state.automation = [];
  state.processes = [];
}

async function ensurePrefsLoaded() {
  if (state.prefsLoaded) {
    return;
  }
  try {
    const prefs = await getGlobalPrefs();
    state.hudEnabled = prefs.hudEnabled;
    state.redactEnabled = prefs.redactEnabled;
  } catch (error) {
    logger.error('ensurePrefsLoaded', 'prefs', 'Failed to hydrate global preferences', { error });
  }
  state.prefsLoaded = true;
}

async function getActiveTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab;
}

async function ensureOffscreenDocument() {
  const hasDocument = await chrome.offscreen.hasDocument?.();
  if (!hasDocument) {
    logger.info('ensureOffscreenDocument', 'offscreen', 'Creating offscreen document');
    await chrome.offscreen.createDocument({
      url: 'offscreen.html',
      reasons: ['USER_MEDIA'],
      justification: 'Run local OCR/vision on captured tab video',
    });
  }
}

async function teardownOffscreenDocument() {
  const hasDocument = await chrome.offscreen.hasDocument?.();
  if (hasDocument) {
    logger.info('teardownOffscreenDocument', 'offscreen', 'Closing offscreen document');
    await chrome.offscreen.closeDocument();
  }
}

function getPopupState() {
  return {
    active: state.active,
    hudEnabled: state.hudEnabled,
    redactEnabled: state.redactEnabled,
    tabTitle: state.tabTitle,
  };
}

function resolveOrigin(url) {
  try {
    const Parser = globalThis.URL;
    return url && Parser ? new Parser(url).origin : null;
  } catch (error) {
    logger.warn('resolveOrigin', 'prefs', 'Failed to derive origin from tab URL', { error });
    return null;
  }
}

async function requestConsentFromContent(tabId, context) {
  try {
    const response = await sendToContent(tabId, {
      type: 'CONTENT_REQUEST_CONSENT',
      payload: context,
    });
    if (!response?.ok) {
      return { accepted: false };
    }
    return {
      accepted: Boolean(response.accepted),
      remember: response.remember !== false,
    };
  } catch (error) {
    logger.error('requestConsentFromContent', 'consent', 'Consent request failed', { error });
    return { accepted: false };
  }
}

async function applyMaskPersistence(origin, masks) {
  if (!origin) {
    return masks;
  }
  try {
    return await saveOriginMasks(origin, masks);
  } catch (error) {
    logger.error('applyMaskPersistence', 'prefs', 'Failed to persist redact masks', { error });
    return masks;
  }
}

async function applyGlobalPrefs(patch) {
  try {
    const prefs = await updateGlobalPrefs(patch);
    state.hudEnabled = prefs.hudEnabled;
    state.redactEnabled = prefs.redactEnabled;
  } catch (error) {
    logger.error('applyGlobalPrefs', 'prefs', 'Failed to persist popup preferences', { error });
  }
  return getPopupState();
}

async function pushEvent(event) {
  const normalized = { ...event, t: normalizeTimestamp(event.t) };
  state.events.push(normalized);
  if (state.events.length > EVENT_BUFFER_LIMIT) {
    state.events.splice(0, state.events.length - EVENT_BUFFER_LIMIT);
  }
  await chrome.storage.session.set({ events: state.events });
  await recordEvent(normalized);
}

async function pushObservation(observation) {
  const normalized = { ...observation, t: normalizeTimestamp(observation.t) };
  state.observations.push(normalized);
  if (state.observations.length > EVENT_BUFFER_LIMIT) {
    state.observations.splice(0, state.observations.length - EVENT_BUFFER_LIMIT);
  }
  await chrome.storage.session.set({ observations: state.observations });
  await recordEvent(normalized);
}

async function sendToContent(tabId, message) {
  try {
    return await chrome.tabs.sendMessage(tabId, message);
  } catch (error) {
    logger.warn('sendToContent', 'messaging', 'Failed to send message to content script, injecting anew', {
      error,
    });
    await chrome.scripting.executeScript({ target: { tabId }, files: ['content.js'] });
    return chrome.tabs.sendMessage(tabId, message);
  }
}

async function startCapture(prefs = {}) {
  if (state.active) {
    logger.warn('startCapture', 'lifecycle', 'Capture already active');
    return getPopupState();
  }
  await ensurePrefsLoaded();
  const tab = await getActiveTab();
  if (!tab || tab.id === undefined) {
    throw new Error('No active tab available');
  }
  state.tabId = tab.id;
  state.tabTitle = tab.title ?? '';
  const origin = resolveOrigin(tab.url ?? '');
  state.origin = origin;
  state.hudEnabled = prefs.hudEnabled ?? state.hudEnabled;
  state.redactEnabled = prefs.redactEnabled ?? state.redactEnabled;
  if ('hudEnabled' in prefs || 'redactEnabled' in prefs) {
    await applyGlobalPrefs({
      hudEnabled: state.hudEnabled,
      redactEnabled: state.redactEnabled,
    });
  }
  resetSessionState();
  let storedMasks = [];
  let consentGranted = false;
  if (origin) {
    try {
      const originPrefs = await getOriginPrefs(origin);
      storedMasks = originPrefs.masks;
      consentGranted = originPrefs.consent.granted;
    } catch (error) {
      logger.error('startCapture', 'prefs', 'Failed to load origin preferences', { error });
    }
  }
  state.masks = storedMasks;
  if (!consentGranted) {
    const consent = await requestConsentFromContent(tab.id, {
      origin,
      tabTitle: state.tabTitle,
    });
    if (!consent.accepted) {
      logger.warn('startCapture', 'consent', 'User declined capture consent', {
        method: 'NONE',
      });
      state.tabId = null;
      state.tabTitle = '';
      state.origin = null;
      state.masks = [];
      return getPopupState();
    }
    if (consent.remember && origin) {
      await setOriginConsent(origin, true);
    }
  }
  await ensureOffscreenDocument();
  await sendToContent(tab.id, {
    type: 'CONTENT_START',
    payload: {
      hudEnabled: state.hudEnabled,
      redactEnabled: state.redactEnabled,
      masks: state.masks,
    },
  });
  await chrome.runtime.sendMessage({
    type: 'OFFSCREEN_START',
    payload: {
      tabId: tab.id,
      masks: state.masks,
    },
  });
  state.active = true;
  logger.info('startCapture', 'lifecycle', 'Capture started', { method: 'NONE' });
  return getPopupState();
}

async function stopCapture() {
  if (!state.active) {
    return getPopupState();
  }
  const tabId = state.tabId;
  state.active = false;
  state.tabId = null;
  state.tabTitle = '';
  state.origin = null;
  await chrome.runtime.sendMessage({ type: 'OFFSCREEN_STOP' });
  if (tabId !== null && tabId !== undefined) {
    try {
      await chrome.tabs.sendMessage(tabId, { type: 'CONTENT_STOP' });
    } catch (error) {
      logger.warn('stopCapture', 'lifecycle', 'Content script not reachable during stop', { error });
    }
  }
  await teardownOffscreenDocument();
  finalizeTrace();
  updateDomainArtifacts();
  await persistSession();
  logger.info('stopCapture', 'lifecycle', 'Capture stopped');
  return getPopupState();
}

function sanitizeMasks(masks) {
  if (!Array.isArray(masks)) return [];
  return masks
    .map((mask) => ({
      x: clamp(mask.x),
      y: clamp(mask.y),
      width: clamp(mask.width),
      height: clamp(mask.height),
    }))
    .filter((mask) => mask.width > 0 && mask.height > 0);
}

function clamp(value) {
  if (typeof value !== 'number' || Number.isNaN(value)) return 0;
  return Math.min(Math.max(value, 0), 1);
}

function normalizeTimestamp(value) {
  if (typeof value === 'number') {
    if (value > 1e12) {
      return Math.round(value);
    }
    if (value < 1e6) {
      return Math.round(value * 1000);
    }
    return Math.round(value);
  }
  return Date.now();
}

function fusedKey(event) {
  return [
    event.type,
    event.selector ?? '',
    event.text ?? event.normalized ?? '',
    Math.round(event.start ?? event.t ?? 0),
  ].join('|');
}

function registerFusedEvents(now = Date.now()) {
  const fused = state.fusion.fuse(now);
  const additions = [];
  for (const event of fused) {
    const key = fusedKey(event);
    if (!state.fusedIndex.has(key)) {
      state.fusedIndex.set(key, event);
      state.fusedEvents.push(event);
      additions.push(event);
    } else {
      const existing = state.fusedIndex.get(key);
      existing.end = Math.max(existing.end ?? existing.start ?? 0, event.end ?? event.start ?? 0);
      existing.count = Math.max(existing.count ?? 1, event.count ?? 1);
    }
  }
  if (additions.length) {
    state.fusedEvents.sort((a, b) => (a.start ?? 0) - (b.start ?? 0));
  }
  return additions;
}

function describeEvent(event) {
  switch (event.type) {
    case 'click':
      return `click:${event.text ?? event.selector ?? 'element'}`;
    case 'input':
      return `input:${event.text ?? event.selector ?? 'field'}`;
    case 'route':
      return `route:${event.route ?? 'unknown'}`;
    case 'ocr':
      return `ocr:${event.text?.slice(0, 24) ?? 'text'}`;
    case 'observation':
      return `frame:${event.signals?.motion?.avg?.toFixed?.(2) ?? event.signals?.motion ?? 0}`;
    default:
      return event.type ?? 'event';
  }
}

function updateTrace(newEvents) {
  for (const event of newEvents) {
    if (event.type === 'route' && state.trace.length) {
      finalizeTrace();
    }
    const label = describeEvent(event);
    state.trace.push({
      label,
      start: event.start ?? event.t ?? Date.now(),
      end: event.end ?? event.start ?? event.t ?? Date.now(),
    });
  }
}

function finalizeTrace() {
  if (!state.trace.length) {
    return;
  }
  const steps = state.trace.map((entry) => entry.label);
  const duration = state.trace.reduce(
    (total, entry) => total + Math.max(0, (entry.end ?? entry.start) - (entry.start ?? 0)),
    0,
  );
  state.traces.push({ steps, duration });
  state.miner.ingest(steps, duration);
  state.trace = [];
}

function updateScribe(newEvents) {
  if (!newEvents.length) {
    return;
  }
  state.scribe.addEvents(newEvents);
  state.notes = state.scribe.summarize();
}

function addEventDocuments(events) {
  for (const event of events) {
    if (!event.text) continue;
    const id = `${event.type}:${Math.round(event.start ?? event.t ?? Date.now())}:${state.fusedEvents.length}`;
    state.corpus.addDocument(id, event.text, { type: event.type });
    state.ocrDocuments.push({ text: event.text, type: event.type });
  }
}

function updateDomainArtifacts() {
  const matrix = state.corpus.tfidf();
  const vectors = Array.from(matrix.entries()).map(([id, weights]) => ({ id, weights }));
  state.clusters = vectors.length ? kmeans(vectors, Math.min(4, vectors.length)) : [];
  const graph = buildEntityActionGraph(
    state.ocrDocuments.map((entry) => ({ type: entry.type ?? 'ocr', text: entry.text })),
  );
  const processes = state.miner.extractProcesses();
  state.processes = processes;
  state.automation = scoreAutomation(processes, graph).sort((a, b) => b.score - a.score);
}

async function persistSession() {
  await chrome.storage.session.set({
    events: state.events,
    observations: state.observations,
    fusedEvents: state.fusedEvents,
    scribe: state.notes,
    processes: state.processes,
    automation: state.automation,
  });
}

async function recordEvent(event) {
  state.fusion.ingest(event);
  const newEvents = registerFusedEvents(event.t ?? Date.now());
  if (newEvents.length) {
    updateTrace(newEvents);
    updateScribe(newEvents);
    addEventDocuments(newEvents);
    updateDomainArtifacts();
  }
  await persistSession();
}

async function handleOcrResults(payload) {
  if (!Array.isArray(payload?.results)) {
    return;
  }
  for (const result of payload.results) {
    await pushEvent({
      type: 'ocr',
      text: result.text,
      normalized: result.normalized,
      region: result.region,
      confidence: result.confidence ?? null,
      t: normalizeTimestamp(result.t),
      source: 'ocr',
    });
  }
}

function buildProcessDefinition(process) {
  if (!process) {
    return null;
  }
  return {
    id: `process-${hashProcess(process)}`,
    name: state.tabTitle ? `Captured Workflow — ${state.tabTitle}` : 'Captured Workflow',
    steps: process.steps.map((step, index) => ({
      title: step,
      description: `Automatically observed step ${index + 1}.`,
      notes: `Support: ${process.support}. Average duration: ${Math.round(process.averageDuration ?? 0)} ms.`,
      actors: [],
      inputs: [],
      outputs: [],
      systems: [],
    })),
  };
}

async function buildExportBundle() {
  const exporter = new ZipExporter();
  const primaryProcess = state.processes[0] ?? null;
  const processDefinition = buildProcessDefinition(primaryProcess);
  if (processDefinition) {
    exporter.addFile('sop.md', buildMarkdown(processDefinition));
    exporter.addFile('sop.yaml', buildYaml(processDefinition));
    exporter.addFile('sop.bpmn.xml', buildBpmn(processDefinition));
  }
  exporter.addFile('notes.txt', state.notes || 'No session notes generated yet.');
  exporter.addFile('session.json', {
    tabTitle: state.tabTitle,
    events: state.events,
    observations: state.observations,
    fusedEvents: state.fusedEvents,
    processes: state.processes,
    automation: state.automation,
  });
  return exporter.finalize({ type: 'base64' });
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (
    message?.type === 'OFFSCREEN_START' ||
    message?.type === 'OFFSCREEN_STOP' ||
    message?.type === 'OFFSCREEN_UPDATE_MASKS' ||
    message?.type === 'OFFSCREEN_UPDATE_PREFS'
  ) {
    return false;
  }
  (async () => {
    switch (message?.type) {
      case 'POPUP_GET_STATE':
        await ensurePrefsLoaded();
        sendResponse(getPopupState());
        return;
      case 'POPUP_START_CAPTURE':
        sendResponse(await startCapture(message.payload));
        return;
      case 'POPUP_STOP_CAPTURE':
        sendResponse(await stopCapture());
        return;
      case 'POPUP_EXPORT_SNAPSHOT': {
        updateDomainArtifacts();
        await persistSession();
        const archive = await buildExportBundle();
        sendResponse({ ok: true, archive });
        return;
      }
      case 'POPUP_UPDATE_PREFS':
        await ensurePrefsLoaded();
        state.hudEnabled =
          message.payload?.hudEnabled ?? state.hudEnabled;
        state.redactEnabled =
          message.payload?.redactEnabled ?? state.redactEnabled;
        await applyGlobalPrefs({
          hudEnabled: state.hudEnabled,
          redactEnabled: state.redactEnabled,
        });
        if (state.active && state.tabId !== null) {
          await chrome.tabs.sendMessage(state.tabId, {
            type: 'CONTENT_UPDATE_PREFS',
            payload: { hudEnabled: state.hudEnabled, redactEnabled: state.redactEnabled },
          });
          await chrome.runtime.sendMessage({
            type: 'OFFSCREEN_UPDATE_PREFS',
            payload: { masks: state.masks },
          });
        }
        sendResponse(getPopupState());
        return;
      case 'CONTENT_READY':
        logger.info('onMessage', 'content', 'Content script acknowledged start');
        sendResponse({ ok: true });
        return;
      case 'CONTENT_REQUEST_STOP':
        sendResponse(await stopCapture());
        return;
      case 'CONTENT_REDACT_MODE':
        state.redactEnabled = Boolean(message.payload?.enabled);
        if (state.active && state.tabId !== null) {
          await chrome.runtime.sendMessage({
            type: 'OFFSCREEN_UPDATE_MASKS',
            payload: { masks: state.masks },
          });
        }
        sendResponse(getPopupState());
        return;
      case 'CONTENT_UPDATE_REDACTIONS':
        state.masks = sanitizeMasks(message.payload?.masks);
        state.masks = await applyMaskPersistence(state.origin, state.masks);
        if (state.active) {
          await chrome.runtime.sendMessage({
            type: 'OFFSCREEN_UPDATE_MASKS',
            payload: { masks: state.masks },
          });
        }
        sendResponse({ ok: true });
        return;
      case 'DOM_EVENT':
        await pushEvent({ ...message.payload, source: 'dom' });
        sendResponse({ ok: true });
        return;
      case 'OFFSCREEN_OBSERVATION':
        await pushObservation(message.payload);
        sendResponse({ ok: true });
        return;
      case 'OFFSCREEN_OCR_RESULTS':
        await handleOcrResults(message.payload);
        sendResponse({ ok: true });
        return;
      default:
        logger.warn('onMessage', 'routing', `Unhandled message type: ${message?.type}`);
        sendResponse({ ok: false });
        return;
    }
  })().catch((error) => {
    logger.error('onMessage', 'routing', 'Message handling failure', { error });
    sendResponse({ ok: false, error: String(error) });
  });
  return true;
});

chrome.runtime.onInstalled.addListener(() => {
  state.events = [];
  state.observations = [];
  chrome.storage.session.clear().catch((error) => {
    logger.error('onInstalled', 'storage', 'Failed to clear session storage', { error });
  });
});

chrome.runtime.onSuspend.addListener(() => {
  logger.info('onSuspend', 'lifecycle', 'Service worker suspended');
});

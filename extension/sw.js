import { createLogger } from './lib/logger.js';
import { installEgressGuard } from './lib/egressGuard.js';
import {
  getGlobalPrefs,
  getOriginPrefs,
  saveOriginMasks,
  setOriginConsent,
  updateGlobalPrefs,
} from './lib/preferences.js';

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
};

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
  state.events.push(event);
  if (state.events.length > EVENT_BUFFER_LIMIT) {
    state.events.splice(0, state.events.length - EVENT_BUFFER_LIMIT);
  }
  await chrome.storage.session.set({ events: state.events });
}

async function pushObservation(observation) {
  state.observations.push(observation);
  if (state.observations.length > EVENT_BUFFER_LIMIT) {
    state.observations.splice(0, state.observations.length - EVENT_BUFFER_LIMIT);
  }
  await chrome.storage.session.set({ observations: state.observations });
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

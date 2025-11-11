import { AdaptiveFrameScheduler } from './lib/adaptiveCadence.js';
import { createLogger } from './lib/logger.js';
import { installEgressGuard } from './lib/egressGuard.js';

installEgressGuard(globalThis);

const logger = createLogger('extension/offscreen.js', 'Offscreen');

const state = {
  active: false,
  frameId: 0,
  masks: [],
  scheduler: new AdaptiveFrameScheduler(),
  sampleTimer: null,
  stream: null,
  video: null,
  canvas: null,
  ctx: null,
  lastFrame: null,
};

async function startCapture(payload) {
  if (state.active) {
    logger.warn('startCapture', 'lifecycle', 'Offscreen capture already active');
    return;
  }
  try {
    state.stream = await chrome.tabCapture.capture({
      audio: false,
      video: true,
    });
    if (!state.stream) {
      throw new Error('Tab capture stream unavailable');
    }
    state.video = document.createElement('video');
    state.video.srcObject = state.stream;
    state.video.muted = true;
    await state.video.play();
    const { videoWidth, videoHeight } = state.video;
    const width = videoWidth || 1280;
    const height = videoHeight || 720;
    state.canvas = new OffscreenCanvas(width, height);
    state.ctx = state.canvas.getContext('2d');
    state.masks = sanitizeMasks(payload?.masks);
    state.frameId = 0;
    state.lastFrame = null;
    state.active = true;
    resetScheduler();
    scheduleNextSample(0);
    logger.info('startCapture', 'lifecycle', 'Offscreen capture initialized');
    const [track] = state.stream.getVideoTracks();
    if (track) {
      track.addEventListener('ended', () => {
        logger.warn('startCapture', 'stream', 'Video track ended unexpectedly');
        stopCapture();
      });
    }
  } catch (error) {
    logger.error('startCapture', 'lifecycle', 'Failed to start tab capture', { error });
    await stopCapture();
  }
}

async function stopCapture() {
  if (!state.active) {
    return;
  }
  state.active = false;
  if (state.sampleTimer) {
    clearTimeout(state.sampleTimer);
    state.sampleTimer = null;
  }
  if (state.stream) {
    for (const track of state.stream.getTracks()) {
      track.stop();
    }
    state.stream = null;
  }
  if (state.video) {
    state.video.srcObject = null;
    state.video = null;
  }
  state.canvas = null;
  state.ctx = null;
  state.lastFrame = null;
  resetScheduler();
  logger.info('stopCapture', 'lifecycle', 'Offscreen capture stopped');
}

function resetScheduler() {
  state.scheduler = new AdaptiveFrameScheduler();
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

function scheduleNextSample(delay) {
  if (!state.active) return;
  const interval = Math.max(0, delay ?? state.scheduler.currentInterval());
  state.sampleTimer = setTimeout(sampleFrame, interval);
}

function applyRedactions() {
  if (!state.ctx || !state.canvas || state.masks.length === 0) return;
  const width = state.canvas.width;
  const height = state.canvas.height;
  state.ctx.save();
  state.ctx.fillStyle = 'rgba(4, 6, 12, 0.95)';
  for (const mask of state.masks) {
    const x = mask.x * width;
    const y = mask.y * height;
    const w = mask.width * width;
    const h = mask.height * height;
    state.ctx.fillRect(x, y, w, h);
  }
  state.ctx.restore();
}

function calculateDelta(current, previous) {
  if (!previous || previous.length !== current.length) {
    return 1;
  }
  let total = 0;
  const length = current.length;
  for (let i = 0; i < length; i += 4) {
    const dr = Math.abs(current[i] - previous[i]);
    const dg = Math.abs(current[i + 1] - previous[i + 1]);
    const db = Math.abs(current[i + 2] - previous[i + 2]);
    total += dr + dg + db;
  }
  const maxPossible = (length / 4) * 3 * 255;
  return Math.min(total / maxPossible, 1);
}

async function sampleFrame() {
  if (!state.active || !state.ctx || !state.video) {
    return;
  }
  try {
    state.ctx.drawImage(state.video, 0, 0, state.canvas.width, state.canvas.height);
    applyRedactions();
    const imageData = state.ctx.getImageData(0, 0, state.canvas.width, state.canvas.height);
    const current = imageData.data;
    const delta = calculateDelta(current, state.lastFrame);
    state.lastFrame = new Uint8ClampedArray(current);
    const interval = state.scheduler.registerDelta(delta);
    const observation = {
      t: Date.now() / 1000,
      frameId: state.frameId++,
      capture: {
        delta,
        interval,
        width: state.canvas.width,
        height: state.canvas.height,
      },
      redactions: state.masks.length,
      signals: {
        motion: delta,
      },
    };
    await chrome.runtime.sendMessage({ type: 'OFFSCREEN_OBSERVATION', payload: observation });
    scheduleNextSample(interval);
  } catch (error) {
    logger.error('sampleFrame', 'capture', 'Failed to process frame', { error });
    scheduleNextSample(state.scheduler.currentInterval());
  }
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  (async () => {
    switch (message?.type) {
      case 'OFFSCREEN_START':
        await startCapture(message.payload);
        sendResponse({ ok: true });
        return;
      case 'OFFSCREEN_STOP':
        await stopCapture();
        sendResponse({ ok: true });
        return;
      case 'OFFSCREEN_UPDATE_MASKS':
        state.masks = sanitizeMasks(message.payload?.masks);
        sendResponse({ ok: true });
        return;
      case 'OFFSCREEN_UPDATE_PREFS':
        state.masks = sanitizeMasks(message.payload?.masks);
        sendResponse({ ok: true });
        return;
      default:
        logger.warn('onMessage', 'routing', `Unhandled offscreen message: ${message?.type}`);
        sendResponse({ ok: false });
        return;
    }
  })().catch((error) => {
    logger.error('onMessage', 'routing', 'Offscreen message handling failed', { error });
    sendResponse({ ok: false, error: String(error) });
  });
  return true;
});

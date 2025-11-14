import { AdaptiveFrameScheduler } from './lib/adaptiveCadence.js';
import { createLogger } from './lib/logger.js';
import { installEgressGuard } from './lib/egressGuard.js';
import { VisionClassifier } from './lib/visionClassifier.js';
import { OcrEngine } from './lib/ocrEngine.js';

installEgressGuard(globalThis);

const logger = createLogger('extension/offscreen.js', 'Offscreen');
const visionClassifier = new VisionClassifier();
const ocrEngine = new OcrEngine({ dedupeWindowMs: 45000 });

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
    clearAnalyzers();
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
  clearAnalyzers();
  resetScheduler();
  await ocrEngine.dispose();
  logger.info('stopCapture', 'lifecycle', 'Offscreen capture stopped');
}

function resetScheduler() {
  state.scheduler = new AdaptiveFrameScheduler();
}

function clearAnalyzers() {
  state.lastFrame = null;
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

function maskOverlaps(region) {
  for (const mask of state.masks) {
    const overlapX = Math.max(0, Math.min(region.x + region.width, mask.x + mask.width) - Math.max(region.x, mask.x));
    const overlapY = Math.max(0, Math.min(region.y + region.height, mask.y + mask.height) - Math.max(region.y, mask.y));
    if (overlapX * overlapY > 0.6 * region.width * region.height) {
      return true;
    }
  }
  return false;
}

function detectRegions(imageData) {
  const { width, height, data } = imageData;
  const regions = [];
  const grid = 4;
  const tileWidth = Math.max(1, Math.floor(width / grid));
  const tileHeight = Math.max(1, Math.floor(height / grid));
  for (let gy = 0; gy < grid; gy += 1) {
    for (let gx = 0; gx < grid; gx += 1) {
      const startX = gx * tileWidth;
      const startY = gy * tileHeight;
      const regionWidth = gx === grid - 1 ? width - startX : tileWidth;
      const regionHeight = gy === grid - 1 ? height - startY : tileHeight;
      const stats = analyzeRegion(data, width, startX, startY, regionWidth, regionHeight);
      if (stats.contrast < 18 || stats.texture < 12) continue;
      const normalized = {
        x: startX / width,
        y: startY / height,
        width: regionWidth / width,
        height: regionHeight / height,
        score: stats.contrast + stats.texture,
      };
      if (!maskOverlaps(normalized)) {
        regions.push(normalized);
      }
    }
  }
  regions.sort((a, b) => b.score - a.score);
  return regions.slice(0, 6);
}

function analyzeRegion(data, width, startX, startY, regionWidth, regionHeight) {
  let contrast = 0;
  let texture = 0;
  const stride = width * 4;
  for (let y = 0; y < regionHeight; y += 1) {
    for (let x = 0; x < regionWidth; x += 1) {
      const index = (startY + y) * stride + (startX + x) * 4;
      const r = data[index];
      const g = data[index + 1];
      const b = data[index + 2];
      const luma = 0.2126 * r + 0.7152 * g + 0.0722 * b;
      if (x + 1 < regionWidth) {
        const right = (startY + y) * stride + (startX + x + 1) * 4;
        const diff = Math.abs(luma - (0.2126 * data[right] + 0.7152 * data[right + 1] + 0.0722 * data[right + 2]));
        contrast += diff;
      }
      if (y + 1 < regionHeight) {
        const bottom = (startY + y + 1) * stride + (startX + x) * 4;
        const diff = Math.abs(luma - (0.2126 * data[bottom] + 0.7152 * data[bottom + 1] + 0.0722 * data[bottom + 2]));
        contrast += diff;
      }
      const diff = Math.max(r, g, b) - Math.min(r, g, b);
      if (diff > 60) {
        texture += 1;
      }
    }
  }
  const area = regionWidth * regionHeight || 1;
  return {
    contrast: contrast / area,
    texture: (texture / area) * 100,
  };
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
    const vision = visionClassifier.classify(imageData);
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
      vision,
    };
    await chrome.runtime.sendMessage({ type: 'OFFSCREEN_OBSERVATION', payload: observation });
    const regions = detectRegions(imageData);
    if (regions.length) {
      const results = await ocrEngine.recognizeRegions(imageData, regions);
      if (results.length) {
        await chrome.runtime.sendMessage({
          type: 'OFFSCREEN_OCR_RESULTS',
          payload: {
            frameId: observation.frameId,
            results: results.map((result) => ({ ...result, t: observation.t })),
          },
        });
      }
    }
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

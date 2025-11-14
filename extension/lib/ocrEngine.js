import { createLogger } from './logger.js';

const logger = createLogger('extension/lib/ocrEngine.js', 'OcrEngine');

function defaultNormalizer(text) {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

async function createTesseractWorker(languages) {
  try {
    const { createWorker } = await import('tesseract.js');
    const worker = await createWorker(languages.join('+'));
    return worker;
  } catch (error) {
    logger.warn('createTesseractWorker', 'ocr', 'Falling back to heuristic OCR', { error });
    return null;
  }
}

export class OcrEngine {
  constructor(options = {}) {
    this.languages = Array.isArray(options.languages) && options.languages.length > 0
      ? options.languages
      : ['eng'];
    this.normalizer = options.normalizer ?? defaultNormalizer;
    this.dedupeWindowMs = options.dedupeWindowMs ?? 15000;
    this.activeRecognitions = new Set();
    this.cache = new Map();
    this.workerPromise = null;
    this.heuristicRecognizer = options.heuristicRecognizer ?? ((region) => this.#heuristicRecognize(region));
    this.useWorker = options.useWorker !== false;
  }

  async #getWorker() {
    if (!this.useWorker) {
      return null;
    }
    if (this.workerPromise !== null) {
      return this.workerPromise;
    }
    this.workerPromise = createTesseractWorker(this.languages);
    return this.workerPromise;
  }

  #makeRegionId(region) {
    const { x, y, width, height } = region;
    return [x, y, width, height]
      .map((value) => Number.parseFloat(value ?? 0).toFixed(4))
      .join(':');
  }

  #storeResult(result) {
    const key = this.normalizer(result.text);
    if (!key) {
      return false;
    }
    const now = Date.now();
    const existing = this.cache.get(key);
    if (existing && now - existing.timestamp < this.dedupeWindowMs) {
      return false;
    }
    this.cache.set(key, { timestamp: now, result });
    for (const [cachedKey, value] of this.cache.entries()) {
      if (now - value.timestamp > this.dedupeWindowMs) {
        this.cache.delete(cachedKey);
      }
    }
    return true;
  }

  async #recognizeWithWorker(imageData) {
    try {
      const worker = await this.#getWorker();
      if (!worker) {
        return null;
      }
      const { data } = await worker.recognize(imageData);
      if (data?.text) {
        return data.text;
      }
      return null;
    } catch (error) {
      logger.error('recognizeWithWorker', 'ocr', 'Worker recognition failed', { error });
      return null;
    }
  }

  #heuristicRecognize(region) {
    if (!region?.imageData) {
      return null;
    }
    const { data } = region.imageData;
    let highContrast = 0;
    let darkPixels = 0;
    for (let i = 0; i < data.length; i += 4) {
      const r = data[i];
      const g = data[i + 1];
      const b = data[i + 2];
      const luma = 0.2126 * r + 0.7152 * g + 0.0722 * b;
      if (luma < 96) {
        darkPixels += 1;
      }
      const diff = Math.max(r, g, b) - Math.min(r, g, b);
      if (diff > 80) {
        highContrast += 1;
      }
    }
    if (highContrast === 0) {
      return null;
    }
    const score = (highContrast / (data.length / 4)) * 100;
    if (score < 5) {
      return null;
    }
    if (darkPixels / (data.length / 4) > 0.5) {
      return 'sensitive field';
    }
    if (score > 25) {
      return 'button';
    }
    return 'text block';
  }

  async recognizeRegions(imageData, regions = []) {
    if (!imageData || typeof imageData !== 'object') {
      throw new TypeError('Image data is required for OCR');
    }
    const results = [];
    for (const region of regions) {
      const clipped = this.#clipRegion(imageData, region);
      if (!clipped) {
        continue;
      }
      const regionId = this.#makeRegionId(region);
      if (this.activeRecognitions.has(regionId)) {
        continue;
      }
      this.activeRecognitions.add(regionId);
      try {
        const text = await this.#recognize(clipped);
        if (!text) {
          continue;
        }
        const normalized = this.normalizer(text);
        if (!normalized) {
          continue;
        }
        const entry = {
          id: regionId,
          text: text.trim(),
          normalized,
          region: {
            x: region.x,
            y: region.y,
            width: region.width,
            height: region.height,
          },
        };
        if (this.#storeResult(entry)) {
          results.push(entry);
        }
      } finally {
        this.activeRecognitions.delete(regionId);
      }
    }
    return results;
  }

  async #recognize(region) {
    const workerText = await this.#recognizeWithWorker(region.imageData);
    if (workerText) {
      return workerText;
    }
    return this.heuristicRecognizer(region);
  }

  #clipRegion(imageData, region) {
    if (!region || typeof region !== 'object') {
      return null;
    }
    const { width, height, data } = imageData;
    const rx = Math.max(0, Math.min(1, Number(region.x ?? 0)));
    const ry = Math.max(0, Math.min(1, Number(region.y ?? 0)));
    const rw = Math.max(0, Math.min(1, Number(region.width ?? 0)));
    const rh = Math.max(0, Math.min(1, Number(region.height ?? 0)));
    if (rw <= 0 || rh <= 0) {
      return null;
    }
    const startX = Math.floor(rx * width);
    const startY = Math.floor(ry * height);
    const clipWidth = Math.max(1, Math.floor(rw * width));
    const clipHeight = Math.max(1, Math.floor(rh * height));
    const clipped = new Uint8ClampedArray(clipWidth * clipHeight * 4);
    const rowStride = width * 4;
    for (let y = 0; y < clipHeight; y += 1) {
      const sourceIndex = (startY + y) * rowStride + startX * 4;
      const targetIndex = y * clipWidth * 4;
      clipped.set(data.subarray(sourceIndex, sourceIndex + clipWidth * 4), targetIndex);
    }
    return {
      imageData: {
        width: clipWidth,
        height: clipHeight,
        data: clipped,
      },
      x: rx,
      y: ry,
      width: rw,
      height: rh,
    };
  }

  async dispose() {
    if (!this.workerPromise) {
      return;
    }
    try {
      const worker = await this.workerPromise;
      await worker?.terminate?.();
    } catch (error) {
      logger.warn('dispose', 'ocr', 'Failed to terminate worker', { error });
    }
    this.workerPromise = null;
  }
}


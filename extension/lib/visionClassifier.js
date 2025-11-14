const DEFAULT_PROTOTYPES = [
  {
    label: 'form',
    vector: [90, 35, 42, 180],
  },
  {
    label: 'dashboard',
    vector: [170, 85, 160, 70],
  },
  {
    label: 'documentation',
    vector: [210, 45, 120, 40],
  },
  {
    label: 'media',
    vector: [110, 120, 90, 110],
  },
];

function ensureImageData(imageData) {
  if (!imageData || typeof imageData !== 'object') {
    throw new TypeError('ImageData is required');
  }
  const { data, width, height } = imageData;
  if (!data || typeof width !== 'number' || typeof height !== 'number') {
    throw new TypeError('Invalid ImageData provided');
  }
  if (width <= 0 || height <= 0) {
    throw new RangeError('ImageData width and height must be greater than zero');
  }
}

function computeFeatures(imageData) {
  ensureImageData(imageData);
  const { data, width, height } = imageData;
  const length = data.length;
  let totalLuma = 0;
  let totalSaturation = 0;
  let gradientSum = 0;
  let contrastSum = 0;
  let contrastCount = 0;

  const rowStride = width * 4;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const index = y * rowStride + x * 4;
      const r = data[index];
      const g = data[index + 1];
      const b = data[index + 2];

      const max = Math.max(r, g, b);
      const min = Math.min(r, g, b);
      const luma = 0.2126 * r + 0.7152 * g + 0.0722 * b;
      totalLuma += luma;
      const saturation = max === 0 ? 0 : ((max - min) / max) * 255;
      totalSaturation += saturation;

      const rightIndex = index + 4;
      const bottomIndex = index + rowStride;
      if (x + 1 < width) {
        const dr = data[rightIndex] - r;
        const dg = data[rightIndex + 1] - g;
        const db = data[rightIndex + 2] - b;
        gradientSum += Math.abs(dr) + Math.abs(dg) + Math.abs(db);
      }
      if (y + 1 < height) {
        const dr = data[bottomIndex] - r;
        const dg = data[bottomIndex + 1] - g;
        const db = data[bottomIndex + 2] - b;
        gradientSum += Math.abs(dr) + Math.abs(dg) + Math.abs(db);
      }

      if (x + 1 < width && y + 1 < height) {
        const diagIndex = bottomIndex + 4;
        const diagLuma =
          0.2126 * data[diagIndex] + 0.7152 * data[diagIndex + 1] + 0.0722 * data[diagIndex + 2];
        contrastSum += Math.abs(luma - diagLuma);
        contrastCount += 1;
      }
    }
  }

  const pixelCount = width * height;
  const averageLuma = pixelCount ? totalLuma / pixelCount : 0;
  const averageSaturation = pixelCount ? totalSaturation / pixelCount : 0;
  const gradientDensity = length ? (gradientSum / length) * 4 : 0;
  const contrast = contrastCount ? contrastSum / contrastCount : 0;

  return {
    brightness: averageLuma,
    saturation: averageSaturation,
    edgeDensity: gradientDensity,
    contrast,
  };
}

function quantizeFeature(value) {
  if (typeof value !== 'number' || Number.isNaN(value)) {
    return 0;
  }
  return Math.max(0, Math.min(255, Math.round(value)));
}

function toVector(features) {
  return [
    quantizeFeature(features.brightness),
    quantizeFeature(features.saturation),
    quantizeFeature(features.edgeDensity),
    quantizeFeature(features.contrast),
  ];
}

function cosineSimilarity(a, b) {
  let dot = 0;
  let magA = 0;
  let magB = 0;
  for (let i = 0; i < a.length; i += 1) {
    dot += a[i] * b[i];
    magA += a[i] * a[i];
    magB += b[i] * b[i];
  }
  if (magA === 0 || magB === 0) {
    return 0;
  }
  return dot / (Math.sqrt(magA) * Math.sqrt(magB));
}

export class VisionClassifier {
  constructor(options = {}) {
    const prototypes = Array.isArray(options.prototypes) && options.prototypes.length > 0
      ? options.prototypes
      : DEFAULT_PROTOTYPES;
    this.prototypes = prototypes.map((prototype) => ({
      label: prototype.label,
      vector: Array.from(prototype.vector ?? []),
    }));
  }

  classify(imageData) {
    const features = computeFeatures(imageData);
    const vector = toVector(features);
    let best = null;
    for (const prototype of this.prototypes) {
      const similarity = cosineSimilarity(vector, prototype.vector);
      if (!best || similarity > best.similarity) {
        best = { ...prototype, similarity };
      }
    }
    return {
      label: best ? best.label : 'unknown',
      confidence: best ? Number(best.similarity.toFixed(3)) : 0,
      features,
      vector,
    };
  }

  updatePrototype(label, vector) {
    if (!label) {
      throw new TypeError('label is required');
    }
    const quantized = Array.isArray(vector) ? vector.map(quantizeFeature) : null;
    if (!quantized || quantized.length !== 4) {
      throw new TypeError('vector must be an array of four numeric values');
    }
    const index = this.prototypes.findIndex((prototype) => prototype.label === label);
    if (index >= 0) {
      this.prototypes[index] = { label, vector: quantized };
    } else {
      this.prototypes.push({ label, vector: quantized });
    }
  }
}

export function extractFeatureVector(imageData) {
  return toVector(computeFeatures(imageData));
}

export function buildPrototype(label, imageData) {
  return {
    label,
    vector: extractFeatureVector(imageData),
  };
}


import test from 'node:test';
import assert from 'node:assert/strict';

import { VisionClassifier, buildPrototype } from '../extension/lib/visionClassifier.js';
import { OcrEngine } from '../extension/lib/ocrEngine.js';

function createImageData(width, height, pixelFactory) {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const index = (y * width + x) * 4;
      const [r, g, b] = pixelFactory(x, y);
      data[index] = r;
      data[index + 1] = g;
      data[index + 2] = b;
      data[index + 3] = 255;
    }
  }
  return { width, height, data };
}

test('VisionClassifier identifies bright dashboard-like frames', () => {
  const classifier = new VisionClassifier();
  const bright = createImageData(8, 8, () => [200, 220, 240]);
  const result = classifier.classify(bright);
  assert.ok(result.label, 'classification should produce a label');
  assert.ok(result.confidence > 0.2, 'confidence should be above threshold');
});

test('VisionClassifier can learn custom prototype', () => {
  const darkForm = createImageData(4, 4, (x, y) => (x < 2 && y < 2 ? [20, 20, 20] : [40, 40, 40]));
  const prototype = buildPrototype('secure-form', darkForm);
  const classifier = new VisionClassifier({ prototypes: [prototype] });
  const result = classifier.classify(darkForm);
  assert.equal(result.label, 'secure-form');
});

test('OcrEngine deduplicates repeated regions using heuristic recognizer', async () => {
  const engine = new OcrEngine({
    dedupeWindowMs: 60000,
    heuristicRecognizer: () => 'Submit',
    useWorker: false,
  });
  const imageData = createImageData(6, 6, () => [120, 120, 120]);
  const regions = [
    { x: 0, y: 0, width: 0.5, height: 0.5 },
    { x: 0.1, y: 0.1, width: 0.5, height: 0.5 },
  ];
  const first = await engine.recognizeRegions(imageData, regions);
  assert.equal(first.length, 1);
  const second = await engine.recognizeRegions(imageData, regions);
  assert.equal(second.length, 0, 'duplicate region should be skipped within dedupe window');
  await engine.dispose();
});

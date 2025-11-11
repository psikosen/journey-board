import test from 'node:test';
import assert from 'node:assert/strict';

import { AdaptiveFrameScheduler } from '../extension/lib/adaptiveCadence.js';

test('AdaptiveFrameScheduler decreases interval when motion increases', () => {
  const scheduler = new AdaptiveFrameScheduler({ baselineInterval: 5000, minInterval: 2000 });
  const first = scheduler.registerDelta(0.9);
  assert.ok(first < 5000, `interval should drop on high motion, received ${first}`);
  const second = scheduler.registerDelta(0.95);
  assert.ok(second < first, `interval should continue to decrease with sustained motion, received ${second}`);
  const third = scheduler.registerDelta(0.99);
  assert.ok(third < 3300, `interval should approach the minimum over time, received ${third}`);
});

test('AdaptiveFrameScheduler increases interval when idle', () => {
  const scheduler = new AdaptiveFrameScheduler({ baselineInterval: 5000, maxInterval: 15000, idleThreshold: 0.05 });
  scheduler.registerDelta(0.01);
  const interval = scheduler.registerDelta(0.0);
  assert.ok(interval >= 9000, `interval should increase during idle periods, received ${interval}`);
});

test('AdaptiveFrameScheduler clamps invalid input', () => {
  const scheduler = new AdaptiveFrameScheduler();
  const interval = scheduler.registerDelta(-5);
  assert.equal(interval, scheduler.currentInterval());
});

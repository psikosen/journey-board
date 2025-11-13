import test from 'node:test';
import assert from 'node:assert/strict';

import {
  getGlobalPrefs,
  updateGlobalPrefs,
  getOriginPrefs,
  saveOriginMasks,
  setOriginConsent,
  sanitizeMaskList,
} from '../extension/lib/preferences.js';

const memoryStore = {};

function resetChromeStorage() {
  memoryStore.value = undefined;
  globalThis.chrome = {
    storage: {
      local: {
        async get(key) {
          if (typeof key === 'string') {
            return { [key]: memoryStore.value };
          }
          return {};
        },
        async set(map) {
          if (map && typeof map === 'object') {
            if ('sop-agent:preferences' in map) {
              memoryStore.value = map['sop-agent:preferences'];
            }
          }
        },
      },
    },
  };
}

test('preferences module provides defaults when storage empty', async () => {
  resetChromeStorage();
  const prefs = await getGlobalPrefs();
  assert.deepEqual(prefs, { hudEnabled: true, redactEnabled: false });
});

test('updateGlobalPrefs merges and persists booleans', async () => {
  resetChromeStorage();
  const updated = await updateGlobalPrefs({ hudEnabled: false });
  assert.equal(updated.hudEnabled, false);
  assert.equal(updated.redactEnabled, false);
  const roundTrip = await getGlobalPrefs();
  assert.deepEqual(roundTrip, { hudEnabled: false, redactEnabled: false });
});

test('origin preferences track consent and masks', async () => {
  resetChromeStorage();
  const origin = 'https://example.com';
  const defaults = await getOriginPrefs(origin);
  assert.equal(defaults.consent.granted, false);
  assert.equal(defaults.masks.length, 0);
  const consent = await setOriginConsent(origin, true);
  assert.equal(consent.granted, true);
  const masks = await saveOriginMasks(origin, [
    { x: 0.1, y: 0.2, width: 0.3, height: 0.4 },
    { x: -10, y: 0.5, width: 0.1, height: 0.2 },
  ]);
  assert.equal(masks.length, 2);
  assert.equal(masks[0].x, 0.1);
  assert.equal(masks[1].x, 0);
  const roundTrip = await getOriginPrefs(origin);
  assert.equal(roundTrip.consent.granted, true);
  assert.equal(roundTrip.masks.length, 2);
});

test('sanitizeMaskList removes invalid entries', () => {
  const sanitized = sanitizeMaskList([
    { x: 0, y: 0, width: 0, height: 0 },
    { x: 0.1, y: 0.1, width: 0.2, height: 0.2 },
    { x: 'bad', y: 0.5, width: 1.5, height: 2 },
  ]);
  assert.equal(sanitized.length, 2);
  assert.deepEqual(sanitized[0], { x: 0.1, y: 0.1, width: 0.2, height: 0.2 });
  assert.deepEqual(sanitized[1], { x: 0, y: 0.5, width: 1, height: 1 });
});

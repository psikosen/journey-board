const STORAGE_KEY = 'sop-agent:preferences';

const DEFAULT_GLOBAL_PREFS = {
  hudEnabled: true,
  redactEnabled: false,
};

const DEFAULT_ORIGIN_PREFS = {
  consent: {
    granted: false,
    timestamp: null,
  },
  masks: [],
};

function clamp(value, min, max) {
  if (typeof value !== 'number' || Number.isNaN(value)) {
    return min;
  }
  return Math.min(Math.max(value, min), max);
}

function sanitizeMasks(masks) {
  if (!Array.isArray(masks)) {
    return [];
  }
  return masks
    .map((mask) => ({
      x: clamp(mask.x, 0, 1),
      y: clamp(mask.y, 0, 1),
      width: clamp(mask.width, 0, 1),
      height: clamp(mask.height, 0, 1),
    }))
    .filter((mask) => mask.width > 0 && mask.height > 0);
}

function getStorage() {
  const storage = globalThis.chrome?.storage?.local;
  if (!storage) {
    throw new Error('chrome.storage.local is unavailable');
  }
  return storage;
}

async function readStore() {
  const storage = getStorage();
  const result = await storage.get(STORAGE_KEY);
  const stored = result?.[STORAGE_KEY];
  if (!stored || typeof stored !== 'object') {
    return {
      global: { ...DEFAULT_GLOBAL_PREFS },
      origins: {},
    };
  }
  const globalPrefs = {
    ...DEFAULT_GLOBAL_PREFS,
    ...(typeof stored.global === 'object' ? stored.global : {}),
  };
  const origins = { ...(stored.origins ?? {}) };
  return { global: normalizeGlobalPrefs(globalPrefs), origins };
}

async function writeStore(store) {
  const storage = getStorage();
  await storage.set({ [STORAGE_KEY]: store });
}

function normalizeGlobalPrefs(prefs) {
  return {
    hudEnabled: Boolean(prefs?.hudEnabled),
    redactEnabled: Boolean(prefs?.redactEnabled),
  };
}

function normalizeOriginPrefs(prefs) {
  if (!prefs || typeof prefs !== 'object') {
    return {
      consent: { ...DEFAULT_ORIGIN_PREFS.consent },
      masks: [],
    };
  }
  const consent = prefs.consent ?? DEFAULT_ORIGIN_PREFS.consent;
  return {
    consent: {
      granted: Boolean(consent?.granted),
      timestamp: consent?.timestamp ?? null,
    },
    masks: sanitizeMasks(prefs.masks),
  };
}

export async function getGlobalPrefs() {
  const store = await readStore();
  return normalizeGlobalPrefs(store.global);
}

export async function updateGlobalPrefs(patch) {
  const store = await readStore();
  const next = normalizeGlobalPrefs({ ...store.global, ...patch });
  const updated = { ...store, global: next };
  await writeStore(updated);
  return next;
}

export async function getOriginPrefs(origin) {
  if (!origin) {
    return normalizeOriginPrefs(DEFAULT_ORIGIN_PREFS);
  }
  const store = await readStore();
  return normalizeOriginPrefs(store.origins?.[origin]);
}

export async function saveOriginMasks(origin, masks) {
  if (!origin) {
    return [];
  }
  const store = await readStore();
  const originPrefs = normalizeOriginPrefs(store.origins?.[origin]);
  const sanitized = sanitizeMasks(masks);
  const updated = {
    ...store,
    origins: {
      ...store.origins,
      [origin]: {
        ...originPrefs,
        masks: sanitized,
      },
    },
  };
  await writeStore(updated);
  return sanitized;
}

export async function setOriginConsent(origin, granted) {
  if (!origin) {
    return { granted: Boolean(granted), timestamp: Date.now() };
  }
  const store = await readStore();
  const originPrefs = normalizeOriginPrefs(store.origins?.[origin]);
  const consent = {
    granted: Boolean(granted),
    timestamp: Date.now(),
  };
  const updated = {
    ...store,
    origins: {
      ...store.origins,
      [origin]: {
        ...originPrefs,
        consent,
      },
    },
  };
  await writeStore(updated);
  return consent;
}

export function sanitizeMaskList(masks) {
  return sanitizeMasks(masks);
}


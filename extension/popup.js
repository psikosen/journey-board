import { createLogger } from './lib/logger.js';

const logger = createLogger('extension/popup.js', 'Popup');

const startBtn = document.getElementById('start');
const stopBtn = document.getElementById('stop');
const statusEl = document.getElementById('status');
const hudToggle = document.getElementById('hudToggle');
const redactToggle = document.getElementById('redactToggle');

async function refreshState() {
  const state = await chrome.runtime.sendMessage({ type: 'POPUP_GET_STATE' });
  applyState(state);
}

function applyState(state) {
  const { active, hudEnabled, redactEnabled, tabTitle } = state;
  statusEl.textContent = active ? `Capturing${tabTitle ? `: ${tabTitle}` : ''}` : 'Idle';
  startBtn.disabled = active;
  stopBtn.disabled = !active;
  hudToggle.checked = hudEnabled;
  redactToggle.checked = redactEnabled;
}

startBtn.addEventListener('click', async () => {
  try {
    const response = await chrome.runtime.sendMessage({
      type: 'POPUP_START_CAPTURE',
      payload: {
        hudEnabled: hudToggle.checked,
        redactEnabled: redactToggle.checked,
      },
    });
    applyState(response);
  } catch (error) {
    logger.error('startBtn', 'ui', 'Failed to start capture', { error });
  }
});

stopBtn.addEventListener('click', async () => {
  try {
    const response = await chrome.runtime.sendMessage({ type: 'POPUP_STOP_CAPTURE' });
    applyState(response);
  } catch (error) {
    logger.error('stopBtn', 'ui', 'Failed to stop capture', { error });
  }
});

hudToggle.addEventListener('change', async () => {
  try {
    const response = await chrome.runtime.sendMessage({
      type: 'POPUP_UPDATE_PREFS',
      payload: { hudEnabled: hudToggle.checked },
    });
    applyState(response);
  } catch (error) {
    logger.error('hudToggle', 'ui', 'Failed to update HUD preference', { error });
  }
});

redactToggle.addEventListener('change', async () => {
  try {
    const response = await chrome.runtime.sendMessage({
      type: 'POPUP_UPDATE_PREFS',
      payload: { redactEnabled: redactToggle.checked },
    });
    applyState(response);
  } catch (error) {
    logger.error('redactToggle', 'ui', 'Failed to update redact preference', { error });
  }
});

refreshState().catch((error) => {
  logger.error('refreshState', 'init', 'Failed to fetch initial state', { error });
});

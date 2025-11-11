(async () => {
  const { createLogger } = await import(chrome.runtime.getURL('lib/logger.js'));
  const logger = createLogger('extension/content.js', 'ContentScript');

  let hudEnabled = false;
  let redactEnabled = false;
  let captureActive = false;
  let hudElement = null;
  let overlay = null;
  let isDrawing = false;
  let drawStart = null;
  let masks = [];

  const MASK_CLASS = 'sop-agent-redact-mask';
  const OVERLAY_ID = 'sop-agent-redact-overlay';
  const HUD_ID = 'sop-agent-hud';

  function postToBackground(type, payload) {
    chrome.runtime.sendMessage({ type, payload }).catch((error) => {
      logger.error('postToBackground', 'messaging', 'Failed to send message', { error });
    });
  }

  function ensureHud() {
    if (hudElement || !hudEnabled) return;
    hudElement = document.createElement('div');
    hudElement.id = HUD_ID;
    hudElement.style.position = 'fixed';
    hudElement.style.top = '0';
    hudElement.style.left = '0';
    hudElement.style.right = '0';
    hudElement.style.zIndex = '2147483646';
    hudElement.style.background = 'linear-gradient(90deg, rgba(40,56,120,0.92), rgba(8,12,28,0.92))';
    hudElement.style.color = '#ecf1ff';
    hudElement.style.display = 'flex';
    hudElement.style.alignItems = 'center';
    hudElement.style.justifyContent = 'space-between';
    hudElement.style.padding = '0.5rem 0.75rem';
    hudElement.style.fontFamily = "'Inter', system-ui, sans-serif";
    hudElement.style.backdropFilter = 'blur(8px)';
    hudElement.style.borderBottom = '1px solid rgba(148,163,255,0.25)';
    hudElement.innerHTML = `
      <div style="display:flex;flex-direction:column;gap:0.1rem;">
        <strong style="font-size:0.95rem;">SOP Agent is capturing this tab locally</strong>
        <span style="font-size:0.75rem;opacity:0.8;">All processing remains on-device. Redact sensitive regions as needed.</span>
      </div>
      <div style="display:flex;gap:0.5rem;">
        <button data-action="toggle-redact" style="background:rgba(255,255,255,0.1);color:#f8fbff;border:none;padding:0.35rem 0.65rem;border-radius:0.4rem;font-weight:600;cursor:pointer;">${
          redactEnabled ? 'Hide Redact Tool' : 'Show Redact Tool'
        }</button>
        <button data-action="stop" style="background:#f43f5e;color:#0b0d16;border:none;padding:0.35rem 0.65rem;border-radius:0.4rem;font-weight:700;cursor:pointer;">Stop</button>
      </div>
    `;
    hudElement.addEventListener('click', (event) => {
      const target = event.target;
      if (!(target instanceof HTMLElement)) return;
      const action = target.dataset.action;
      if (action === 'stop') {
        postToBackground('CONTENT_REQUEST_STOP');
      } else if (action === 'toggle-redact') {
        setRedactMode(!redactEnabled);
        updateHudControls();
      }
    });
    document.body.appendChild(hudElement);
  }

  function updateHudControls() {
    if (!hudElement) return;
    const toggle = hudElement.querySelector('[data-action="toggle-redact"]');
    if (toggle) {
      toggle.textContent = redactEnabled ? 'Hide Redact Tool' : 'Show Redact Tool';
    }
  }

  function removeHud() {
    if (hudElement) {
      hudElement.remove();
      hudElement = null;
    }
  }

  function ensureOverlay() {
    if (!redactEnabled) return;
    if (!overlay) {
      overlay = document.createElement('div');
      overlay.id = OVERLAY_ID;
      overlay.style.position = 'fixed';
      overlay.style.top = '0';
      overlay.style.left = '0';
      overlay.style.right = '0';
      overlay.style.bottom = '0';
      overlay.style.zIndex = '2147483645';
      overlay.style.pointerEvents = 'none';
      overlay.style.display = 'block';
      overlay.style.userSelect = 'none';
      document.body.appendChild(overlay);
    }
    renderMasks();
  }

  function teardownOverlay() {
    if (overlay) {
      overlay.remove();
      overlay = null;
    }
  }

  function renderMasks() {
    if (!overlay) return;
    overlay.innerHTML = '';
    for (const mask of masks) {
      const el = document.createElement('div');
      el.className = MASK_CLASS;
      Object.assign(el.style, {
        position: 'absolute',
        left: `${mask.x * 100}%`,
        top: `${mask.y * 100}%`,
        width: `${mask.width * 100}%`,
        height: `${mask.height * 100}%`,
        background: 'rgba(8,12,20,0.65)',
        border: '1px solid rgba(148,163,255,0.55)',
        borderRadius: '0.4rem',
        pointerEvents: 'none',
      });
      overlay.appendChild(el);
    }
  }

  function setRedactMode(enabled) {
    redactEnabled = Boolean(enabled);
    if (!redactEnabled) {
      teardownOverlay();
      postToBackground('CONTENT_REDACT_MODE', { enabled: false });
      return;
    }
    ensureOverlay();
    postToBackground('CONTENT_REDACT_MODE', { enabled: true });
  }

  function handlePointerDown(event) {
    if (!redactEnabled) return;
    if (!(event.target instanceof Element)) return;
    if (hudElement && hudElement.contains(event.target)) return;
    if (!overlay) {
      ensureOverlay();
    }
    if (!overlay) return;
    isDrawing = true;
    overlay.style.pointerEvents = 'auto';
    drawStart = { x: event.clientX, y: event.clientY };
    const rect = document.createElement('div');
    rect.className = MASK_CLASS;
    rect.dataset.temp = 'true';
    Object.assign(rect.style, {
      position: 'absolute',
      left: `${event.clientX}px`,
      top: `${event.clientY}px`,
      width: '0px',
      height: '0px',
      background: 'rgba(8,12,20,0.45)',
      border: '1px solid rgba(148,163,255,0.8)',
      borderRadius: '0.4rem',
      pointerEvents: 'none',
    });
    overlay.appendChild(rect);
  }

  function handlePointerMove(event) {
    if (!isDrawing || !overlay) return;
    const rect = overlay.querySelector(`.${MASK_CLASS}[data-temp="true"]`);
    if (!rect) return;
    const width = event.clientX - drawStart.x;
    const height = event.clientY - drawStart.y;
    Object.assign(rect.style, {
      left: `${Math.min(event.clientX, drawStart.x)}px`,
      top: `${Math.min(event.clientY, drawStart.y)}px`,
      width: `${Math.abs(width)}px`,
      height: `${Math.abs(height)}px`,
    });
  }

  function handlePointerUp(event) {
    if (!isDrawing || !overlay) return;
    overlay.style.pointerEvents = 'none';
    const temp = overlay.querySelector(`.${MASK_CLASS}[data-temp="true"]`);
    if (!temp) {
      isDrawing = false;
      drawStart = null;
      return;
    }
    temp.remove();
    isDrawing = false;
    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;
    const startX = Math.min(event.clientX, drawStart.x);
    const startY = Math.min(event.clientY, drawStart.y);
    const width = Math.abs(event.clientX - drawStart.x);
    const height = Math.abs(event.clientY - drawStart.y);
    drawStart = null;
    if (width < 8 || height < 8) {
      logger.warn('handlePointerUp', 'redaction', 'Ignored mask smaller than threshold');
      return;
    }
    const mask = {
      x: clamp(startX / viewportWidth),
      y: clamp(startY / viewportHeight),
      width: clamp(width / viewportWidth),
      height: clamp(height / viewportHeight),
    };
    masks.push(mask);
    renderMasks();
    postToBackground('CONTENT_UPDATE_REDACTIONS', { masks });
  }

  function clamp(value) {
    return Math.min(Math.max(value, 0), 1);
  }

  function generateSelector(element) {
    if (!element || element === document.documentElement) return 'html';
    if (element.id) {
      return `#${CSS.escape(element.id)}`;
    }
    const parts = [];
    let el = element;
    while (el && el.nodeType === Node.ELEMENT_NODE && parts.length < 5) {
      let selector = el.nodeName.toLowerCase();
      if (el.classList.length) {
        selector += `.${Array.from(el.classList)
          .slice(0, 2)
          .map((cls) => CSS.escape(cls))
          .join('.')}`;
      }
      const siblingIndex = Array.from(el.parentNode?.children ?? []).indexOf(el);
      if (siblingIndex > -1) {
        selector += `:nth-child(${siblingIndex + 1})`;
      }
      parts.unshift(selector);
      el = el.parentElement;
    }
    return parts.join(' > ');
  }

  function handleClick(event) {
    const target = event.target instanceof Element ? event.target.closest('button, a, [role="button"]') : null;
    const text = target?.textContent?.trim().slice(0, 100) ?? null;
    postToBackground('DOM_EVENT', {
      t: Date.now(),
      type: 'click',
      text,
      selector: target ? generateSelector(target) : null,
    });
  }

  function handleInput(event) {
    const element = event.target;
    if (!(element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement)) {
      return;
    }
    const selector = generateSelector(element);
    const label = element.getAttribute('aria-label') || element.placeholder || null;
    postToBackground('DOM_EVENT', {
      t: Date.now(),
      type: 'input',
      selector,
      text: label,
    });
  }

  function handleRouteChange() {
    postToBackground('DOM_EVENT', {
      t: Date.now(),
      type: 'route',
      route: location.href,
    });
  }

  function installHistoryListeners() {
    const pushState = history.pushState.bind(history);
    history.pushState = function pushStateGuard(...args) {
      const result = pushState(...args);
      handleRouteChange();
      return result;
    };
    const replaceState = history.replaceState.bind(history);
    history.replaceState = function replaceStateGuard(...args) {
      const result = replaceState(...args);
      handleRouteChange();
      return result;
    };
    window.addEventListener('popstate', handleRouteChange, true);
  }

  function removeHistoryListeners() {
    window.removeEventListener('popstate', handleRouteChange, true);
  }

  function bindListeners() {
    document.addEventListener('click', handleClick, true);
    document.addEventListener('input', handleInput, true);
    document.addEventListener('pointerdown', handlePointerDown, true);
    document.addEventListener('pointermove', handlePointerMove, true);
    document.addEventListener('pointerup', handlePointerUp, true);
    installHistoryListeners();
  }

  function unbindListeners() {
    document.removeEventListener('click', handleClick, true);
    document.removeEventListener('input', handleInput, true);
    document.removeEventListener('pointerdown', handlePointerDown, true);
    document.removeEventListener('pointermove', handlePointerMove, true);
    document.removeEventListener('pointerup', handlePointerUp, true);
    removeHistoryListeners();
  }

  function startCapture(state) {
    if (captureActive) return;
    captureActive = true;
    hudEnabled = Boolean(state?.hudEnabled);
    redactEnabled = Boolean(state?.redactEnabled);
    masks = Array.isArray(state?.masks) ? state.masks : [];
    if (hudEnabled) {
      ensureHud();
    }
    if (redactEnabled) {
      ensureOverlay();
    }
    bindListeners();
    postToBackground('CONTENT_READY');
    logger.info('startCapture', 'lifecycle', 'Content capture started');
  }

  function stopCapture() {
    if (!captureActive) return;
    captureActive = false;
    removeHud();
    teardownOverlay();
    masks = [];
    unbindListeners();
    logger.info('stopCapture', 'lifecycle', 'Content capture stopped');
  }

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    switch (message?.type) {
      case 'CONTENT_START':
        startCapture(message.payload);
        sendResponse({ ok: true });
        return true;
      case 'CONTENT_STOP':
        stopCapture();
        sendResponse({ ok: true });
        return true;
      case 'CONTENT_UPDATE_PREFS':
        hudEnabled = Boolean(message.payload?.hudEnabled);
        redactEnabled = Boolean(message.payload?.redactEnabled);
        if (!hudEnabled) removeHud();
        else ensureHud();
        if (!redactEnabled) teardownOverlay();
        else ensureOverlay();
        updateHudControls();
        sendResponse({ ok: true });
        return true;
      case 'CONTENT_SET_REDACTIONS':
        masks = Array.isArray(message.payload?.masks) ? message.payload.masks : [];
        if (redactEnabled) {
          ensureOverlay();
        }
        sendResponse({ ok: true });
        return true;
      default:
        break;
    }
    return undefined;
  });
})();

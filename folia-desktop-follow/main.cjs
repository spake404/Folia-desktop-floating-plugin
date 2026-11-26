'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');

const RPC = {
  syncSettings: 'syncSettings',
  getStatus: 'getStatus',
  sinkNow: 'sinkNow',
  trayToggle: 'trayToggle',
};

const DEBUG_STATUS_PATH = path.join(os.tmpdir(), 'folia-half-status.json');

const HIT_TEST_BOOTSTRAP_SCRIPT = `(() => {
  if (window.__foliaDesktopFollowHitTestV2) return true;
  const INTERACTIVE_SELECTOR = [
    'button',
    'a[href]',
    'input',
    'select',
    'textarea',
    'label',
    'summary',
    'details',
    'option',
    '[contenteditable="true"]',
    '[role="button"]',
    '[role="slider"]',
    '[role="tab"]',
    '[role="menuitem"]',
    '[role="menuitemcheckbox"]',
    '[role="menuitemradio"]',
    '[role="checkbox"]',
    '[role="radio"]',
    '[role="switch"]',
    '[role="combobox"]',
    '[role="option"]',
    '[role="link"]',
    '[role="textbox"]',
    '[role="searchbox"]',
    '[role="spinbutton"]',
    '[data-interactive="true"]'
  ].join(',');

  const MODAL_OR_SURFACE_SELECTOR = [
    '[role="dialog"]',
    '[aria-modal="true"]',
    '[role="menu"]',
    '[role="listbox"]',
    '[role="alertdialog"]',
    '[data-wall-handoff-layer="home"]',
    '[data-wall-handoff-layer="lattice"]'
  ].join(',');

  const INTERACTIVE_CURSORS = new Set([
    'pointer', 'grab', 'grabbing', 'move', 'text',
    'ew-resize', 'ns-resize', 'nwse-resize', 'nesw-resize', 'col-resize', 'row-resize'
  ]);

  let reactPropsKey = null;
  let pointerPressed = false;

  window.addEventListener('pointerdown', () => { pointerPressed = true; }, true);
  window.addEventListener('pointerup', () => { pointerPressed = false; }, true);
  window.addEventListener('mouseup', () => { pointerPressed = false; }, true);
  window.addEventListener('pointercancel', () => { pointerPressed = false; }, true);
  window.addEventListener('blur', () => { pointerPressed = false; }, true);
  window.addEventListener('mousemove', (e) => { pointerPressed = e.buttons !== 0; }, true);

  function getReactProps(el) {
    if (!el || typeof el !== 'object') return null;
    if (reactPropsKey && Object.prototype.hasOwnProperty.call(el, reactPropsKey)) return el[reactPropsKey];
    for (const k of Object.keys(el)) {
      if (k.startsWith('__reactProps$')) {
        reactPropsKey = k;
        return el[k];
      }
    }
    return null;
  }

  function hasReactHandler(el) {
    const props = getReactProps(el);
    if (!props || typeof props !== 'object') return false;
    return (
      typeof props.onClick === 'function' ||
      typeof props.onClickCapture === 'function' ||
      typeof props.onDoubleClick === 'function' ||
      typeof props.onMouseDown === 'function' ||
      typeof props.onMouseDownCapture === 'function' ||
      typeof props.onMouseUp === 'function' ||
      typeof props.onPointerDown === 'function' ||
      typeof props.onPointerDownCapture === 'function' ||
      typeof props.onPointerUp === 'function' ||
      typeof props.onWheel === 'function' ||
      typeof props.onContextMenu === 'function'
    );
  }

  function parseAlpha(color) {
    if (!color || color === 'transparent') return 0;
    const m = /^rgba\\(\\s*[\\d.]+\\s*,\\s*[\\d.]+\\s*,\\s*[\\d.]+\\s*,\\s*([\\d.]+)\\s*\\)$/i.exec(color);
    if (m) return Number(m[1]) || 0;
    if (/^rgb\\(/i.test(color)) return 1;
    return 0;
  }

  function hasVisibleSurface(style) {
    if (parseAlpha(style.backgroundColor) >= 0.08) return true;
    const bf = style.backdropFilter || style.webkitBackdropFilter || '';
    return Boolean(bf && bf !== 'none');
  }

  function checkElement(el) {
    if (!(el instanceof Element)) return null;
    const tag = el.tagName;
    if (tag === 'HTML' || tag === 'BODY' || el.id === 'root') return null;
    const style = window.getComputedStyle(el);
    if (style.pointerEvents === 'none' || style.visibility === 'hidden' || style.display === 'none') return null;
    const op = Number(style.opacity);
    if (!Number.isNaN(op) && op <= 0.02) return null;

    if (el.matches(MODAL_OR_SURFACE_SELECTOR)) return 'modal_or_surface';
    if (el.matches(INTERACTIVE_SELECTOR)) return 'interactive_tag';
    const appRegion = (style.webkitAppRegion || style.getPropertyValue('-webkit-app-region') || '').trim();
    if (appRegion === 'drag') return 'drag_region';
    if (tag === 'CANVAS' || tag === 'VIDEO') return null;

    const rect = el.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return null;
    const isViewportSized = rect.width >= window.innerWidth * 0.82 && rect.height >= window.innerHeight * 0.82;
    if (!isViewportSized) {
      if (INTERACTIVE_CURSORS.has(style.cursor)) return 'cursor:' + style.cursor;
      if (hasReactHandler(el)) return 'react_handler';
      if ((style.overflowY === 'auto' || style.overflowY === 'scroll') && el.scrollHeight > el.clientHeight + 4) return 'scroll_y';
      if ((style.overflowX === 'auto' || style.overflowX === 'scroll') && el.scrollWidth > el.clientWidth + 4) return 'scroll_x';
      if (rect.width >= 16 && rect.height >= 16 && hasVisibleSurface(style) && el.querySelector(INTERACTIVE_SELECTOR)) return 'surface_container';
    }
    return null;
  }

  window.__foliaDesktopFollowHitTestV2 = (normX, normY) => {
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    if (pointerPressed) {
      return { interactive: true, pressed: true, reason: 'pointer_pressed', vw, vh };
    }
    const x = Math.round(normX * vw);
    const y = Math.round(normY * vh);
    if (x < 0 || y < 0 || x >= vw || y >= vh) {
      return { interactive: false, pressed: false, reason: 'out_of_bounds', x, y, vw, vh };
    }
    if (x <= 4 || y <= 4 || x >= vw - 5 || y >= vh - 5) {
      return { interactive: true, pressed: false, reason: 'resize_edge', x, y, vw, vh };
    }
    const stack = document.elementsFromPoint(x, y);
    for (const el of stack) {
      const reason = checkElement(el);
      if (reason) {
        return {
          interactive: true,
          pressed: false,
          reason,
          tag: el.tagName,
          x,
          y,
          vw,
          vh
        };
      }
    }
    const top = stack[0];
    return {
      interactive: false,
      pressed: false,
      reason: 'empty',
      topTag: top ? top.tagName : null,
      topClass: top && typeof top.className === 'string' ? top.className.slice(0, 80) : null,
      x,
      y,
      vw,
      vh
    };
  };
  return true;
})();`;

const DEFAULT_SETTINGS = {
  enabled: false,
  halfClickThrough: false,
  preventWinDMinimize: true,
};

const TRAY_ITEM_ID = 'folia-desktop-follow-toggle';
const TRAY_HALF_CLICK_THROUGH_ID = 'folia-desktop-follow-half-click-through';
const TRANSPARENT_LABELS = new Set(['透明背景', 'Transparent Background']);
const CLICK_THROUGH_LABELS = new Set(['点击穿透', '點選穿透', 'Click-Through', 'Click Through']);
const ALWAYS_ON_TOP_LABELS = new Set([
  '窗口置顶',
  '視窗置頂',
  'Always on Top',
  '窗口置顶（Wayland 下不可用）',
  '視窗置頂（Wayland 下不可用）',
  'Always on Top (Unavailable on Wayland)',
]);
const WALLPAPER_LABELS = new Set(['壁纸模式', '桌布模式', 'Wallpaper Mode']);

function detectTrayLocale(items) {
  for (const item of items) {
    const label = typeof item?.label === 'string' ? item.label : '';
    if (label === '視窗置頂' || label === '桌布模式' || label === '隱藏工作列圖示') {
      return 'zh-TW';
    }
    if (label === 'Transparent Background' || label === 'Always on Top' || label === 'Wallpaper Mode') {
      return 'en-US';
    }
  }
  return 'zh-CN';
}

function getTrayLabels(items) {
  const locale = detectTrayLocale(items);
  if (locale === 'zh-TW') {
    return { follow: '跟隨桌面', halfClickThrough: '半穿透' };
  }
  if (locale === 'en-US') {
    return { follow: 'Follow Desktop', halfClickThrough: 'Smart Click-Through' };
  }
  return { follow: '跟随桌面', halfClickThrough: '半穿透' };
}

function findMenuItemIndex(items, labelSet) {
  return items.findIndex((item) => typeof item?.label === 'string' && labelSet.has(item.label));
}

function readNativeHwnd(win) {
  if (!win || win.isDestroyed()) return null;
  const buf = win.getNativeWindowHandle();
  if (!Buffer.isBuffer(buf) || buf.length < 4) return null;
  if (buf.length >= 8) {
    return buf.readBigUInt64LE(0).toString();
  }
  return String(buf.readUInt32LE(0));
}

function isFoliaMainWindow(win) {
  if (!win || win.isDestroyed()) return false;
  if (typeof win.__wallpaperGeometry === 'boolean' && typeof win.__transparentFullscreen === 'boolean') {
    return true;
  }
  try {
    const url = win.webContents?.getURL?.() || '';
    if (!url) return false;
    if (/mode=(remote|export|lyrics)/i.test(url)) return false;
    if (/bar\.html|lyrics\.html/i.test(url)) return false;
    return /index\.html/i.test(url) || /^https?:\/\/(localhost|127\.0\.0\.1):/i.test(url);
  } catch {
    return false;
  }
}

function normalizeSettings(raw) {
  const input = raw && typeof raw === 'object' ? raw : {};
  return {
    enabled: typeof input.enabled === 'boolean' ? input.enabled : DEFAULT_SETTINGS.enabled,
    halfClickThrough:
      typeof input.halfClickThrough === 'boolean'
        ? input.halfClickThrough
        : DEFAULT_SETTINGS.halfClickThrough,
    preventWinDMinimize:
      typeof input.preventWinDMinimize === 'boolean'
        ? input.preventWinDMinimize
        : DEFAULT_SETTINGS.preventWinDMinimize,
  };
}

module.exports = function activate(api) {
  const isWindows = process.platform === 'win32';
  let electron = null;
  if (isWindows) {
    try {
      electron = require('electron');
    } catch (error) {
      api.log.error('无法加载 electron 模块，桌面跟随功能不可用', error);
    }
  }

  const helperPath = path.join(__dirname, 'bin', 'folia-desktop-follow-helper.exe');
  let disposed = false;
  let settings = { ...DEFAULT_SETTINGS };
  let helperProc = null;
  let helperStdoutBuf = '';
  let trackedWin = null;
  let trackedHwnd = null;
  let trackedWinCleanup = null;
  let lastPhase = 'idle';
  let lastDesktopHost = '0';
  let pausedReason = null;
  let reattachTimer = null;
  let restartAttempts = 0;
  let originalSetContextMenu = null;
  let trayPatchInstalled = false;
  let capturedTray = null;
  let capturedMenu = null;
  let capturedAlwaysOnTopItem = null;
  let capturedClickThroughItem = null;
  let capturedRefreshTrayMenu = null;
  let isRefreshingTray = false;
  let isEnablingFollow = false;
  let isEnablingHalfClickThrough = false;
  let clientSynced = false;
  let hostClickThroughActive = false;
  let appliedMouseIgnore = false;
  let cursorPollTimer = null;
  let probeInFlight = false;
  let bootstrappedWebContentsId = null;
  let lastDebugWriteAt = 0;
  let lastDebugInteractive = null;

  function findRefreshTrayMenuFn(win) {
    if (!win || win.isDestroyed() || typeof win.listeners !== 'function') return null;
    const showListeners = win.listeners('show');
    const byName = showListeners.find((fn) => typeof fn === 'function' && fn.name === 'refreshTrayMenu');
    if (byName) return byName;
    const bySource = showListeners.find(
      (fn) => typeof fn === 'function' && /setContextMenu/.test(Function.prototype.toString.call(fn))
    );
    return bySource || null;
  }

  function triggerTrayRefresh() {
    if (isRefreshingTray) return;
    const win = findMainWindow();
    if (win) {
      const found = findRefreshTrayMenuFn(win);
      if (found) {
        capturedRefreshTrayMenu = found;
      }
    }
    if (typeof capturedRefreshTrayMenu === 'function') {
      isRefreshingTray = true;
      try {
        capturedRefreshTrayMenu();
        return;
      } catch (error) {
        api.log.warn('刷新 Folia 托盘菜单失败', error);
      } finally {
        isRefreshingTray = false;
      }
    }
    if (capturedTray && !capturedTray.isDestroyed?.() && capturedMenu && originalSetContextMenu) {
      const existing = capturedMenu.items?.find((item) => item.id === TRAY_ITEM_ID);
      if (existing) {
        existing.checked = Boolean(settings.enabled);
      }
      const existingHalf = capturedMenu.items?.find((item) => item.id === TRAY_HALF_CLICK_THROUGH_ID);
      if (existingHalf) {
        existingHalf.checked = Boolean(settings.halfClickThrough);
      }
      if (existing || existingHalf) {
        try {
          originalSetContextMenu.call(capturedTray, capturedMenu);
        } catch (error) {
          api.log.warn('更新托盘菜单勾选状态失败', error);
        }
      }
    }
  }

  function disableHostAlwaysOnTop(win) {
    if (capturedAlwaysOnTopItem && capturedAlwaysOnTopItem.checked && typeof capturedAlwaysOnTopItem.click === 'function') {
      try {
        capturedAlwaysOnTopItem.click(capturedAlwaysOnTopItem, win, {});
        return;
      } catch (error) {
        api.log.warn('通过托盘项取消窗口置顶失败，回退原生调用', error);
      }
    }
    if (win && !win.isDestroyed()) {
      try {
        win.setAlwaysOnTop(false);
      } catch (error) {
        api.log.warn('自动关闭窗口置顶失败', error);
      }
    }
  }

  function notifyClientEnabled(enabled) {
    if (typeof api.rpc?.send !== 'function') return;
    try {
      api.rpc.send(RPC.trayToggle, {
        enabled: Boolean(enabled),
        halfClickThrough: Boolean(settings.halfClickThrough),
      });
    } catch (error) {
      api.log.warn('向渲染进程同步跟随桌面开关状态失败', error);
    }
  }

  function applyHalfClickThroughIgnore(ignore) {
    const win = findMainWindow();
    if (!win || win.isDestroyed()) {
      appliedMouseIgnore = false;
      return false;
    }
    if (win.__wallpaperGeometry === true || hostClickThroughActive) {
      return false;
    }
    const nextIgnore = Boolean(ignore) && Boolean(settings.halfClickThrough);
    if (appliedMouseIgnore === nextIgnore) {
      return true;
    }
    try {
      if (nextIgnore) {
        win.setIgnoreMouseEvents(true, { forward: true });
      } else {
        win.setIgnoreMouseEvents(false);
      }
      appliedMouseIgnore = nextIgnore;
      return true;
    } catch (error) {
      api.log.warn('切换半穿透鼠标忽略状态失败', error);
      return false;
    }
  }

  function resetMouseIgnoreIfOwned({ force = false } = {}) {
    if (!force && !appliedMouseIgnore) return;
    appliedMouseIgnore = false;
    if (hostClickThroughActive) return;
    const win = findMainWindow();
    if (!win || win.isDestroyed() || win.__wallpaperGeometry === true) return;
    try {
      win.setIgnoreMouseEvents(false);
    } catch (error) {
      api.log.warn('还原鼠标忽略状态失败', error);
    }
  }

  function writeHalfDebug(info) {
    const now = Date.now();
    if (info.interactive === lastDebugInteractive && now - lastDebugWriteAt < 500) {
      return;
    }
    lastDebugInteractive = info.interactive;
    lastDebugWriteAt = now;
    try {
      fs.writeFileSync(DEBUG_STATUS_PATH, JSON.stringify({ ...info, at: now }, null, 2), 'utf8');
    } catch {
      // ignore debug write errors
    }
  }

  function stopCursorPoll() {
    if (cursorPollTimer) {
      clearInterval(cursorPollTimer);
      cursorPollTimer = null;
    }
    probeInFlight = false;
    bootstrappedWebContentsId = null;
    try {
      if (fs.existsSync(DEBUG_STATUS_PATH)) fs.unlinkSync(DEBUG_STATUS_PATH);
    } catch {
      // ignore
    }
  }

  async function pollHalfClickThroughCursor() {
    if (disposed || !settings.halfClickThrough || hostClickThroughActive) {
      stopCursorPoll();
      return;
    }
    if (probeInFlight) {
      return;
    }
    const win = findMainWindow();
    if (!win || win.isDestroyed() || win.__wallpaperGeometry === true || !win.webContents || win.webContents.isDestroyed()) {
      return;
    }
    if (!win.isVisible() || win.isMinimized()) {
      return;
    }
    if (!electron?.screen?.getCursorScreenPoint) {
      return;
    }
    let cursor;
    let bounds;
    try {
      cursor = electron.screen.getCursorScreenPoint();
      bounds = win.getContentBounds();
    } catch {
      return;
    }
    if (!cursor || !bounds || bounds.width <= 0 || bounds.height <= 0) {
      return;
    }

    const inside =
      cursor.x >= bounds.x &&
      cursor.y >= bounds.y &&
      cursor.x < bounds.x + bounds.width &&
      cursor.y < bounds.y + bounds.height;

    if (!inside) {
      applyHalfClickThroughIgnore(true);
      writeHalfDebug({ interactive: false, reason: 'outside_bounds', cursor, bounds, appliedMouseIgnore });
      return;
    }

    const normX = (cursor.x - bounds.x) / bounds.width;
    const normY = (cursor.y - bounds.y) / bounds.height;
    probeInFlight = true;
    try {
      if (bootstrappedWebContentsId !== win.webContents.id) {
        await win.webContents.executeJavaScript(HIT_TEST_BOOTSTRAP_SCRIPT, false);
        bootstrappedWebContentsId = win.webContents.id;
      }
      if (disposed || !settings.halfClickThrough || hostClickThroughActive) {
        return;
      }
      const result = await win.webContents.executeJavaScript(
        `window.__foliaDesktopFollowHitTestV2 ? window.__foliaDesktopFollowHitTestV2(${normX}, ${normY}) : null`,
        false
      );
      if (disposed || !settings.halfClickThrough || hostClickThroughActive) {
        return;
      }
      if (result && typeof result.interactive === 'boolean') {
        applyHalfClickThroughIgnore(!result.interactive);
        writeHalfDebug({ ...result, cursor, bounds, appliedMouseIgnore });
      }
    } catch (error) {
      bootstrappedWebContentsId = null;
      writeHalfDebug({ interactive: false, reason: 'eval_error', error: String(error?.message || error), appliedMouseIgnore });
    } finally {
      probeInFlight = false;
    }
  }

  function startCursorPoll() {
    if (cursorPollTimer || disposed || !isWindows || !electron) return;
    cursorPollTimer = setInterval(() => {
      void pollHalfClickThroughCursor();
    }, 35);
    if (typeof cursorPollTimer.unref === 'function') {
      cursorPollTimer.unref();
    }
    void pollHalfClickThroughCursor();
  }

  function disableHostClickThrough(win) {
    if (capturedClickThroughItem && capturedClickThroughItem.checked && typeof capturedClickThroughItem.click === 'function') {
      try {
        capturedClickThroughItem.click(capturedClickThroughItem, win, {});
        hostClickThroughActive = false;
        return;
      } catch (error) {
        api.log.warn('通过托盘项关闭点击穿透失败', error);
      }
    }
    hostClickThroughActive = false;
    if (win && !win.isDestroyed()) {
      try {
        win.setIgnoreMouseEvents(false);
      } catch {
        // ignore
      }
    }
  }

  function disableFollowForMutualExclusion({ refreshTray = true } = {}) {
    if (!settings.enabled) return;
    settings = { ...settings, enabled: false };
    pausedReason = 'disabled';
    stopHelper();
    notifyClientEnabled(false);
    if (refreshTray) {
      triggerTrayRefresh();
    }
  }

  function disableHalfClickThroughForMutualExclusion({ refreshTray = true } = {}) {
    if (!settings.halfClickThrough) return;
    settings = { ...settings, halfClickThrough: false };
    appliedMouseIgnore = false;
    stopCursorPoll();
    notifyClientEnabled(settings.enabled);
    if (refreshTray) {
      triggerTrayRefresh();
    }
  }

  function reconcileHalfClickThrough({ explicitEnable = false } = {}) {
    if (disposed || !isWindows || !electron) return;
    const win = findMainWindow();
    if (!settings.halfClickThrough) {
      stopCursorPoll();
      resetMouseIgnoreIfOwned({ force: true });
      return;
    }
    if (!win || win.isDestroyed() || win.__wallpaperGeometry === true) {
      appliedMouseIgnore = false;
      stopCursorPoll();
      return;
    }
    if (hostClickThroughActive) {
      if (explicitEnable) {
        disableHostClickThrough(win);
      } else {
        disableHalfClickThroughForMutualExclusion({ refreshTray: true });
        return;
      }
    }
    startCursorPoll();
  }

  function toggleEnabledFromTray() {
    const nextEnabled = !settings.enabled;
    isEnablingFollow = nextEnabled;
    settings = { ...settings, enabled: nextEnabled };
    try {
      reconcile({ explicitEnable: nextEnabled });
      notifyClientEnabled(settings.enabled);
    } finally {
      isEnablingFollow = false;
    }
    triggerTrayRefresh();
  }

  function toggleHalfClickThroughFromTray() {
    const nextHalf = !settings.halfClickThrough;
    isEnablingHalfClickThrough = nextHalf;
    settings = { ...settings, halfClickThrough: nextHalf };
    try {
      reconcileHalfClickThrough({ explicitEnable: nextHalf });
      if (settings.halfClickThrough) {
        applyHalfClickThroughIgnore(true);
      }
      notifyClientEnabled(settings.enabled);
    } finally {
      isEnablingHalfClickThrough = false;
    }
    triggerTrayRefresh();
  }

  function injectTrayMenuItem(menu) {
    if (!menu || !Array.isArray(menu.items) || !electron?.MenuItem) return;
    const transparentIdx = findMenuItemIndex(menu.items, TRANSPARENT_LABELS);
    const clickThroughIdx = findMenuItemIndex(menu.items, CLICK_THROUGH_LABELS);
    const alwaysOnTopIdx = findMenuItemIndex(menu.items, ALWAYS_ON_TOP_LABELS);
    if (transparentIdx < 0 && alwaysOnTopIdx < 0) return;

    capturedAlwaysOnTopItem = alwaysOnTopIdx >= 0 ? menu.items[alwaysOnTopIdx] : null;
    capturedClickThroughItem = clickThroughIdx >= 0 ? menu.items[clickThroughIdx] : null;
    const alwaysOnTopChecked = Boolean(capturedAlwaysOnTopItem?.checked);
    const clickThroughChecked = Boolean(capturedClickThroughItem?.checked);
    hostClickThroughActive = clickThroughChecked;

    const wallpaperIdx = findMenuItemIndex(menu.items, WALLPAPER_LABELS);
    const wallpaperChecked = wallpaperIdx >= 0 && Boolean(menu.items[wallpaperIdx]?.checked);
    const mainWin = findMainWindow();
    const hasMainWindow = Boolean(mainWin && !mainWin.isDestroyed());
    const wallpaperActive = wallpaperChecked || mainWin?.__wallpaperGeometry === true;

    if (!isEnablingFollow && alwaysOnTopChecked && settings.enabled) {
      disableFollowForMutualExclusion({ refreshTray: false });
    }
    if (!isEnablingHalfClickThrough && clickThroughChecked && settings.halfClickThrough) {
      disableHalfClickThroughForMutualExclusion({ refreshTray: false });
    }

    const labels = getTrayLabels(menu.items);

    const existing = menu.items.find((item) => item.id === TRAY_ITEM_ID);
    if (existing) {
      existing.checked = Boolean(settings.enabled);
      existing.enabled = hasMainWindow && !wallpaperActive;
    } else {
      const insertIndex = transparentIdx >= 0 ? transparentIdx + 1 : alwaysOnTopIdx;
      const followItem = new electron.MenuItem({
        id: TRAY_ITEM_ID,
        label: labels.follow,
        type: 'checkbox',
        checked: Boolean(settings.enabled),
        enabled: hasMainWindow && !wallpaperActive,
        click: () => {
          toggleEnabledFromTray();
        },
      });
      menu.insert(insertIndex, followItem);
    }

    const existingHalf = menu.items.find((item) => item.id === TRAY_HALF_CLICK_THROUGH_ID);
    if (existingHalf) {
      existingHalf.checked = Boolean(settings.halfClickThrough);
      existingHalf.enabled = hasMainWindow && !wallpaperActive;
    } else {
      const updatedClickThroughIdx = findMenuItemIndex(menu.items, CLICK_THROUGH_LABELS);
      const updatedFollowIdx = menu.items.findIndex((item) => item.id === TRAY_ITEM_ID);
      const halfInsertIndex =
        updatedClickThroughIdx >= 0
          ? updatedClickThroughIdx + 1
          : updatedFollowIdx >= 0
            ? updatedFollowIdx + 1
            : menu.items.length;
      const halfItem = new electron.MenuItem({
        id: TRAY_HALF_CLICK_THROUGH_ID,
        label: labels.halfClickThrough,
        type: 'checkbox',
        checked: Boolean(settings.halfClickThrough),
        enabled: hasMainWindow && !wallpaperActive,
        click: () => {
          toggleHalfClickThroughFromTray();
        },
      });
      menu.insert(halfInsertIndex, halfItem);
    }
  }

  function installTrayMenuPatch() {
    if (trayPatchInstalled || !electron?.Tray?.prototype) return;
    originalSetContextMenu = electron.Tray.prototype.setContextMenu;
    if (typeof originalSetContextMenu !== 'function') return;

    electron.Tray.prototype.setContextMenu = function patchedSetContextMenu(menu) {
      if (!disposed && menu && Array.isArray(menu.items)) {
        const hasFoliaMarkers =
          findMenuItemIndex(menu.items, TRANSPARENT_LABELS) >= 0 ||
          findMenuItemIndex(menu.items, ALWAYS_ON_TOP_LABELS) >= 0;
        if (hasFoliaMarkers) {
          capturedTray = this;
          capturedMenu = menu;
          try {
            injectTrayMenuItem(menu);
          } catch (error) {
            api.log.warn('向托盘菜单注入「跟随桌面」失败', error);
          }
        }
      }
      return originalSetContextMenu.call(this, menu);
    };
    trayPatchInstalled = true;
  }

  function uninstallTrayMenuPatch() {
    if (!trayPatchInstalled || !electron?.Tray?.prototype || !originalSetContextMenu) return;
    electron.Tray.prototype.setContextMenu = originalSetContextMenu;
    trayPatchInstalled = false;
    triggerTrayRefresh();
    originalSetContextMenu = null;
    capturedTray = null;
    capturedMenu = null;
    capturedAlwaysOnTopItem = null;
    capturedClickThroughItem = null;
    capturedRefreshTrayMenu = null;
  }

  function sendHelperLine(line) {
    if (!helperProc || helperProc.killed || !helperProc.stdin || helperProc.stdin.destroyed) {
      return false;
    }
    try {
      helperProc.stdin.write(line + '\n');
      return true;
    } catch (error) {
      api.log.warn('向桌面跟随 helper 发送指令失败', error);
      return false;
    }
  }

  function stopHelper() {
    if (reattachTimer) {
      clearTimeout(reattachTimer);
      reattachTimer = null;
    }
    const proc = helperProc;
    helperProc = null;
    helperStdoutBuf = '';
    trackedHwnd = null;
    lastPhase = 'idle';
    if (!proc) return;
    try {
      if (proc.stdin && !proc.stdin.destroyed) {
        proc.stdin.write('DETACH\nQUIT\n');
        proc.stdin.end();
      }
    } catch {
      // ignore write failure during teardown
    }
    const killTimer = setTimeout(() => {
      try {
        if (!proc.killed) proc.kill();
      } catch {
        // ignore
      }
    }, 400);
    if (typeof killTimer.unref === 'function') {
      killTimer.unref();
    }
  }

  function handleHelperEvent(msg) {
    if (!msg || typeof msg !== 'object') return;
    if (msg.event === 'attached') {
      lastDesktopHost = String(msg.desktopHost ?? '0');
      restartAttempts = 0;
    } else if (msg.event === 'state') {
      lastPhase = String(msg.phase || 'idle');
      if (msg.desktopHost) {
        lastDesktopHost = String(msg.desktopHost);
      }
    } else if (msg.event === 'detached') {
      lastPhase = 'idle';
    } else if (msg.event === 'error') {
      api.log.warn(`桌面跟随 helper 报错: ${msg.message || 'unknown'}`);
    }
  }

  function ensureHelperRunning() {
    if (disposed || !isWindows) return false;
    if (helperProc && !helperProc.killed) return true;
    if (!fs.existsSync(helperPath)) {
      api.log.error(`未找到桌面跟随 helper: ${helperPath}`);
      pausedReason = 'missing_helper';
      return false;
    }

    try {
      const child = spawn(helperPath, [], {
        stdio: ['pipe', 'pipe', 'pipe'],
        windowsHide: true,
      });
      helperProc = child;
      helperStdoutBuf = '';

      child.stdout.setEncoding('utf8');
      child.stdout.on('data', (chunk) => {
        helperStdoutBuf += chunk;
        let newlineIndex = helperStdoutBuf.indexOf('\n');
        while (newlineIndex >= 0) {
          const line = helperStdoutBuf.slice(0, newlineIndex).trim();
          helperStdoutBuf = helperStdoutBuf.slice(newlineIndex + 1);
          if (line) {
            try {
              handleHelperEvent(JSON.parse(line));
            } catch {
              // ignore non-JSON lines
            }
          }
          newlineIndex = helperStdoutBuf.indexOf('\n');
        }
      });

      child.stderr.setEncoding('utf8');
      child.stderr.on('data', (chunk) => {
        const text = String(chunk || '').trim();
        if (text) api.log.warn(`desktop-follow-helper: ${text}`);
      });

      child.on('exit', (code, signal) => {
        if (helperProc !== child) return;
        helperProc = null;
        trackedHwnd = null;
        lastPhase = 'idle';
        if (disposed || !settings.enabled) return;
        api.log.warn(`桌面跟随 helper 意外退出 (code=${code}, signal=${signal})`);
        if (restartAttempts < 3) {
          restartAttempts += 1;
          scheduleReconcile(500 * restartAttempts);
        }
      });

      child.on('error', (error) => {
        if (helperProc !== child) return;
        api.log.error('启动桌面跟随 helper 失败', error);
        helperProc = null;
      });

      return true;
    } catch (error) {
      api.log.error('无法创建桌面跟随 helper 进程', error);
      return false;
    }
  }

  function findMainWindow() {
    if (!electron?.BrowserWindow) return null;
    const allWindows = electron.BrowserWindow.getAllWindows();
    const exact = allWindows.find(
      (win) =>
        !win.isDestroyed() &&
        typeof win.__wallpaperGeometry === 'boolean' &&
        typeof win.__transparentFullscreen === 'boolean'
    );
    if (exact) return exact;
    return allWindows.find((win) => isFoliaMainWindow(win)) || null;
  }

  function unbindTrackedWindow() {
    if (trackedWinCleanup) {
      trackedWinCleanup();
      trackedWinCleanup = null;
    }
    trackedWin = null;
  }

  function bindTrackedWindow(win) {
    if (trackedWin === win) return;
    unbindTrackedWindow();
    if (!win || win.isDestroyed()) return;
    trackedWin = win;

    const onBlur = () => {
      if (settings.enabled && !pausedReason) {
        sendHelperLine('SINK');
      }
    };
    const onShow = () => {
      if (settings.enabled) {
        scheduleReconcile(40);
      }
    };
    const onRestore = () => {
      if (settings.enabled && !pausedReason) {
        sendHelperLine('SINK');
      }
    };
    const onAlwaysOnTopChanged = (_event, isOnTop) => {
      if (isOnTop && !isEnablingFollow && settings.enabled) {
        disableFollowForMutualExclusion({ refreshTray: true });
      }
    };
    const onClosed = () => {
      if (trackedWin === win) {
        unbindTrackedWindow();
        trackedHwnd = null;
        sendHelperLine('DETACH');
        scheduleReconcile(120);
      }
    };

    win.on('blur', onBlur);
    win.on('show', onShow);
    win.on('restore', onRestore);
    win.on('always-on-top-changed', onAlwaysOnTopChanged);
    win.on('closed', onClosed);

    trackedWinCleanup = () => {
      if (!win.isDestroyed()) {
        win.removeListener('blur', onBlur);
        win.removeListener('show', onShow);
        win.removeListener('restore', onRestore);
        win.removeListener('always-on-top-changed', onAlwaysOnTopChanged);
        win.removeListener('closed', onClosed);
      }
    };
  }

  function scheduleReconcile(delayMs = 60) {
    if (disposed) return;
    if (reattachTimer) clearTimeout(reattachTimer);
    reattachTimer = setTimeout(() => {
      reattachTimer = null;
      reconcile({ explicitEnable: false });
    }, delayMs);
  }

  function reconcile({ explicitEnable = false } = {}) {
    if (disposed) return;
    if (!isWindows || !electron) {
      pausedReason = 'unsupported_platform';
      return;
    }
    if (!settings.enabled) {
      pausedReason = 'disabled';
      stopHelper();
      return;
    }

    const win = findMainWindow();
    if (!win || win.isDestroyed()) {
      pausedReason = 'no_window';
      trackedHwnd = null;
      sendHelperLine('DETACH');
      return;
    }

    bindTrackedWindow(win);

    if (win.__wallpaperGeometry === true) {
      pausedReason = 'wallpaper_mode';
      trackedHwnd = null;
      sendHelperLine('DETACH');
      return;
    }

    if (win.isAlwaysOnTop()) {
      if (explicitEnable) {
        disableHostAlwaysOnTop(win);
      } else {
        disableFollowForMutualExclusion({ refreshTray: true });
        return;
      }
      if (win.isAlwaysOnTop()) {
        disableFollowForMutualExclusion({ refreshTray: true });
        return;
      }
    }

    const hwnd = readNativeHwnd(win);
    if (!hwnd) {
      pausedReason = 'invalid_hwnd';
      return;
    }

    if (!ensureHelperRunning()) {
      return;
    }

    pausedReason = null;
    const toolFlag = 1;
    const preventMinFlag = settings.preventWinDMinimize ? 1 : 0;

    if (trackedHwnd !== hwnd) {
      trackedHwnd = hwnd;
      sendHelperLine(`ATTACH ${hwnd} ${process.pid} ${toolFlag} ${preventMinFlag}`);
    } else {
      sendHelperLine(`CONFIG ${toolFlag} ${preventMinFlag}`);
      sendHelperLine('SINK');
    }
  }

  function buildStatus() {
    return {
      supported: isWindows && Boolean(electron),
      helperPresent: fs.existsSync(helperPath),
      enabled: settings.enabled,
      halfClickThrough: settings.halfClickThrough,
      active: Boolean(settings.enabled && !pausedReason && trackedHwnd),
      pausedReason,
      phase: lastPhase,
      hwnd: trackedHwnd,
      desktopHost: lastDesktopHost,
    };
  }

  const onWindowCreated = (_event, win) => {
    if (disposed) return;
    if (!win || win.isDestroyed()) return;
    const checkAttach = () => {
      if (disposed || win.isDestroyed()) return;
      if (isFoliaMainWindow(win)) {
        appliedMouseIgnore = false;
        bootstrappedWebContentsId = null;
        triggerTrayRefresh();
        reconcile({ explicitEnable: false });
        reconcileHalfClickThrough({ explicitEnable: false });
      }
    };
    if (isFoliaMainWindow(win)) {
      appliedMouseIgnore = false;
      bootstrappedWebContentsId = null;
      scheduleReconcile(50);
    } else {
      win.once('ready-to-show', checkAttach);
      win.webContents?.once('did-finish-load', checkAttach);
    }
  };

  if (electron?.app) {
    electron.app.on('browser-window-created', onWindowCreated);
  }
  if (isWindows && electron) {
    installTrayMenuPatch();
    triggerTrayRefresh();
  }

  api.rpc.handle(RPC.syncSettings, (payload) => {
    const wasEnabled = settings.enabled;
    const wasHalf = settings.halfClickThrough;
    settings = normalizeSettings(payload);
    const explicitEnable = clientSynced && !wasEnabled && settings.enabled;
    const explicitEnableHalf = clientSynced && !wasHalf && settings.halfClickThrough;
    clientSynced = true;
    isEnablingFollow = explicitEnable;
    isEnablingHalfClickThrough = explicitEnableHalf;
    try {
      reconcile({ explicitEnable });
      reconcileHalfClickThrough({ explicitEnable: explicitEnableHalf });
    } finally {
      isEnablingFollow = false;
      isEnablingHalfClickThrough = false;
    }
    triggerTrayRefresh();
    return buildStatus();
  });

  api.rpc.handle(RPC.getStatus, () => buildStatus());

  api.rpc.handle(RPC.sinkNow, () => {
    if (!settings.enabled) {
      return { ...buildStatus(), ok: false };
    }
    isEnablingFollow = true;
    try {
      reconcile({ explicitEnable: true });
    } finally {
      isEnablingFollow = false;
    }
    if (!pausedReason) {
      sendHelperLine('SINK');
    }
    triggerTrayRefresh();
    return { ...buildStatus(), ok: !pausedReason };
  });

  if (isWindows && electron) {
    setTimeout(() => {
      if (!disposed) {
        triggerTrayRefresh();
      }
    }, 150);
  }

  api.onDispose(() => {
    disposed = true;
    if (electron?.app) {
      electron.app.removeListener('browser-window-created', onWindowCreated);
    }
    stopCursorPoll();
    resetMouseIgnoreIfOwned({ force: true });
    uninstallTrayMenuPatch();
    unbindTrackedWindow();
    stopHelper();
  });
};

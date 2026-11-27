'use strict';

const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const RPC = {
  syncSettings: 'syncSettings',
  getStatus: 'getStatus',
  stateSync: 'stateSync',
  cursorProbe: 'cursorProbe',
  probeResult: 'probeResult',
};

const DEFAULT_SETTINGS = {
  enabled: false,
  halfClickThrough: false,
  preventWinDMinimize: true,
};

function loadElectron() {
  try {
    return require('electron');
  } catch {
    return null;
  }
}

function readNativeHwnd(win) {
  try {
    const buf = win.getNativeWindowHandle();
    if (!Buffer.isBuffer(buf) || buf.length < 4) return null;
    if (buf.length >= 8 && typeof buf.readBigUInt64LE === 'function') {
      return buf.readBigUInt64LE(0).toString(10);
    }
    return String(buf.readUInt32LE(0));
  } catch {
    return null;
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

function normalizeWindowHint(raw) {
  if (!raw || typeof raw !== 'object') return null;
  return {
    title: typeof raw.title === 'string' ? raw.title.trim() : '',
    width: Number.isFinite(Number(raw.width)) ? Number(raw.width) : 0,
    height: Number.isFinite(Number(raw.height)) ? Number(raw.height) : 0,
  };
}

function resolvePowershellPath() {
  const systemRoot = process.env.SystemRoot || 'C:\\Windows';
  return path.join(systemRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
}

function isCandidateMainWindow(win) {
  if (!win || win.isDestroyed()) return false;
  const wc = win.webContents;
  if (!wc || wc.isDestroyed()) return false;
  if (typeof wc.getType === 'function' && wc.getType() !== 'window') return false;
  if (typeof win.getParentWindow === 'function' && win.getParentWindow()) return false;
  try {
    const url = typeof wc.getURL === 'function' ? String(wc.getURL() || '') : '';
    if (/^(devtools|chrome-devtools):/i.test(url)) return false;
  } catch {
    return false;
  }
  return true;
}

module.exports = function activate(api) {
  const isWindows = process.platform === 'win32';
  const electron = isWindows ? loadElectron() : null;
  const helperScriptPath = path.join(__dirname, 'helper', 'desktop-follow-helper.ps1');
  const powershellPath = resolvePowershellPath();

  let disposed = false;
  let settings = { ...DEFAULT_SETTINGS };
  let clientWindowHint = null;
  let clientSynced = false;

  let helperProc = null;
  let helperReady = false;
  let helperStdoutBuf = '';
  let queuedHelperLines = [];
  let restartAttempts = 0;

  let trackedWin = null;
  let trackedHwnd = null;
  let trackedWinCleanup = null;
  let lastPhase = 'idle';
  let lastDesktopHost = '0';
  let pausedReason = null;
  let reattachTimer = null;
  let isEnablingFollow = false;

  let appliedMouseIgnore = false;
  let cursorPollTimer = null;
  let probeInFlight = false;
  let nextHelperProbeSeq = 1;
  let nextClientProbeSeq = 1;
  const pendingHelperProbes = new Map();
  const pendingClientProbes = new Map();

  function notifyClientState(patch) {
    if (typeof api.rpc?.send !== 'function') return;
    try {
      api.rpc.send(RPC.stateSync, patch);
    } catch (error) {
      api.log.warn('向渲染进程同步状态失败', error);
    }
  }

  function scoreMainWindowCandidate(win) {
    let score = 0;
    let title = '';
    try {
      title = typeof win.getTitle === 'function' ? String(win.getTitle() || '').trim() : '';
    } catch {
      title = '';
    }

    if (clientWindowHint?.title && title === clientWindowHint.title) {
      score += 100;
    }
    if (/^folia\b/i.test(title)) {
      score += 60;
    } else if (/folia/i.test(title)) {
      score += 30;
    }

    try {
      if (win.isVisible()) score += 20;
      const bounds = win.getContentBounds();
      if (bounds && bounds.width > 0 && bounds.height > 0) {
        if (clientWindowHint && clientWindowHint.width > 0 && clientWindowHint.height > 0) {
          const dw = Math.abs(bounds.width - clientWindowHint.width);
          const dh = Math.abs(bounds.height - clientWindowHint.height);
          if (dw <= 4 && dh <= 4) {
            score += 40;
          } else if (dw <= 40 && dh <= 40) {
            score += 15;
          }
        }
        score += Math.min(20, Math.floor((bounds.width * bounds.height) / 100000));
      }
    } catch {
      // ignore bounds error
    }
    return score;
  }

  function findMainWindow() {
    if (!electron?.BrowserWindow) return null;
    const candidates = electron.BrowserWindow.getAllWindows().filter((win) => isCandidateMainWindow(win));
    if (candidates.length === 0) return null;
    if (candidates.length === 1) return candidates[0];

    let best = candidates[0];
    let bestScore = scoreMainWindowCandidate(best);
    for (let i = 1; i < candidates.length; i += 1) {
      const score = scoreMainWindowCandidate(candidates[i]);
      if (score > bestScore) {
        best = candidates[i];
        bestScore = score;
      }
    }
    return best;
  }

  function settlePendingMap(map, fallbackValue) {
    for (const entry of map.values()) {
      clearTimeout(entry.timer);
      entry.resolve(fallbackValue);
    }
    map.clear();
  }

  function writeLineToHelper(line) {
    if (!helperProc || helperProc.killed || !helperProc.stdin || helperProc.stdin.destroyed) {
      return false;
    }
    try {
      helperProc.stdin.write(line + '\n');
      return true;
    } catch {
      return false;
    }
  }

  function sendHelperLine(line) {
    if (!helperProc || helperProc.killed) return false;
    if (!helperReady) {
      queuedHelperLines.push(line);
      if (queuedHelperLines.length > 32) {
        queuedHelperLines.shift();
      }
      return true;
    }
    return writeLineToHelper(line);
  }

  function flushQueuedHelperLines() {
    if (!helperReady || queuedHelperLines.length === 0) return;
    const batch = queuedHelperLines;
    queuedHelperLines = [];
    for (const line of batch) {
      writeLineToHelper(line);
    }
  }

  function stopHelper() {
    settlePendingMap(pendingHelperProbes, null);
    queuedHelperLines = [];
    helperReady = false;
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
        proc.stdin.write('QUIT\n');
        proc.stdin.end();
      }
    } catch {
      // ignore shutdown write errors
    }
    setTimeout(() => {
      try {
        if (!proc.killed) proc.kill();
      } catch {
        // ignore
      }
    }, 300).unref();
  }

  function detachDesktopFollow() {
    trackedHwnd = null;
    lastPhase = 'idle';
    if (helperProc && !helperProc.killed) {
      sendHelperLine('DETACH');
    }
    if (!settings.halfClickThrough) {
      stopHelper();
    }
  }

  function handleHelperEvent(msg) {
    if (!msg || typeof msg !== 'object') return;
    if (msg.event === 'probe') {
      const seq = Number(msg.seq);
      const pending = pendingHelperProbes.get(seq);
      if (pending) {
        pendingHelperProbes.delete(seq);
        clearTimeout(pending.timer);
        pending.resolve({
          status: String(msg.status || 'unknown'),
          hitHwnd: String(msg.hitHwnd ?? '0'),
        });
      }
      return;
    }
    if (msg.event === 'ready') {
      helperReady = true;
      restartAttempts = 0;
      flushQueuedHelperLines();
      return;
    }
    if (msg.event === 'attached') {
      restartAttempts = 0;
      if (msg.desktopHost) {
        lastDesktopHost = String(msg.desktopHost);
      }
      return;
    }
    if (msg.event === 'state') {
      lastPhase = String(msg.phase || 'idle');
      if (msg.desktopHost) {
        lastDesktopHost = String(msg.desktopHost);
      }
      return;
    }
    if (msg.event === 'detached') {
      lastPhase = 'idle';
      return;
    }
    if (msg.event === 'error') {
      api.log.warn(`桌面跟随辅助脚本报错: ${msg.message || 'unknown'}`);
    }
  }

  function ensureHelperRunning() {
    if (disposed || !isWindows) return false;
    if (helperProc && !helperProc.killed) return true;
    if (!fs.existsSync(helperScriptPath)) {
      api.log.error(`未找到桌面跟随辅助脚本: ${helperScriptPath}`);
      if (settings.enabled) {
        pausedReason = 'missing_helper';
      }
      return false;
    }
    if (!fs.existsSync(powershellPath)) {
      api.log.error(`未找到系统 PowerShell: ${powershellPath}`);
      if (settings.enabled) {
        pausedReason = 'missing_helper';
      }
      return false;
    }

    try {
      const child = spawn(
        powershellPath,
        [
          '-NoProfile',
          '-NonInteractive',
          '-ExecutionPolicy',
          'Bypass',
          '-WindowStyle',
          'Hidden',
          '-File',
          helperScriptPath,
        ],
        {
          stdio: ['pipe', 'pipe', 'pipe'],
          windowsHide: true,
        }
      );
      helperProc = child;
      helperReady = false;
      helperStdoutBuf = '';
      queuedHelperLines = [];

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
        settlePendingMap(pendingHelperProbes, null);
        helperProc = null;
        helperReady = false;
        queuedHelperLines = [];
        trackedHwnd = null;
        lastPhase = 'idle';
        if (disposed || (!settings.enabled && !settings.halfClickThrough)) return;
        api.log.warn(`桌面跟随辅助脚本意外退出 (code=${code}, signal=${signal})`);
        if (restartAttempts < 3) {
          restartAttempts += 1;
          scheduleReconcile(500 * restartAttempts);
        }
      });

      child.on('error', (error) => {
        if (helperProc !== child) return;
        api.log.error('启动桌面跟随辅助脚本失败', error);
        helperProc = null;
        helperReady = false;
      });

      return true;
    } catch (error) {
      api.log.error('无法启动桌面跟随辅助脚本进程', error);
      return false;
    }
  }

  function probeCursorVisibility(hwnd) {
    if (!hwnd || disposed || !isWindows) {
      return Promise.resolve(null);
    }
    if (!ensureHelperRunning() || !helperReady) {
      return Promise.resolve(null);
    }
    const seq = nextHelperProbeSeq++;
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        pendingHelperProbes.delete(seq);
        resolve(null);
      }, 120);
      if (typeof timer.unref === 'function') {
        timer.unref();
      }
      pendingHelperProbes.set(seq, { resolve, timer });
      if (!writeLineToHelper(`PROBE ${seq} ${hwnd}`)) {
        pendingHelperProbes.delete(seq);
        clearTimeout(timer);
        resolve(null);
      }
    });
  }

  function probeClientHitTest(normX, normY) {
    if (disposed || typeof api.rpc?.send !== 'function') {
      return Promise.resolve(null);
    }
    const seq = nextClientProbeSeq++;
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        pendingClientProbes.delete(seq);
        resolve(null);
      }, 150);
      if (typeof timer.unref === 'function') {
        timer.unref();
      }
      pendingClientProbes.set(seq, { resolve, timer });
      try {
        api.rpc.send(RPC.cursorProbe, { seq, normX, normY });
      } catch {
        pendingClientProbes.delete(seq);
        clearTimeout(timer);
        resolve(null);
      }
    });
  }

  function applyHalfClickThroughIgnore(ignore) {
    const win = findMainWindow();
    if (!win || win.isDestroyed()) {
      appliedMouseIgnore = false;
      return false;
    }
    const nextIgnore = Boolean(ignore) && Boolean(settings.halfClickThrough);
    if (appliedMouseIgnore === nextIgnore) {
      return true;
    }
    try {
      if (nextIgnore) {
        win.setIgnoreMouseEvents(true);
        if (win.webContents && !win.webContents.isDestroyed()) {
          try {
            win.webContents.sendInputEvent({ type: 'mouseLeave', x: -1, y: -1 });
          } catch {
            // ignore input event dispatch failures
          }
        }
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
    const win = findMainWindow();
    if (!win || win.isDestroyed()) return;
    try {
      win.setIgnoreMouseEvents(false);
    } catch (error) {
      api.log.warn('还原鼠标忽略状态失败', error);
    }
  }

  function stopCursorPoll() {
    if (cursorPollTimer) {
      clearInterval(cursorPollTimer);
      cursorPollTimer = null;
    }
    probeInFlight = false;
    settlePendingMap(pendingClientProbes, null);
  }

  async function pollHalfClickThroughCursor() {
    if (disposed || !settings.halfClickThrough) {
      stopCursorPoll();
      return;
    }
    if (probeInFlight) return;

    const win = findMainWindow();
    if (!win || win.isDestroyed() || !win.webContents || win.webContents.isDestroyed()) {
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
      return;
    }

    const hwnd = readNativeHwnd(win);
    const normX = (cursor.x - bounds.x) / bounds.width;
    const normY = (cursor.y - bounds.y) / bounds.height;
    probeInFlight = true;
    try {
      const visibility = await probeCursorVisibility(hwnd);
      if (disposed || !settings.halfClickThrough) {
        return;
      }
      if (visibility && visibility.status !== 'visible') {
        applyHalfClickThroughIgnore(true);
        return;
      }
      if (!visibility && !win.isFocused()) {
        applyHalfClickThroughIgnore(true);
        return;
      }

      const interactive = await probeClientHitTest(normX, normY);
      if (disposed || !settings.halfClickThrough) {
        return;
      }
      if (typeof interactive === 'boolean') {
        applyHalfClickThroughIgnore(!interactive);
      }
    } finally {
      probeInFlight = false;
    }
  }

  function startCursorPoll() {
    if (cursorPollTimer || disposed || !isWindows || !electron) return;
    ensureHelperRunning();
    cursorPollTimer = setInterval(() => {
      void pollHalfClickThroughCursor();
    }, 35);
    if (typeof cursorPollTimer.unref === 'function') {
      cursorPollTimer.unref();
    }
    void pollHalfClickThroughCursor();
  }

  function reconcileHalfClickThrough() {
    if (disposed || !isWindows || !electron) return;
    const win = findMainWindow();
    if (!settings.halfClickThrough) {
      stopCursorPoll();
      resetMouseIgnoreIfOwned({ force: true });
      if (!settings.enabled) {
        stopHelper();
      }
      return;
    }
    if (!win || win.isDestroyed()) {
      appliedMouseIgnore = false;
      stopCursorPoll();
      if (!settings.enabled) {
        stopHelper();
      }
      return;
    }
    startCursorPoll();
  }

  function disableFollowForAlwaysOnTop() {
    if (!settings.enabled) return;
    settings = { ...settings, enabled: false };
    pausedReason = 'always_on_top';
    detachDesktopFollow();
    notifyClientState({ enabled: false, reason: 'always_on_top' });
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
        disableFollowForAlwaysOnTop();
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
      reconcileHalfClickThrough();
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
      detachDesktopFollow();
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

    if (win.isAlwaysOnTop()) {
      if (explicitEnable) {
        try {
          win.setAlwaysOnTop(false);
        } catch (error) {
          api.log.warn('关闭窗口置顶失败', error);
        }
      }
      if (win.isAlwaysOnTop()) {
        disableFollowForAlwaysOnTop();
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
      helperPresent: fs.existsSync(helperScriptPath),
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
    if (disposed || !win || win.isDestroyed()) return;
    const checkAttach = () => {
      if (disposed || win.isDestroyed()) return;
      if (isCandidateMainWindow(win)) {
        appliedMouseIgnore = false;
        reconcile({ explicitEnable: false });
        reconcileHalfClickThrough();
      }
    };
    if (isCandidateMainWindow(win)) {
      appliedMouseIgnore = false;
      scheduleReconcile(50);
    } else {
      win.once('ready-to-show', checkAttach);
      win.webContents?.once('did-finish-load', checkAttach);
    }
  };

  if (electron?.app) {
    electron.app.on('browser-window-created', onWindowCreated);
  }

  api.rpc.handle(RPC.syncSettings, (payload) => {
    const wasEnabled = settings.enabled;
    settings = normalizeSettings(payload);
    if (payload && typeof payload === 'object' && payload.windowHint) {
      clientWindowHint = normalizeWindowHint(payload.windowHint);
    }
    const explicitEnable = clientSynced && !wasEnabled && settings.enabled;
    clientSynced = true;
    isEnablingFollow = explicitEnable;
    try {
      reconcile({ explicitEnable });
      reconcileHalfClickThrough();
    } finally {
      isEnablingFollow = false;
    }
    return buildStatus();
  });

  api.rpc.handle(RPC.getStatus, () => buildStatus());

  api.rpc.handle(RPC.probeResult, (payload) => {
    if (!payload || typeof payload !== 'object') return;
    const seq = Number(payload.seq);
    const pending = pendingClientProbes.get(seq);
    if (pending) {
      pendingClientProbes.delete(seq);
      clearTimeout(pending.timer);
      pending.resolve(Boolean(payload.interactive));
    }
  });

  api.onDispose(() => {
    disposed = true;
    if (electron?.app) {
      electron.app.removeListener('browser-window-created', onWindowCreated);
    }
    stopCursorPoll();
    resetMouseIgnoreIfOwned({ force: true });
    unbindTrackedWindow();
    stopHelper();
  });
};

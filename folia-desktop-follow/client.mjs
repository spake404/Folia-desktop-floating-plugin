const RPC = {
  syncSettings: 'syncSettings',
  getStatus: 'getStatus',
  stateSync: 'stateSync',
  cursorProbe: 'cursorProbe',
  probeResult: 'probeResult',
};

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
].join(',');

const MODAL_SELECTOR = [
  '[role="dialog"]',
  '[aria-modal="true"]',
  '[role="menu"]',
  '[role="listbox"]',
  '[role="alertdialog"]',
].join(',');

const INTERACTIVE_CURSORS = new Set([
  'pointer',
  'grab',
  'grabbing',
  'move',
  'text',
  'ew-resize',
  'ns-resize',
  'nwse-resize',
  'nesw-resize',
  'col-resize',
  'row-resize',
]);

function parseAlpha(color) {
  if (!color || color === 'transparent') return 0;
  const match = /^rgba\(\s*[\d.]+\s*,\s*[\d.]+\s*,\s*[\d.]+\s*,\s*([\d.]+)\s*\)$/i.exec(color);
  if (match) return Number(match[1]) || 0;
  if (/^rgb\(/i.test(color)) return 1;
  return 0;
}

function hasVisibleSurface(style) {
  if (parseAlpha(style.backgroundColor) >= 0.08) return true;
  const backdrop = style.backdropFilter || style.webkitBackdropFilter || '';
  return Boolean(backdrop && backdrop !== 'none');
}

function isElementInteractive(el) {
  if (!(el instanceof Element)) return false;
  const tag = el.tagName;
  if (tag === 'HTML' || tag === 'BODY' || el.id === 'root') return false;

  const style = window.getComputedStyle(el);
  if (style.pointerEvents === 'none' || style.visibility === 'hidden' || style.display === 'none') {
    return false;
  }
  const opacity = Number(style.opacity);
  if (!Number.isNaN(opacity) && opacity <= 0.02) return false;

  if (el.matches(MODAL_SELECTOR) || el.matches(INTERACTIVE_SELECTOR)) return true;

  const appRegion = (style.webkitAppRegion || style.getPropertyValue('-webkit-app-region') || '').trim();
  if (appRegion === 'drag') return true;

  if (tag === 'CANVAS' || tag === 'VIDEO') return false;

  const rect = el.getBoundingClientRect();
  if (rect.width <= 0 || rect.height <= 0) return false;

  const isViewportSized =
    rect.width >= window.innerWidth * 0.82 && rect.height >= window.innerHeight * 0.82;

  if (isViewportSized) {
    if (parseAlpha(style.backgroundColor) >= 0.6 && el.querySelector(INTERACTIVE_SELECTOR)) {
      return true;
    }
    return false;
  }

  if (INTERACTIVE_CURSORS.has(style.cursor)) return true;
  const tabIndex = el.getAttribute('tabindex');
  if (tabIndex !== null && tabIndex !== '-1') return true;
  if ((style.overflowY === 'auto' || style.overflowY === 'scroll') && el.scrollHeight > el.clientHeight + 4) {
    return true;
  }
  if ((style.overflowX === 'auto' || style.overflowX === 'scroll') && el.scrollWidth > el.clientWidth + 4) {
    return true;
  }
  if (rect.width >= 16 && rect.height >= 16 && hasVisibleSurface(style) && el.querySelector(INTERACTIVE_SELECTOR)) {
    return true;
  }
  return false;
}

function formatPauseHint(reason) {
  switch (reason) {
    case 'always_on_top':
      return '当前开启了「窗口置顶」，请先关闭置顶';
    case 'missing_helper':
      return '缺少桌面跟随辅助脚本（helper/desktop-follow-helper.ps1）';
    case 'unsupported_platform':
      return '当前仅支持 Windows 平台';
    default:
      return null;
  }
}

function readWindowHint() {
  return {
    title: typeof document !== 'undefined' ? String(document.title || '') : '',
    width: typeof window !== 'undefined' ? Number(window.innerWidth || 0) : 0,
    height: typeof window !== 'undefined' ? Number(window.innerHeight || 0) : 0,
  };
}

/** @param {any} folium */
export default function activate(folium) {
  const runtimeContext = folium?.env?.context ?? folium?.context;
  if (runtimeContext !== 'main') {
    return;
  }

  let pointerPressed = false;
  const onPointerDown = () => {
    pointerPressed = true;
  };
  const onPointerUp = () => {
    pointerPressed = false;
  };
  const onMouseMove = (event) => {
    pointerPressed = Boolean(event && event.buttons !== 0);
  };

  window.addEventListener('pointerdown', onPointerDown, true);
  window.addEventListener('pointerup', onPointerUp, true);
  window.addEventListener('mouseup', onPointerUp, true);
  window.addEventListener('pointercancel', onPointerUp, true);
  window.addEventListener('blur', onPointerUp, true);
  window.addEventListener('mousemove', onMouseMove, true);

  const evaluateHitTest = (normX, normY) => {
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    if (pointerPressed) return true;
    if (!Number.isFinite(normX) || !Number.isFinite(normY) || vw <= 0 || vh <= 0) {
      return false;
    }
    const x = Math.round(normX * vw);
    const y = Math.round(normY * vh);
    if (x < 0 || y < 0 || x >= vw || y >= vh) return false;
    if (x <= 4 || y <= 4 || x >= vw - 5 || y >= vh - 5) return true;
    const stack = document.elementsFromPoint(x, y);
    for (const el of stack) {
      if (isElementInteractive(el)) return true;
    }
    return false;
  };

  const sectionHandle = folium.registries.settingsSections.register({
    id: 'desktop-follow',
    label: {
      'zh-CN': '桌面跟随悬浮',
      'en-US': 'Desktop Follow Floating',
    },
    description: {
      'zh-CN': '通过模组设置与全局快捷键控制 Folia 跟随桌面显示与按区域智能半穿透：保留透明背景与自由尺寸，Win+D 无闪烁，点击窗口临时浮起，点别处自动退回桌面层。',
      'en-US': 'Anchor Folia to the Windows desktop with transparent background, free sizing, zero-flash Win+D, and smart click-through via mod settings and global shortcuts.',
    },
    settings: [
      {
        key: 'enabled',
        type: 'boolean',
        defaultValue: false,
        label: {
          'zh-CN': '跟随桌面',
          'en-US': 'Follow Desktop',
        },
        description: {
          'zh-CN': '让 Folia 窗口紧贴桌面显示（含 Win+D 零闪烁），与其他窗口互斥于「窗口置顶」。可在快捷键设置中为「切换桌面跟随悬浮」绑定全局快捷键。',
          'en-US': 'Keep Folia anchored to the desktop (zero-flash Win+D); mutually exclusive with Always on Top.',
        },
      },
      {
        key: 'halfClickThrough',
        type: 'boolean',
        defaultValue: false,
        label: {
          'zh-CN': '半穿透（空白处穿透，控件可点）',
          'en-US': 'Smart Click-Through',
        },
        description: {
          'zh-CN': '鼠标位于按钮、进度条、标题栏拖拽区或弹窗等可操作区域时正常响应点击，位于透明空白处或被前景软件遮挡时自动穿透。可为「切换半穿透」绑定全局快捷键。',
          'en-US': 'Keeps interactive controls clickable while passing clicks through transparent empty areas and occluded regions.',
        },
      },
      {
        key: 'preventWinDMinimize',
        type: 'boolean',
        defaultValue: true,
        label: {
          'zh-CN': 'Win+D 显示桌面时保持显示',
          'en-US': 'Stay Visible on Win+D (Show Desktop)',
        },
        description: {
          'zh-CN': '按下 Win+D 或点击任务栏右下角“显示桌面”时，防止 Folia 被一起最小化隐藏。',
          'en-US': 'Prevent Folia from staying minimized when showing the desktop via Win+D.',
        },
      },
    ],
  });

  const pushSettings = async ({ notify = false } = {}) => {
    if (!folium.rpc || typeof folium.rpc.call !== 'function') {
      return null;
    }
    try {
      const values = sectionHandle.settings.get();
      const status = await folium.rpc.call(RPC.syncSettings, {
        ...values,
        windowHint: readWindowHint(),
      });
      if (notify && status) {
        if (!values.enabled) {
          folium.ui.toast('已关闭跟随桌面', { type: 'info' });
        } else if (status.pausedReason) {
          const hint = formatPauseHint(status.pausedReason);
          folium.ui.toast(hint || '跟随桌面已暂停', { type: 'info' });
        } else {
          folium.ui.toast('已开启跟随桌面（点击窗口临时浮起，点别处退回桌面）', { type: 'success' });
        }
      }
      return status;
    } catch (error) {
      folium.log.warn('同步桌面跟随配置失败', error);
      return null;
    }
  };

  const offSettings = sectionHandle.settings.onChange(() => {
    void pushSettings({ notify: false });
  });

  const offStateSync =
    typeof folium.rpc?.on === 'function'
      ? folium.rpc.on(RPC.stateSync, (payload) => {
          if (!payload || typeof payload !== 'object') return;
          const current = sectionHandle.settings.get();
          const patch = {};
          if (typeof payload.enabled === 'boolean' && Boolean(current.enabled) !== payload.enabled) {
            patch.enabled = payload.enabled;
          }
          if (
            typeof payload.halfClickThrough === 'boolean' &&
            Boolean(current.halfClickThrough) !== payload.halfClickThrough
          ) {
            patch.halfClickThrough = payload.halfClickThrough;
          }
          if (Object.keys(patch).length > 0) {
            sectionHandle.settings.set(patch);
          }
        })
      : () => {};

  const offCursorProbe =
    typeof folium.rpc?.on === 'function'
      ? folium.rpc.on(RPC.cursorProbe, (payload) => {
          if (!payload || typeof payload !== 'object') return;
          const seq = Number(payload.seq);
          if (!Number.isFinite(seq)) return;
          const interactive = evaluateHitTest(Number(payload.normX), Number(payload.normY));
          void folium.rpc.call(RPC.probeResult, { seq, interactive }).catch(() => {});
        })
      : () => {};

  const toggleCmd = folium.registries.commands.register({
    id: 'toggle',
    label: {
      'zh-CN': '切换桌面跟随悬浮',
      'en-US': 'Toggle Desktop Follow Floating',
    },
    description: {
      'zh-CN': '开启或关闭 Folia 主窗口跟随桌面显示',
      'en-US': 'Enable or disable desktop-follow floating for Folia',
    },
    keywords: ['desktop', 'follow', 'float', '桌面', '跟随', '悬浮', '置底'],
    globalShortcut: true,
    async run() {
      const current = sectionHandle.settings.get();
      const nextEnabled = !current.enabled;
      sectionHandle.settings.set({ enabled: nextEnabled });
      const status = await pushSettings({ notify: true });
      if (!nextEnabled) {
        return '已关闭桌面跟随悬浮';
      }
      const hint = formatPauseHint(status?.pausedReason);
      return hint || '已开启桌面跟随悬浮';
    },
  });

  const toggleHalfCmd = folium.registries.commands.register({
    id: 'toggle-half-click-through',
    label: {
      'zh-CN': '切换半穿透',
      'en-US': 'Toggle Smart Click-Through',
    },
    description: {
      'zh-CN': '开启或关闭半穿透（可操作区域正常点击，空白处自动穿透）',
      'en-US': 'Toggle smart click-through (interactive UI clickable, empty area passes through)',
    },
    keywords: ['half', 'click-through', 'passthrough', '半穿透', '穿透'],
    globalShortcut: true,
    async run() {
      const current = sectionHandle.settings.get();
      const nextHalf = !current.halfClickThrough;
      sectionHandle.settings.set({ halfClickThrough: nextHalf });
      await pushSettings({ notify: false });
      const text = nextHalf ? '已开启半穿透（空白处穿透，控件可点）' : '已关闭半穿透';
      folium.ui.toast(text, { type: nextHalf ? 'success' : 'info' });
      return text;
    },
  });

  void pushSettings({ notify: false });

  return () => {
    window.removeEventListener('pointerdown', onPointerDown, true);
    window.removeEventListener('pointerup', onPointerUp, true);
    window.removeEventListener('mouseup', onPointerUp, true);
    window.removeEventListener('pointercancel', onPointerUp, true);
    window.removeEventListener('blur', onPointerUp, true);
    window.removeEventListener('mousemove', onMouseMove, true);
    offSettings();
    offStateSync();
    offCursorProbe();
    toggleCmd.unregister();
    toggleHalfCmd.unregister();
    sectionHandle.unregister();
  };
}

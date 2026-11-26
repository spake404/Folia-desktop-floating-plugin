const RPC = {
  syncSettings: 'syncSettings',
  getStatus: 'getStatus',
  sinkNow: 'sinkNow',
  trayToggle: 'trayToggle',
};

function formatPauseHint(reason) {
  switch (reason) {
    case 'wallpaper_mode':
      return '当前处于壁纸模式，桌面跟随已自动暂停';
    case 'always_on_top':
      return '当前开启了「窗口置顶」，请先关闭置顶';
    case 'missing_helper':
      return '缺少桌面跟随辅助程序（folia-desktop-follow-helper.exe）';
    case 'unsupported_platform':
      return '当前仅支持 Windows 平台';
    default:
      return null;
  }
}

/** @param {any} folium */
export default function activate(folium) {
  const runtimeContext = folium?.env?.context ?? folium?.context;
  if (runtimeContext !== 'main') {
    return;
  }

  const sectionHandle = folium.registries.settingsSections.register({
    id: 'desktop-follow',
    label: {
      'zh-CN': '桌面跟随悬浮',
      'en-US': 'Desktop Follow Floating',
    },
    description: {
      'zh-CN': '保留 Folia 透明背景与自由尺寸，让窗口紧贴桌面：桌面露出时一起显示（含 Win+D），被其他应用覆盖时一起被盖住；点击 Folia 临时浮起，点别处退回桌面层。',
      'en-US': 'Keep Folia anchored to the Windows desktop with transparent background and free sizing. Click Folia to rise temporarily; click elsewhere to sink back to the desktop.',
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
          'zh-CN': '与托盘右键菜单中的「跟随桌面」双向同步，且与「窗口置顶」互斥（开启其一自动关闭另一项）。',
          'en-US': 'Synced with the tray menu "Follow Desktop" toggle and mutually exclusive with Always on Top.',
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
          'zh-CN': '与托盘右键菜单中的「半穿透」双向同步，且与原生「点击穿透」互斥：鼠标位于按钮、进度条、标题栏或弹窗等可操作区域时正常响应，位于透明空白区域时自动穿透到后方桌面或软件。',
          'en-US': 'Passes clicks through empty areas while keeping interactive controls clickable; mutually exclusive with full Click-Through.',
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
      const status = await folium.rpc.call(RPC.syncSettings, values);
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

  const offTrayToggle =
    typeof folium.rpc?.on === 'function'
      ? folium.rpc.on(RPC.trayToggle, (payload) => {
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

  const sinkCmd = folium.registries.commands.register({
    id: 'sink-now',
    label: {
      'zh-CN': '立即退回桌面层',
      'en-US': 'Sink Folia to Desktop Layer',
    },
    description: {
      'zh-CN': '立即将 Folia 主窗口沉回桌面层（位于其他普通窗口下方）',
      'en-US': 'Immediately send Folia back behind ordinary windows onto the desktop layer',
    },
    keywords: ['sink', 'bottom', 'desktop', '置底', '退回桌面'],
    async run() {
      const current = sectionHandle.settings.get();
      if (!current.enabled) {
        sectionHandle.settings.set({ enabled: true });
      }
      const status = await folium.rpc.call(RPC.sinkNow, {});
      const hint = formatPauseHint(status?.pausedReason);
      if (hint) {
        folium.ui.toast(hint, { type: 'info' });
        return hint;
      }
      folium.ui.toast('Folia 已退回桌面层', { type: 'success' });
      return 'Folia 已退回桌面层';
    },
  });

  void pushSettings({ notify: false });

  return () => {
    offSettings();
    offTrayToggle();
    toggleCmd.unregister();
    toggleHalfCmd.unregister();
    sinkCmd.unregister();
    sectionHandle.unregister();
  };
}

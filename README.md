# Folia Desktop Floating Plugin (`folia-desktop-follow`)

为 [Folia](https://github.com/chthollyphile/folia-major) 打造的 Windows **桌面跟随悬浮** 与 **智能半穿透** 纯源码 Folium 模组。无预编译二进制、不修改 Folia 源码，完整保留透明背景、自由窗口尺寸与正常交互能力。

## 核心特性

- **跟随桌面**
  - 保留 Folia 的透明背景与自由尺寸，不使用会破坏 Electron 透明合成的 `SetParent` 注入。
  - 桌面露出（包括按下 `Win + D` 或点击任务栏右下角「显示桌面」）时，Folia 同步留在桌面上且**无最小化闪烁**；被其他普通窗口覆盖时自然退到后方。
  - 点击 Folia 切歌、调节进度或拖动窗口时临时浮起，点击其他应用或桌面空白处后自动沉回桌面层。
  - 开启期间默认应用桌面小组件窗口样式（`WS_EX_TOOLWINDOW`）并关闭 DWM 过渡动画（`DWMWA_TRANSITIONS_FORCEDISABLED`），关闭功能或卸载模组时自动恢复原窗口样式。
  - 兼容 [WitchDrawer](https://github.com/witchscottishfoldcat/WitchDrawer) 等桌面小组件，避免 Z 序互抢。
- **智能半穿透（按区域自动穿透 + 防前景遮挡）**
  - 鼠标悬停在按钮、滑块/进度条、标题栏拖拽区、弹窗、可滚动列表等可操作控件上时自动解除穿透，支持正常左键点击、拖拽与滚轮操作。
  - 鼠标位于透明空白区域、移出窗口或当前位置被其他前景软件遮挡时自动保持穿透，直接点击后方桌面或其他软件，不会在被遮挡时误触发悬停提示。
  - 高 DPI 缩放与页面缩放自适应，边缘保留 4px 区域方便调整无边框窗口大小。
- **模组设置页与全局快捷键（100% Folium 公开入口）**
  - 在 Folia 模组设置页提供「跟随桌面」「半穿透」「Win+D 显示桌面时保持显示」三个开关。
  - 注册了「切换桌面跟随悬浮」与「切换半穿透」两条命令，均支持在 Folia 快捷键设置中绑定全局快捷键。
  - 通过 Electron 公开接口与「窗口置顶」互斥（开启其一自动关闭另一项），切换「透明背景」重建窗口时自动重新附着。

## 实现原理

- **纯源码 Win32 辅助脚本（`folia-desktop-follow/helper/desktop-follow-helper.ps1`）**：由 Windows 系统自带 PowerShell 运行明文内嵌 C# P/Invoke，通过 `SetWinEventHook` 监听 `EVENT_SYSTEM_FOREGROUND`、`EVENT_SYSTEM_MINIMIZESTART..END` 以及 `EVENT_OBJECT_CREATE..REORDER`（覆盖桌面窗口与 `WorkerW` / `Progman` / `SHELLDLL_DefView`），0ms 锚定 Z 序到桌面宿主上方（`HWND_NOTOPMOST`），并提供基于 `WindowFromPoint` 与 Z 序的实时光标遮挡检测（无网络请求、无文件读写、无键盘/鼠标全局钩子）。
- **主进程 + 客户端公开 RPC 协同命中（`main.cjs` + `client.mjs`）**：主进程每 35ms 采样全局光标并先通过辅助脚本校验是否被前景窗口遮挡，确认可见后通过 Folium 公开 RPC（`api.rpc.send` / `folium.rpc.on`）将归一化坐标发给 `client.mjs`；`client.mjs` 仅使用标准 W3C DOM / ARIA / CSS 判断交互区域后回传结果，主进程按需切换 `win.setIgnoreMouseEvents(true)` / `win.setIgnoreMouseEvents(false)`（不开启 `{ forward: true }`，彻底避免被遮挡时弹出提示）。

## 安装与使用

### 环境要求

- Windows 10 / Windows 11（64 位）
- Folia `>= 0.7.22`（需在 Folia **设置 → 模组** 中开启「模组系统」与「社区模组」）

### 方式一：直接安装模组目录

1. 将本仓库中的 `folia-desktop-follow/` 文件夹整个复制到 Folia 模组目录：
   ```text
   %APPDATA%\Folia\mods\folia-desktop-follow
   ```
2. 打开 Folia **设置 → 模组 → 模组市场 → 更多操作（…）→ 重新加载模组**。
3. 在已安装列表中启用 **桌面跟随悬浮**，点击模组设置按需打开 **跟随桌面** 与 **半穿透**（建议配合 Folia 托盘中的 **透明背景** 使用），也可在快捷键设置中绑定全局快捷键。

### 方式二：校验、打包并安装到本机

前置依赖：Node.js 18+。

```powershell
# 校验模组脚本语法与文件完整性
npm run build

# 安装到本机 %APPDATA%\Folia\mods\folia-desktop-follow
npm run install:local

# （可选）打包可直接拖入 Folia 模组市场安装的 zip 包
npm run pack
```

## 目录结构

```text
.
├── folia-desktop-follow/                    # 可直接安装的纯源码 Folium 模组包
│   ├── mod.json                             # Folium 模组清单
│   ├── main.cjs                             # Electron 主进程入口（窗口管理、半穿透轮询、辅助脚本托管）
│   ├── client.mjs                           # 渲染进程入口（设置面板、快捷键命令、标准 DOM 命中检测）
│   ├── helper/
│   │   └── desktop-follow-helper.ps1        # 纯明文 PowerShell + C# Win32 桌面层锚定与遮挡检测脚本
│   ├── preview.png                          # 1280×720 模组预览图
│   ├── LICENSE                              # MIT 许可证
│   └── README.md                            # 模组内说明
├── scripts/
│   ├── build.mjs                            # 语法校验并可选打包 zip（--zip）
│   └── install-local.mjs                    # 一键同步安装到本机 Folia mods 目录
└── package.json
```

## 注意事项

- 开启 **「跟随桌面」** 时，为保证 `Win + D` 不触发最小化闪烁，Folia 会以工具窗口样式运行（不会显示在任务栏与 `Alt + Tab` 中，可通过桌面直接点击或系统托盘菜单操作）；关闭「跟随桌面」后立即恢复任务栏显示。
- 本模组仅支持 Windows 平台，在非 Windows 环境下会自动静默跳过。

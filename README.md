# Folia Desktop Floating Plugin (`folia-desktop-follow`)

为 [Folia](https://github.com/chthollyphile/folia-major) 打造的 Windows **桌面跟随悬浮** 与 **智能半穿透** Folium 模组。无需修改 Folia 源码，完整保留透明背景、自由窗口尺寸与正常交互能力。

## 核心特性

- **跟随桌面（零闪烁 `Win + D`）**
  - 保留 Folia 的透明背景与自由尺寸，不使用会破坏 Electron 透明合成的 `SetParent` 注入。
  - 桌面露出（包括按下 `Win + D` 或点击任务栏右下角「显示桌面」）时，Folia 同步留在桌面上且**无最小化闪烁**；被其他普通窗口覆盖时自然退到后方。
  - 点击 Folia 切歌、调节进度或拖动窗口时临时浮起，点击其他应用或桌面空白处后自动沉回桌面层。
  - 开启期间默认应用桌面小组件窗口样式（`WS_EX_TOOLWINDOW`）并关闭 DWM 过渡动画（`DWMWA_TRANSITIONS_FORCEDISABLED`），关闭功能或卸载模组时自动恢复原窗口样式。
  - 兼容 [WitchDrawer](https://github.com/witchscottishfoldcat/WitchDrawer) 等桌面小组件，避免 Z 序互抢。
- **智能半穿透（按区域自动穿透）**
  - 鼠标悬停在按钮、滑块/进度条、标题栏拖拽区、弹窗、可滚动列表或带交互事件的控件上时自动解除穿透，支持正常左键点击、拖拽与滚轮操作。
  - 鼠标位于透明空白区域或移出窗口后自动恢复穿透，直接点击后方的桌面图标或其他软件窗口。
  - 高 DPI 缩放与页面缩放自适应，边缘保留 4px 区域方便调整无边框窗口大小。
- **托盘右键菜单与设置页双向同步**
  - 在 Folia 系统托盘右键菜单自动注入两个独立开关：**「跟随桌面」**（位于「透明背景」下方）与 **「半穿透」**（位于「点击穿透」下方），卸载模组时自动还原菜单。
  - **自动互斥保护**：
    - 「跟随桌面」与原生「窗口置顶」双向互斥（开启其一自动关闭另一项）。
    - 「半穿透」与原生「点击穿透」双向互斥（开启其一自动关闭另一项）。
    - 切换「透明背景」重建窗口时自动重新附着；进入「壁纸模式」时自动暂停礼让。
- **命令面板与全局快捷键**
  - 注册了「切换桌面跟随悬浮」「切换半穿透」「立即退回桌面层」三条 Folium 命令，均支持在 Folia 内绑定全局快捷键。

## 实现原理

- **原生桌面层守护（`native/desktop-follow-helper`）**：零外部依赖的 Rust Win32 轻量辅助进程，通过 `SetWinEventHook` 监听 `EVENT_SYSTEM_FOREGROUND`、`EVENT_SYSTEM_MINIMIZESTART..END` 以及 `EVENT_OBJECT_CREATE..REORDER`（覆盖桌面窗口与 `WorkerW` / `Progman` / `SHELLDLL_DefView`），事件到达即 0ms 锚定 Z 序到桌面宿主上方（`HWND_NOTOPMOST` 防误提权）。
- **主进程实时 DOM 命中（`folia-desktop-follow/main.cjs`）**：每 35ms 采样全局光标相对主窗口内容区的归一化坐标，直接在主进程调用 `webContents.executeJavaScript` 查询光标下的真实 DOM 堆栈与计算样式，按需切换 `win.setIgnoreMouseEvents(true, { forward: true })` / `win.setIgnoreMouseEvents(false)`，避免渲染层 `mouseleave` 误触发与跨进程状态漂移。

## 安装与使用

### 环境要求

- Windows 10 / Windows 11（64 位）
- Folia `>= 0.7.22`（需在 Folia **设置 → 模组** 中开启「模组系统」与「社区模组」）

### 方式一：直接使用仓库内已编译模组

1. 将本仓库中的 `folia-desktop-follow/` 文件夹整个复制到 Folia 模组目录：
   ```text
   %APPDATA%\Folia\mods\folia-desktop-follow
   ```
2. 打开 Folia **设置 → 模组 → 模组市场 → 更多操作（…）→ 重新加载模组**。
3. 在已安装列表中启用 **桌面跟随悬浮** 并确认安全提示。
4. 右键系统托盘中的 Folia 图标，按需勾选 **透明背景**、**跟随桌面** 和 **半穿透**。

### 方式二：从源码编译并安装到本机

前置依赖：Node.js 18+、Rust 工具链（`cargo`）。

```powershell
# 编译 Rust 辅助程序并输出到 folia-desktop-follow/bin/
npm run build

# 安装到本机 %APPDATA%\Folia\mods\folia-desktop-follow
npm run install:local

# （可选）打包可直接拖入 Folia 模组市场安装的 zip 包
npm run pack
```

> 说明：每次更新本地模组代码后，Folia 会因文件指纹变更自动暂停该模组；在模组列表执行 **重新加载模组** 后重新点击 **启用 → 仍然启用** 即可。

## 目录结构

```text
.
├── folia-desktop-follow/              # 可直接安装的 Folium 模组包
│   ├── mod.json                       # Folium 模组清单
│   ├── main.cjs                       # Electron 主进程入口（托盘注入、半穿透命中轮询、helper 托管）
│   ├── client.mjs                     # 渲染进程入口（设置面板、命令注册、双向同步）
│   ├── README.md                      # 模组内说明
│   └── bin/
│       └── folia-desktop-follow-helper.exe
├── native/
│   └── desktop-follow-helper/         # Rust Win32 桌面层 Z 序辅助程序源码
├── scripts/
│   ├── build.mjs                      # 编译 helper 并可选打包 zip（--zip）
│   └── install-local.mjs              # 一键同步安装到本机 Folia mods 目录
└── package.json
```

## 注意事项

- 开启 **「跟随桌面」** 时，为保证 `Win + D` 不触发最小化闪烁，Folia 会以工具窗口样式运行（不会显示在任务栏与 `Alt + Tab` 中，可通过桌面直接点击或系统托盘菜单操作）；关闭「跟随桌面」后立即恢复任务栏显示。
- 本模组仅支持 Windows 平台，在非 Windows 环境下会自动静默跳过。

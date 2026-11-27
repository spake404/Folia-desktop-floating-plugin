$ErrorActionPreference = 'Stop'

$source = @'
using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;

public static class FoliaDesktopFollowHelper
{
    private const uint GW_HWNDPREV = 3;
    private const uint GW_OWNER = 4;
    private const uint GA_ROOT = 2;
    private const int GWL_EXSTYLE = -20;

    private const long WS_EX_TOPMOST = 0x00000008L;
    private const long WS_EX_TRANSPARENT = 0x00000020L;
    private const long WS_EX_TOOLWINDOW = 0x00000080L;
    private const long WS_EX_APPWINDOW = 0x00040000L;
    private const long WS_EX_LAYERED = 0x00080000L;
    private const long WS_EX_NOACTIVATE = 0x08000000L;

    private const uint LWA_ALPHA = 0x00000002;
    private const uint SWP_NOSIZE = 0x0001;
    private const uint SWP_NOMOVE = 0x0002;
    private const uint SWP_NOZORDER = 0x0004;
    private const uint SWP_NOACTIVATE = 0x0010;
    private const uint SWP_FRAMECHANGED = 0x0020;
    private const uint SWP_NOOWNERZORDER = 0x0200;

    private const int SW_SHOWNOACTIVATE = 4;

    private const uint EVENT_SYSTEM_FOREGROUND = 0x0003;
    private const uint EVENT_SYSTEM_MOVESIZEEND = 0x000B;
    private const uint EVENT_SYSTEM_MINIMIZESTART = 0x0016;
    private const uint EVENT_SYSTEM_MINIMIZEEND = 0x0017;
    private const uint EVENT_OBJECT_CREATE = 0x8000;
    private const uint EVENT_OBJECT_SHOW = 0x8002;
    private const uint EVENT_OBJECT_REORDER = 0x8004;

    private const uint WINEVENT_OUTOFCONTEXT = 0x0000;
    private const uint WINEVENT_SKIPOWNPROCESS = 0x0002;

    private const int OBJID_WINDOW = 0;
    private const int OBJID_CLIENT = -4;
    private const int CHILDID_SELF = 0;

    private const uint DWMWA_TRANSITIONS_FORCEDISABLED = 3;

    private const uint PM_NOREMOVE = 0x0000;
    private const uint WM_TIMER = 0x0113;
    private const uint WM_APP_CMD = 0x8001;
    private const uint WM_APP_QUIT = 0x8002;

    private const uint WATCHDOG_INTERVAL_MS = 350;

    private static readonly IntPtr HWND_NOTOPMOST = new IntPtr(-2);
    private static readonly IntPtr DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2 = new IntPtr(-4);

    [StructLayout(LayoutKind.Sequential)]
    private struct POINT
    {
        public int X;
        public int Y;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct RECT
    {
        public int Left;
        public int Top;
        public int Right;
        public int Bottom;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct MSG
    {
        public IntPtr hwnd;
        public uint message;
        public UIntPtr wParam;
        public IntPtr lParam;
        public uint time;
        public POINT pt;
    }

    private delegate void WinEventProc(
        IntPtr hWinEventHook,
        uint eventType,
        IntPtr hwnd,
        int idObject,
        int idChild,
        uint idEventThread,
        uint dwmsEventTime);

    [DllImport("user32.dll", CharSet = CharSet.Unicode)]
    private static extern IntPtr FindWindowW(string lpClassName, string lpWindowName);

    [DllImport("user32.dll", CharSet = CharSet.Unicode)]
    private static extern IntPtr FindWindowExW(IntPtr parentHandle, IntPtr childAfter, string className, string windowTitle);

    [DllImport("user32.dll")]
    private static extern IntPtr GetDesktopWindow();

    [DllImport("user32.dll")]
    private static extern IntPtr GetShellWindow();

    [DllImport("user32.dll")]
    private static extern IntPtr GetForegroundWindow();

    [DllImport("user32.dll")]
    private static extern IntPtr GetWindow(IntPtr hWnd, uint uCmd);

    [DllImport("user32.dll")]
    private static extern IntPtr GetAncestor(IntPtr hWnd, uint gaFlags);

    [DllImport("user32.dll")]
    private static extern bool GetCursorPos(out POINT lpPoint);

    [DllImport("user32.dll")]
    private static extern bool GetWindowRect(IntPtr hWnd, out RECT lpRect);

    [DllImport("user32.dll")]
    private static extern IntPtr WindowFromPoint(POINT point);

    [DllImport("user32.dll")]
    private static extern bool GetLayeredWindowAttributes(IntPtr hwnd, out uint pcrKey, out byte pbAlpha, out uint pdwFlags);

    [DllImport("user32.dll")]
    private static extern bool SetProcessDpiAwarenessContext(IntPtr value);

    [DllImport("user32.dll")]
    private static extern bool SetProcessDPIAware();

    [DllImport("user32.dll", CharSet = CharSet.Unicode)]
    private static extern int GetClassNameW(IntPtr hWnd, StringBuilder lpClassName, int nMaxCount);

    [DllImport("user32.dll")]
    private static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint lpdwProcessId);

    [DllImport("user32.dll")]
    private static extern bool IsWindow(IntPtr hWnd);

    [DllImport("user32.dll")]
    private static extern bool IsWindowVisible(IntPtr hWnd);

    [DllImport("user32.dll")]
    private static extern bool IsIconic(IntPtr hWnd);

    [DllImport("user32.dll")]
    private static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);

    [DllImport("user32.dll")]
    private static extern bool SetWindowPos(
        IntPtr hWnd,
        IntPtr hWndInsertAfter,
        int X,
        int Y,
        int cx,
        int cy,
        uint uFlags);

    [DllImport("user32.dll", EntryPoint = "GetWindowLongPtrW")]
    private static extern IntPtr GetWindowLongPtr64(IntPtr hWnd, int nIndex);

    [DllImport("user32.dll", EntryPoint = "SetWindowLongPtrW")]
    private static extern IntPtr SetWindowLongPtr64(IntPtr hWnd, int nIndex, IntPtr dwNewLong);

    [DllImport("user32.dll", EntryPoint = "GetWindowLongW")]
    private static extern IntPtr GetWindowLong32(IntPtr hWnd, int nIndex);

    [DllImport("user32.dll", EntryPoint = "SetWindowLongW")]
    private static extern IntPtr SetWindowLong32(IntPtr hWnd, int nIndex, IntPtr dwNewLong);

    [DllImport("user32.dll")]
    private static extern IntPtr SetWinEventHook(
        uint eventMin,
        uint eventMax,
        IntPtr hmodWinEventProc,
        WinEventProc lpfnWinEventProc,
        uint idProcess,
        uint idThread,
        uint dwFlags);

    [DllImport("user32.dll")]
    private static extern bool UnhookWinEvent(IntPtr hWinEventHook);

    [DllImport("user32.dll")]
    private static extern bool PeekMessageW(out MSG lpMsg, IntPtr hWnd, uint wMsgFilterMin, uint wMsgFilterMax, uint wRemoveMsg);

    [DllImport("user32.dll")]
    private static extern int GetMessageW(out MSG lpMsg, IntPtr hWnd, uint wMsgFilterMin, uint wMsgFilterMax);

    [DllImport("user32.dll")]
    private static extern bool TranslateMessage(ref MSG lpMsg);

    [DllImport("user32.dll")]
    private static extern IntPtr DispatchMessageW(ref MSG lpMsg);

    [DllImport("user32.dll")]
    private static extern bool PostThreadMessageW(uint idThread, uint msg, UIntPtr wParam, IntPtr lParam);

    [DllImport("user32.dll")]
    private static extern UIntPtr SetTimer(IntPtr hWnd, UIntPtr nIDEvent, uint uElapse, IntPtr lpTimerFunc);

    [DllImport("user32.dll")]
    private static extern bool KillTimer(IntPtr hWnd, UIntPtr uIDEvent);

    [DllImport("dwmapi.dll")]
    private static extern int DwmSetWindowAttribute(IntPtr hwnd, uint dwAttribute, ref int pvAttribute, uint cbAttribute);

    [DllImport("kernel32.dll")]
    private static extern uint GetCurrentThreadId();

    [DllImport("kernel32.dll")]
    private static extern ulong GetTickCount64();

    private static long GetWindowLongPtr(IntPtr hwnd, int index)
    {
        if (IntPtr.Size == 8)
        {
            return GetWindowLongPtr64(hwnd, index).ToInt64();
        }
        return GetWindowLong32(hwnd, index).ToInt64();
    }

    private static void SetWindowLongPtr(IntPtr hwnd, int index, long value)
    {
        if (IntPtr.Size == 8)
        {
            SetWindowLongPtr64(hwnd, index, new IntPtr(value));
        }
        else
        {
            SetWindowLong32(hwnd, index, new IntPtr((int)value));
        }
    }

    private static void EnablePerMonitorDpiAwareness()
    {
        try
        {
            if (SetProcessDpiAwarenessContext(DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2))
            {
                return;
            }
        }
        catch
        {
        }
        try
        {
            SetProcessDPIAware();
        }
        catch
        {
        }
    }

    private static string GetClassName(IntPtr hwnd)
    {
        if (hwnd == IntPtr.Zero)
        {
            return string.Empty;
        }
        StringBuilder sb = new StringBuilder(128);
        int len = GetClassNameW(hwnd, sb, sb.Capacity);
        if (len <= 0)
        {
            return string.Empty;
        }
        return sb.ToString(0, len);
    }

    private static uint GetWindowPid(IntPtr hwnd)
    {
        if (hwnd == IntPtr.Zero)
        {
            return 0;
        }
        uint pid;
        GetWindowThreadProcessId(hwnd, out pid);
        return pid;
    }

    private static bool IsDesktopOrShellHwnd(IntPtr hwnd, IntPtr desktopHost)
    {
        if (hwnd == IntPtr.Zero)
        {
            return false;
        }
        if (hwnd == desktopHost)
        {
            return true;
        }
        string cls = GetClassName(hwnd);
        return cls == "Progman"
            || cls == "WorkerW"
            || cls == "SHELLDLL_DefView"
            || cls == "SysListView32"
            || cls == "Shell_TrayWnd"
            || cls == "Shell_SecondaryTrayWnd"
            || cls == "TrayShowDesktopButtonWClass";
    }

    private static IntPtr FindDesktopHost()
    {
        IntPtr shell = GetShellWindow();
        uint shellPid = GetWindowPid(shell);
        if (shell != IntPtr.Zero && IsWindowVisible(shell))
        {
            if (FindWindowExW(shell, IntPtr.Zero, "SHELLDLL_DefView", null) != IntPtr.Zero)
            {
                return shell;
            }
        }

        IntPtr progman = FindWindowW("Progman", null);
        if (progman != IntPtr.Zero && IsWindowVisible(progman))
        {
            if (FindWindowExW(progman, IntPtr.Zero, "SHELLDLL_DefView", null) != IntPtr.Zero)
            {
                return progman;
            }
        }

        IntPtr worker = FindWindowExW(IntPtr.Zero, IntPtr.Zero, "WorkerW", null);
        while (worker != IntPtr.Zero)
        {
            if (IsWindowVisible(worker) && (shellPid == 0 || GetWindowPid(worker) == shellPid))
            {
                if (FindWindowExW(worker, IntPtr.Zero, "SHELLDLL_DefView", null) != IntPtr.Zero)
                {
                    return worker;
                }
            }
            worker = FindWindowExW(IntPtr.Zero, worker, "WorkerW", null);
        }

        return shell != IntPtr.Zero ? shell : progman;
    }

    private static bool IsWindowAbove(IntPtr referenceHwnd, IntPtr candidateHwnd)
    {
        if (referenceHwnd == IntPtr.Zero || candidateHwnd == IntPtr.Zero)
        {
            return false;
        }
        IntPtr cursor = GetWindow(referenceHwnd, GW_HWNDPREV);
        int steps = 0;
        while (cursor != IntPtr.Zero && steps < 4096)
        {
            if (cursor == candidateHwnd)
            {
                return true;
            }
            cursor = GetWindow(cursor, GW_HWNDPREV);
            steps++;
        }
        return false;
    }

    private static void SetDwmTransitionsDisabled(IntPtr hwnd, bool disabled)
    {
        if (hwnd == IntPtr.Zero)
        {
            return;
        }
        try
        {
            int val = disabled ? 1 : 0;
            DwmSetWindowAttribute(hwnd, DWMWA_TRANSITIONS_FORCEDISABLED, ref val, (uint)Marshal.SizeOf(typeof(int)));
        }
        catch
        {
        }
    }

    private static bool RectContains(RECT rect, POINT pt)
    {
        return pt.X >= rect.Left && pt.X < rect.Right && pt.Y >= rect.Top && pt.Y < rect.Bottom;
    }

    private static void EmitJson(string json)
    {
        lock (_stdoutLock)
        {
            Console.Out.WriteLine(json);
            Console.Out.Flush();
        }
    }

    private static void ProbeCursorVisibility(ulong seq, IntPtr targetHwnd)
    {
        if (targetHwnd == IntPtr.Zero || !IsWindow(targetHwnd))
        {
            EmitJson(string.Format("{{\"event\":\"probe\",\"seq\":{0},\"status\":\"invalid\",\"hitHwnd\":0}}", seq));
            return;
        }
        if (!IsWindowVisible(targetHwnd) || IsIconic(targetHwnd))
        {
            EmitJson(string.Format("{{\"event\":\"probe\",\"seq\":{0},\"status\":\"hidden\",\"hitHwnd\":0}}", seq));
            return;
        }

        POINT pt;
        if (!GetCursorPos(out pt))
        {
            EmitJson(string.Format("{{\"event\":\"probe\",\"seq\":{0},\"status\":\"unknown\",\"hitHwnd\":0}}", seq));
            return;
        }

        RECT targetRect;
        if (!GetWindowRect(targetHwnd, out targetRect) || !RectContains(targetRect, pt))
        {
            EmitJson(string.Format("{{\"event\":\"probe\",\"seq\":{0},\"status\":\"outside\",\"hitHwnd\":0}}", seq));
            return;
        }

        IntPtr hit = WindowFromPoint(pt);
        IntPtr hitRoot = hit != IntPtr.Zero ? GetAncestor(hit, GA_ROOT) : IntPtr.Zero;
        if (hitRoot == IntPtr.Zero)
        {
            hitRoot = hit;
        }
        if (hitRoot == targetHwnd)
        {
            EmitJson(string.Format("{{\"event\":\"probe\",\"seq\":{0},\"status\":\"visible\",\"hitHwnd\":{1}}}", seq, hitRoot.ToInt64()));
            return;
        }

        if (hitRoot != IntPtr.Zero && IsWindowAbove(targetHwnd, hitRoot))
        {
            EmitJson(string.Format("{{\"event\":\"probe\",\"seq\":{0},\"status\":\"occluded\",\"hitHwnd\":{1}}}", seq, hitRoot.ToInt64()));
            return;
        }

        IntPtr cursor = GetWindow(targetHwnd, GW_HWNDPREV);
        int steps = 0;
        while (cursor != IntPtr.Zero && steps < 4096)
        {
            steps++;
            if (IsWindowVisible(cursor) && !IsIconic(cursor))
            {
                long ex = GetWindowLongPtr(cursor, GWL_EXSTYLE);
                bool clickThroughLayered = (ex & WS_EX_LAYERED) != 0 && (ex & WS_EX_TRANSPARENT) != 0;
                bool zeroAlphaLayered = false;
                if ((ex & WS_EX_LAYERED) != 0)
                {
                    uint crKey;
                    byte alpha;
                    uint flags;
                    if (GetLayeredWindowAttributes(cursor, out crKey, out alpha, out flags))
                    {
                        if ((flags & LWA_ALPHA) != 0 && alpha == 0)
                        {
                            zeroAlphaLayered = true;
                        }
                    }
                }
                if (!clickThroughLayered && !zeroAlphaLayered)
                {
                    RECT rect;
                    if (GetWindowRect(cursor, out rect)
                        && rect.Right > rect.Left
                        && rect.Bottom > rect.Top
                        && RectContains(rect, pt))
                    {
                        EmitJson(string.Format("{{\"event\":\"probe\",\"seq\":{0},\"status\":\"occluded\",\"hitHwnd\":{1}}}", seq, cursor.ToInt64()));
                        return;
                    }
                }
            }
            cursor = GetWindow(cursor, GW_HWNDPREV);
        }

        EmitJson(string.Format("{{\"event\":\"probe\",\"seq\":{0},\"status\":\"visible\",\"hitHwnd\":{1}}}", seq, hitRoot.ToInt64()));
    }

    private sealed class Controller
    {
        private IntPtr _targetHwnd = IntPtr.Zero;
        private uint _targetPid = 0;
        private bool _toolWindow = true;
        private bool _preventMinimize = true;
        private bool _hasSavedExBits = false;
        private long _savedExBits = 0;
        private bool _toolWindowApplied = false;
        private string _lastPhase = string.Empty;
        private ulong _lastDesktopFgTick = 0;
        private ulong _lastOtherMinimizeTick = 0;
        private ulong _lastFoliaMinimizeTick = 0;
        private ulong _pendingRestoreDeadline = 0;
        private UIntPtr _syncTimerId = UIntPtr.Zero;
        private UIntPtr _restoreTimerId = UIntPtr.Zero;
        private UIntPtr _watchdogTimerId = UIntPtr.Zero;

        private bool IsAttached()
        {
            return _targetHwnd != IntPtr.Zero && IsWindow(_targetHwnd);
        }

        public void Attach(IntPtr hwnd, uint pid, bool toolWindow, bool preventMinimize)
        {
            if (_targetHwnd != IntPtr.Zero && _targetHwnd != hwnd)
            {
                Detach();
            }
            if (hwnd == IntPtr.Zero || !IsWindow(hwnd))
            {
                EmitJson("{\"event\":\"error\",\"message\":\"invalid target hwnd\"}");
                return;
            }

            uint resolvedPid = pid != 0 ? pid : GetWindowPid(hwnd);
            _targetHwnd = hwnd;
            _targetPid = resolvedPid;
            _toolWindow = toolWindow;
            _preventMinimize = preventMinimize;
            _lastPhase = string.Empty;

            ApplyToolWindowStyle();
            SetDwmTransitionsDisabled(_targetHwnd, true);
            EnsureWatchdog(true);

            IntPtr desktopHost = FindDesktopHost();
            EmitJson(string.Format("{{\"event\":\"attached\",\"hwnd\":{0},\"desktopHost\":{1}}}", hwnd.ToInt64(), desktopHost.ToInt64()));
            SyncZOrder();
            ScheduleSync(80);
        }

        public void UpdateConfig(bool toolWindow, bool preventMinimize)
        {
            _toolWindow = toolWindow;
            _preventMinimize = preventMinimize;
            if (IsAttached())
            {
                ApplyToolWindowStyle();
                SyncZOrder();
            }
        }

        public void Detach()
        {
            IntPtr previousHwnd = _targetHwnd;
            CancelAllTimers();
            if (previousHwnd != IntPtr.Zero && IsWindow(previousHwnd))
            {
                SetDwmTransitionsDisabled(previousHwnd, false);
            }
            RestoreToolWindowStyle();
            _targetHwnd = IntPtr.Zero;
            _targetPid = 0;
            _lastPhase = string.Empty;
            _pendingRestoreDeadline = 0;
            if (previousHwnd != IntPtr.Zero)
            {
                EmitJson(string.Format("{{\"event\":\"detached\",\"hwnd\":{0}}}", previousHwnd.ToInt64()));
            }
        }

        private void ApplyToolWindowStyle()
        {
            if (!IsAttached())
            {
                return;
            }
            if (_toolWindow)
            {
                if (_toolWindowApplied)
                {
                    return;
                }
                long currentEx = GetWindowLongPtr(_targetHwnd, GWL_EXSTYLE);
                if (!_hasSavedExBits)
                {
                    _savedExBits = currentEx & (WS_EX_TOOLWINDOW | WS_EX_APPWINDOW);
                    _hasSavedExBits = true;
                }
                long updatedEx = (currentEx | WS_EX_TOOLWINDOW) & (~WS_EX_APPWINDOW);
                if (updatedEx != currentEx)
                {
                    SetWindowLongPtr(_targetHwnd, GWL_EXSTYLE, updatedEx);
                    SetWindowPos(
                        _targetHwnd,
                        IntPtr.Zero,
                        0,
                        0,
                        0,
                        0,
                        SWP_NOMOVE | SWP_NOSIZE | SWP_NOZORDER | SWP_NOACTIVATE | SWP_FRAMECHANGED);
                }
                _toolWindowApplied = true;
            }
            else
            {
                RestoreToolWindowStyle();
            }
        }

        private void RestoreToolWindowStyle()
        {
            if (!_toolWindowApplied)
            {
                return;
            }
            if (_targetHwnd != IntPtr.Zero && IsWindow(_targetHwnd) && _hasSavedExBits)
            {
                long currentEx = GetWindowLongPtr(_targetHwnd, GWL_EXSTYLE);
                long restoredEx = (currentEx & (~(WS_EX_TOOLWINDOW | WS_EX_APPWINDOW))) | _savedExBits;
                if (restoredEx != currentEx)
                {
                    SetWindowLongPtr(_targetHwnd, GWL_EXSTYLE, restoredEx);
                    SetWindowPos(
                        _targetHwnd,
                        IntPtr.Zero,
                        0,
                        0,
                        0,
                        0,
                        SWP_NOMOVE | SWP_NOSIZE | SWP_NOZORDER | SWP_NOACTIVATE | SWP_FRAMECHANGED);
                }
            }
            _toolWindowApplied = false;
            _hasSavedExBits = false;
            _savedExBits = 0;
        }

        private void EmitPhase(string phase, IntPtr desktopHost)
        {
            if (_lastPhase == phase)
            {
                return;
            }
            _lastPhase = phase;
            EmitJson(string.Format("{{\"event\":\"state\",\"phase\":\"{0}\",\"desktopHost\":{1}}}", phase, desktopHost.ToInt64()));
        }

        private bool IsFoliaActiveForeground()
        {
            if (!IsAttached())
            {
                return false;
            }
            IntPtr fg = GetForegroundWindow();
            if (fg == IntPtr.Zero)
            {
                return false;
            }
            if (fg == _targetHwnd)
            {
                return true;
            }
            if (_targetPid != 0 && GetWindowPid(fg) == _targetPid)
            {
                IntPtr owner = GetWindow(fg, GW_OWNER);
                if (owner == _targetHwnd)
                {
                    return true;
                }
                string cls = GetClassName(fg);
                if (cls.StartsWith("Chrome_WidgetWin"))
                {
                    return true;
                }
            }
            return false;
        }

        private bool ShouldRestoreMinimized(ulong now, IntPtr desktopHost)
        {
            if (!_preventMinimize)
            {
                return false;
            }
            IntPtr fg = GetForegroundWindow();
            if (IsDesktopOrShellHwnd(fg, desktopHost))
            {
                return true;
            }
            if (_lastDesktopFgTick > 0 && now >= _lastDesktopFgTick && (now - _lastDesktopFgTick) <= 600)
            {
                return true;
            }
            if (_lastOtherMinimizeTick > 0 && now >= _lastOtherMinimizeTick && (now - _lastOtherMinimizeTick) <= 450)
            {
                return true;
            }
            return false;
        }

        private void RestoreFromWinD()
        {
            if (!IsAttached())
            {
                return;
            }
            _pendingRestoreDeadline = 0;
            if (IsIconic(_targetHwnd))
            {
                ShowWindow(_targetHwnd, SW_SHOWNOACTIVATE);
            }
            SyncZOrder();
            ScheduleSync(45);
        }

        public void SyncZOrder()
        {
            if (!IsAttached())
            {
                return;
            }
            if (!IsWindowVisible(_targetHwnd) || IsIconic(_targetHwnd))
            {
                return;
            }

            long exStyle = GetWindowLongPtr(_targetHwnd, GWL_EXSTYLE);
            if ((exStyle & WS_EX_TOPMOST) != 0)
            {
                EmitPhase("paused_topmost", IntPtr.Zero);
                return;
            }
            if (_toolWindow && (exStyle & WS_EX_TOOLWINDOW) == 0)
            {
                _toolWindowApplied = false;
                ApplyToolWindowStyle();
            }

            IntPtr desktopHost = FindDesktopHost();
            bool desktopAboveFolia = desktopHost != IntPtr.Zero && IsWindowAbove(_targetHwnd, desktopHost);
            if (IsFoliaActiveForeground() && !desktopAboveFolia)
            {
                EmitPhase("front", desktopHost);
                return;
            }

            if (desktopHost == IntPtr.Zero || !IsWindow(desktopHost))
            {
                return;
            }

            IntPtr cursor = GetWindow(desktopHost, GW_HWNDPREV);
            IntPtr insertAfter = HWND_NOTOPMOST;
            bool alreadyInDesktopBand = false;
            int steps = 0;

            while (cursor != IntPtr.Zero && steps < 512)
            {
                steps++;
                if (cursor == _targetHwnd)
                {
                    alreadyInDesktopBand = true;
                    break;
                }

                long cursorEx = GetWindowLongPtr(cursor, GWL_EXSTYLE);
                if ((cursorEx & WS_EX_TOPMOST) != 0)
                {
                    break;
                }

                bool visible = IsWindowVisible(cursor);
                bool isDesktopWidget = (cursorEx & WS_EX_TOOLWINDOW) != 0 && (cursorEx & WS_EX_NOACTIVATE) != 0;
                if (visible && !isDesktopWidget)
                {
                    insertAfter = cursor;
                    break;
                }

                cursor = GetWindow(cursor, GW_HWNDPREV);
            }

            if (!alreadyInDesktopBand)
            {
                SetWindowPos(
                    _targetHwnd,
                    insertAfter,
                    0,
                    0,
                    0,
                    0,
                    SWP_NOMOVE | SWP_NOSIZE | SWP_NOACTIVATE | SWP_NOOWNERZORDER);
            }

            EmitPhase("desktop", desktopHost);
        }

        public void OnWinEvent(uint eventType, IntPtr hwnd, int idObject, int idChild)
        {
            if (!IsAttached())
            {
                return;
            }
            ulong now = GetTickCount64();

            if (eventType == EVENT_SYSTEM_FOREGROUND)
            {
                IntPtr desktopHost = FindDesktopHost();
                if (IsDesktopOrShellHwnd(hwnd, desktopHost))
                {
                    _lastDesktopFgTick = now;
                    if (_preventMinimize
                        && IsWindowVisible(_targetHwnd)
                        && IsIconic(_targetHwnd)
                        && ((_lastFoliaMinimizeTick > 0 && now >= _lastFoliaMinimizeTick && (now - _lastFoliaMinimizeTick) <= 600)
                            || now <= _pendingRestoreDeadline))
                    {
                        RestoreFromWinD();
                        return;
                    }
                }

                bool desktopAboveFolia = desktopHost != IntPtr.Zero && IsWindowAbove(_targetHwnd, desktopHost);
                if (IsFoliaActiveForeground() && !desktopAboveFolia)
                {
                    EmitPhase("front", desktopHost);
                }
                else
                {
                    SyncZOrder();
                    ScheduleSync(80);
                }
                return;
            }

            if (eventType == EVENT_SYSTEM_MINIMIZESTART)
            {
                if (idObject != OBJID_WINDOW || idChild != CHILDID_SELF)
                {
                    return;
                }
                if (hwnd == _targetHwnd)
                {
                    _lastFoliaMinimizeTick = now;
                    IntPtr desktopHost = FindDesktopHost();
                    if (ShouldRestoreMinimized(now, desktopHost))
                    {
                        RestoreFromWinD();
                    }
                    else if (_preventMinimize)
                    {
                        _pendingRestoreDeadline = now + 220;
                        ScheduleRestoreCheck(55);
                    }
                }
                else if (hwnd != IntPtr.Zero)
                {
                    _lastOtherMinimizeTick = now;
                    if (now <= _pendingRestoreDeadline && IsWindowVisible(_targetHwnd) && IsIconic(_targetHwnd))
                    {
                        RestoreFromWinD();
                    }
                }
                return;
            }

            if (eventType == EVENT_SYSTEM_MINIMIZEEND || eventType == EVENT_SYSTEM_MOVESIZEEND)
            {
                if (hwnd == _targetHwnd)
                {
                    SyncZOrder();
                }
                return;
            }

            if (eventType == EVENT_OBJECT_SHOW)
            {
                if (idChild != CHILDID_SELF || (idObject != OBJID_WINDOW && idObject != OBJID_CLIENT))
                {
                    return;
                }
                IntPtr desktopWindow = GetDesktopWindow();
                if (hwnd == _targetHwnd || hwnd == IntPtr.Zero || hwnd == desktopWindow)
                {
                    SyncZOrder();
                    return;
                }
                string cls = GetClassName(hwnd);
                if (cls == "WorkerW" || cls == "Progman" || cls == "SHELLDLL_DefView")
                {
                    SyncZOrder();
                }
                return;
            }

            if (eventType >= EVENT_OBJECT_CREATE && eventType <= EVENT_OBJECT_REORDER)
            {
                if (eventType != EVENT_OBJECT_REORDER
                    && (idChild != CHILDID_SELF || (idObject != OBJID_WINDOW && idObject != OBJID_CLIENT)))
                {
                    return;
                }
                IntPtr desktopWindow = GetDesktopWindow();
                if (hwnd == IntPtr.Zero || hwnd == desktopWindow)
                {
                    SyncZOrder();
                    return;
                }
                string cls = GetClassName(hwnd);
                if (cls == "WorkerW" || cls == "Progman" || cls == "SHELLDLL_DefView")
                {
                    SyncZOrder();
                }
            }
        }

        public void OnTimer(UIntPtr timerId)
        {
            if (timerId != UIntPtr.Zero && timerId == _syncTimerId)
            {
                KillTimer(IntPtr.Zero, _syncTimerId);
                _syncTimerId = UIntPtr.Zero;
                SyncZOrder();
                return;
            }
            if (timerId != UIntPtr.Zero && timerId == _restoreTimerId)
            {
                KillTimer(IntPtr.Zero, _restoreTimerId);
                _restoreTimerId = UIntPtr.Zero;
                ulong now = GetTickCount64();
                IntPtr desktopHost = FindDesktopHost();
                if (IsAttached() && IsWindowVisible(_targetHwnd) && IsIconic(_targetHwnd) && ShouldRestoreMinimized(now, desktopHost))
                {
                    RestoreFromWinD();
                }
                else
                {
                    _pendingRestoreDeadline = 0;
                }
                return;
            }
            if (timerId != UIntPtr.Zero && timerId == _watchdogTimerId)
            {
                if (IsAttached())
                {
                    SyncZOrder();
                }
                else
                {
                    EnsureWatchdog(false);
                }
            }
        }

        private void ScheduleSync(uint delayMs)
        {
            UIntPtr id = SetTimer(IntPtr.Zero, _syncTimerId, delayMs, IntPtr.Zero);
            if (id != UIntPtr.Zero)
            {
                _syncTimerId = id;
            }
        }

        private void ScheduleRestoreCheck(uint delayMs)
        {
            UIntPtr id = SetTimer(IntPtr.Zero, _restoreTimerId, delayMs, IntPtr.Zero);
            if (id != UIntPtr.Zero)
            {
                _restoreTimerId = id;
            }
        }

        private void EnsureWatchdog(bool enabled)
        {
            if (enabled)
            {
                if (_watchdogTimerId == UIntPtr.Zero)
                {
                    UIntPtr id = SetTimer(IntPtr.Zero, UIntPtr.Zero, WATCHDOG_INTERVAL_MS, IntPtr.Zero);
                    if (id != UIntPtr.Zero)
                    {
                        _watchdogTimerId = id;
                    }
                }
            }
            else if (_watchdogTimerId != UIntPtr.Zero)
            {
                KillTimer(IntPtr.Zero, _watchdogTimerId);
                _watchdogTimerId = UIntPtr.Zero;
            }
        }

        private void CancelAllTimers()
        {
            if (_syncTimerId != UIntPtr.Zero)
            {
                KillTimer(IntPtr.Zero, _syncTimerId);
                _syncTimerId = UIntPtr.Zero;
            }
            if (_restoreTimerId != UIntPtr.Zero)
            {
                KillTimer(IntPtr.Zero, _restoreTimerId);
                _restoreTimerId = UIntPtr.Zero;
            }
            if (_watchdogTimerId != UIntPtr.Zero)
            {
                KillTimer(IntPtr.Zero, _watchdogTimerId);
                _watchdogTimerId = UIntPtr.Zero;
            }
        }
    }

    private static readonly object _stdoutLock = new object();
    private static readonly object _queueLock = new object();
    private static readonly Queue<string> _commandQueue = new Queue<string>();
    private static Controller _controller;
    private static WinEventProc _winEventCallback;

    private static bool ParseBoolFlag(string[] parts, int index, bool defaultVal)
    {
        if (parts.Length <= index)
        {
            return defaultVal;
        }
        string token = parts[index];
        if (token == "1" || token == "true")
        {
            return true;
        }
        if (token == "0" || token == "false")
        {
            return false;
        }
        return defaultVal;
    }

    private static bool DrainCommands()
    {
        List<string> batch = new List<string>();
        lock (_queueLock)
        {
            while (_commandQueue.Count > 0)
            {
                batch.Add(_commandQueue.Dequeue());
            }
        }

        bool shouldQuit = false;
        for (int i = 0; i < batch.Count; i++)
        {
            string line = batch[i];
            if (string.IsNullOrWhiteSpace(line))
            {
                continue;
            }
            string cleaned = line.Trim().TrimStart('\uFEFF');
            string[] parts = cleaned.Split(new char[] { ' ', '\t' }, StringSplitOptions.RemoveEmptyEntries);
            if (parts.Length == 0)
            {
                continue;
            }
            string verb = parts[0];
            if (verb == "ATTACH" && parts.Length >= 3)
            {
                ulong hwndRaw;
                uint pid;
                if (ulong.TryParse(parts[1], out hwndRaw) && uint.TryParse(parts[2], out pid))
                {
                    bool toolWindow = ParseBoolFlag(parts, 3, true);
                    bool preventMinimize = ParseBoolFlag(parts, 4, true);
                    _controller.Attach(new IntPtr(unchecked((long)hwndRaw)), pid, toolWindow, preventMinimize);
                }
            }
            else if (verb == "CONFIG")
            {
                bool toolWindow = ParseBoolFlag(parts, 1, true);
                bool preventMinimize = ParseBoolFlag(parts, 2, true);
                _controller.UpdateConfig(toolWindow, preventMinimize);
            }
            else if (verb == "SINK")
            {
                _controller.SyncZOrder();
            }
            else if (verb == "DETACH")
            {
                _controller.Detach();
            }
            else if (verb == "PROBE" && parts.Length >= 3)
            {
                ulong seq;
                ulong hwndRaw;
                if (ulong.TryParse(parts[1], out seq) && ulong.TryParse(parts[2], out hwndRaw))
                {
                    ProbeCursorVisibility(seq, new IntPtr(unchecked((long)hwndRaw)));
                }
            }
            else if (verb == "QUIT")
            {
                _controller.Detach();
                shouldQuit = true;
            }
        }
        return shouldQuit;
    }

    private static void OnWinEvent(
        IntPtr hWinEventHook,
        uint eventType,
        IntPtr hwnd,
        int idObject,
        int idChild,
        uint idEventThread,
        uint dwmsEventTime)
    {
        if (_controller != null)
        {
            _controller.OnWinEvent(eventType, hwnd, idObject, idChild);
        }
    }

    public static void Run()
    {
        Console.InputEncoding = new UTF8Encoding(false);
        Console.OutputEncoding = new UTF8Encoding(false);
        EnablePerMonitorDpiAwareness();

        uint mainThreadId = GetCurrentThreadId();
        _controller = new Controller();
        _winEventCallback = new WinEventProc(OnWinEvent);

        MSG initMsg;
        PeekMessageW(out initMsg, IntPtr.Zero, 0, 0, PM_NOREMOVE);

        uint flags = WINEVENT_OUTOFCONTEXT | WINEVENT_SKIPOWNPROCESS;
        IntPtr[] hooks = new IntPtr[]
        {
            SetWinEventHook(EVENT_SYSTEM_FOREGROUND, EVENT_SYSTEM_FOREGROUND, IntPtr.Zero, _winEventCallback, 0, 0, flags),
            SetWinEventHook(EVENT_SYSTEM_MOVESIZEEND, EVENT_SYSTEM_MOVESIZEEND, IntPtr.Zero, _winEventCallback, 0, 0, flags),
            SetWinEventHook(EVENT_SYSTEM_MINIMIZESTART, EVENT_SYSTEM_MINIMIZEEND, IntPtr.Zero, _winEventCallback, 0, 0, flags),
            SetWinEventHook(EVENT_OBJECT_CREATE, EVENT_OBJECT_REORDER, IntPtr.Zero, _winEventCallback, 0, 0, flags),
        };

        Thread reader = new Thread(delegate()
        {
            try
            {
                string line;
                while ((line = Console.In.ReadLine()) != null)
                {
                    lock (_queueLock)
                    {
                        _commandQueue.Enqueue(line);
                    }
                    PostThreadMessageW(mainThreadId, WM_APP_CMD, UIntPtr.Zero, IntPtr.Zero);
                }
            }
            catch
            {
            }
            PostThreadMessageW(mainThreadId, WM_APP_QUIT, UIntPtr.Zero, IntPtr.Zero);
        });
        reader.IsBackground = true;
        reader.Start();

        EmitJson("{\"event\":\"ready\"}");

        MSG msg;
        while (GetMessageW(out msg, IntPtr.Zero, 0, 0) > 0)
        {
            if (msg.hwnd == IntPtr.Zero)
            {
                if (msg.message == WM_APP_CMD)
                {
                    if (DrainCommands())
                    {
                        break;
                    }
                    continue;
                }
                if (msg.message == WM_APP_QUIT)
                {
                    DrainCommands();
                    _controller.Detach();
                    break;
                }
                if (msg.message == WM_TIMER)
                {
                    _controller.OnTimer(msg.wParam);
                    continue;
                }
            }
            TranslateMessage(ref msg);
            DispatchMessageW(ref msg);
        }

        _controller.Detach();
        for (int i = 0; i < hooks.Length; i++)
        {
            if (hooks[i] != IntPtr.Zero)
            {
                UnhookWinEvent(hooks[i]);
            }
        }
    }
}
'@

Add-Type -TypeDefinition $source -Language CSharp
[FoliaDesktopFollowHelper]::Run()

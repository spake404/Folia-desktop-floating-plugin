#![cfg_attr(windows, windows_subsystem = "windows")]

#[cfg(not(windows))]
fn main() {
    eprintln!("folia-desktop-follow-helper only supports Windows.");
}

#[cfg(windows)]
mod win_app {
    use std::cell::RefCell;
    use std::collections::VecDeque;
    use std::ffi::OsStr;
    use std::io::{self, BufRead, Write};
    use std::os::windows::ffi::OsStrExt;
    use std::ptr;
    use std::sync::{Mutex, OnceLock};
    use std::thread;

    type HWND = isize;
    type HWINEVENTHOOK = isize;
    type BOOL = i32;
    type DWORD = u32;
    type UINT = u32;
    type LONG = i32;
    type WPARAM = usize;
    type LPARAM = isize;

    const GW_HWNDPREV: UINT = 3;
    const GW_OWNER: UINT = 4;
    const GWL_EXSTYLE: i32 = -20;

    const WS_EX_TOPMOST: isize = 0x0000_0008;
    const WS_EX_TOOLWINDOW: isize = 0x0000_0080;
    const WS_EX_APPWINDOW: isize = 0x0004_0000;
    const WS_EX_NOACTIVATE: isize = 0x0800_0000;

    const HWND_NOTOPMOST: HWND = -2;

    const SWP_NOSIZE: UINT = 0x0001;
    const SWP_NOMOVE: UINT = 0x0002;
    const SWP_NOZORDER: UINT = 0x0004;
    const SWP_NOACTIVATE: UINT = 0x0010;
    const SWP_FRAMECHANGED: UINT = 0x0020;
    const SWP_NOOWNERZORDER: UINT = 0x0200;

    const SW_SHOWNOACTIVATE: i32 = 4;

    const EVENT_SYSTEM_FOREGROUND: DWORD = 0x0003;
    const EVENT_SYSTEM_MOVESIZEEND: DWORD = 0x000B;
    const EVENT_SYSTEM_MINIMIZESTART: DWORD = 0x0016;
    const EVENT_SYSTEM_MINIMIZEEND: DWORD = 0x0017;
    const EVENT_OBJECT_CREATE: DWORD = 0x8000;
    const EVENT_OBJECT_SHOW: DWORD = 0x8002;
    const EVENT_OBJECT_REORDER: DWORD = 0x8004;

    const WINEVENT_OUTOFCONTEXT: DWORD = 0x0000;
    const WINEVENT_SKIPOWNPROCESS: DWORD = 0x0002;

    const OBJID_WINDOW: LONG = 0;
    const OBJID_CLIENT: LONG = -4;
    const CHILDID_SELF: LONG = 0;

    const DWMWA_TRANSITIONS_FORCEDISABLED: DWORD = 3;

    const VK_LWIN: i32 = 0x5B;
    const VK_RWIN: i32 = 0x5C;
    const VK_KEY_D: i32 = 0x44;
    const VK_KEY_M: i32 = 0x4D;

    const PM_NOREMOVE: UINT = 0x0000;
    const WM_TIMER: UINT = 0x0113;
    const WM_APP_CMD: UINT = 0x8001;
    const WM_APP_QUIT: UINT = 0x8002;

    const WATCHDOG_INTERVAL_MS: UINT = 350;

    #[repr(C)]
    #[derive(Clone, Copy, Default)]
    struct POINT {
        x: LONG,
        y: LONG,
    }

    #[repr(C)]
    #[derive(Clone, Copy, Default)]
    struct MSG {
        hwnd: HWND,
        message: UINT,
        w_param: WPARAM,
        l_param: LPARAM,
        time: DWORD,
        pt: POINT,
        l_private: DWORD,
    }

    type WinEventProc = unsafe extern "system" fn(
        hook: HWINEVENTHOOK,
        event: DWORD,
        hwnd: HWND,
        id_object: LONG,
        id_child: LONG,
        id_event_thread: DWORD,
        event_time: DWORD,
    );

    #[link(name = "user32")]
    extern "system" {
        fn FindWindowW(class_name: *const u16, window_name: *const u16) -> HWND;
        fn FindWindowExW(
            parent: HWND,
            child_after: HWND,
            class_name: *const u16,
            window_name: *const u16,
        ) -> HWND;
        fn GetDesktopWindow() -> HWND;
        fn GetShellWindow() -> HWND;
        fn GetForegroundWindow() -> HWND;
        fn GetWindow(hwnd: HWND, cmd: UINT) -> HWND;
        fn GetClassNameW(hwnd: HWND, class_name: *mut u16, max_count: i32) -> i32;
        fn GetWindowThreadProcessId(hwnd: HWND, process_id: *mut DWORD) -> DWORD;
        fn IsWindow(hwnd: HWND) -> BOOL;
        fn IsWindowVisible(hwnd: HWND) -> BOOL;
        fn IsIconic(hwnd: HWND) -> BOOL;
        fn ShowWindow(hwnd: HWND, cmd_show: i32) -> BOOL;
        fn SetWindowPos(
            hwnd: HWND,
            hwnd_insert_after: HWND,
            x: i32,
            y: i32,
            cx: i32,
            cy: i32,
            flags: UINT,
        ) -> BOOL;
        #[cfg(target_pointer_width = "64")]
        fn GetWindowLongPtrW(hwnd: HWND, index: i32) -> isize;
        #[cfg(target_pointer_width = "64")]
        fn SetWindowLongPtrW(hwnd: HWND, index: i32, new_long: isize) -> isize;
        #[cfg(target_pointer_width = "32")]
        fn GetWindowLongW(hwnd: HWND, index: i32) -> isize;
        #[cfg(target_pointer_width = "32")]
        fn SetWindowLongW(hwnd: HWND, index: i32, new_long: isize) -> isize;
        fn GetAsyncKeyState(vkey: i32) -> i16;
        fn SetWinEventHook(
            event_min: DWORD,
            event_max: DWORD,
            hmod_win_event_proc: isize,
            pfn_win_event_proc: WinEventProc,
            id_process: DWORD,
            id_thread: DWORD,
            flags: DWORD,
        ) -> HWINEVENTHOOK;
        fn UnhookWinEvent(hook: HWINEVENTHOOK) -> BOOL;
        fn PeekMessageW(
            msg: *mut MSG,
            hwnd: HWND,
            msg_filter_min: UINT,
            msg_filter_max: UINT,
            remove_msg: UINT,
        ) -> BOOL;
        fn GetMessageW(
            msg: *mut MSG,
            hwnd: HWND,
            msg_filter_min: UINT,
            msg_filter_max: UINT,
        ) -> BOOL;
        fn TranslateMessage(msg: *const MSG) -> BOOL;
        fn DispatchMessageW(msg: *const MSG) -> isize;
        fn PostThreadMessageW(
            thread_id: DWORD,
            msg: UINT,
            w_param: WPARAM,
            l_param: LPARAM,
        ) -> BOOL;
        fn SetTimer(
            hwnd: HWND,
            id_event: usize,
            elapse_ms: UINT,
            timer_func: Option<unsafe extern "system" fn(HWND, UINT, usize, DWORD)>,
        ) -> usize;
        fn KillTimer(hwnd: HWND, id_event: usize) -> BOOL;
    }

    #[link(name = "kernel32")]
    extern "system" {
        fn GetCurrentThreadId() -> DWORD;
        fn GetTickCount64() -> u64;
        fn LoadLibraryW(lib_file_name: *const u16) -> isize;
        fn GetProcAddress(module: isize, proc_name: *const u8) -> *const core::ffi::c_void;
    }

    type DwmSetWindowAttributeFn =
        unsafe extern "system" fn(HWND, DWORD, *const BOOL, DWORD) -> i32;

    static DWM_SET_ATTR: OnceLock<Option<DwmSetWindowAttributeFn>> = OnceLock::new();

    fn resolve_dwm_set_window_attribute() -> Option<DwmSetWindowAttributeFn> {
        *DWM_SET_ATTR.get_or_init(|| unsafe {
            let dll = wide_null("dwmapi.dll");
            let module = LoadLibraryW(dll.as_ptr());
            if module == 0 {
                return None;
            }
            let proc = GetProcAddress(module, b"DwmSetWindowAttribute\0".as_ptr());
            if proc.is_null() {
                return None;
            }
            Some(std::mem::transmute::<
                *const core::ffi::c_void,
                DwmSetWindowAttributeFn,
            >(proc))
        })
    }

    unsafe fn get_window_long_ptr(hwnd: HWND, index: i32) -> isize {
        #[cfg(target_pointer_width = "64")]
        {
            GetWindowLongPtrW(hwnd, index)
        }
        #[cfg(target_pointer_width = "32")]
        {
            GetWindowLongW(hwnd, index)
        }
    }

    unsafe fn set_window_long_ptr(hwnd: HWND, index: i32, value: isize) -> isize {
        #[cfg(target_pointer_width = "64")]
        {
            SetWindowLongPtrW(hwnd, index, value)
        }
        #[cfg(target_pointer_width = "32")]
        {
            SetWindowLongW(hwnd, index, value)
        }
    }

    fn wide_null(text: &str) -> Vec<u16> {
        OsStr::new(text).encode_wide().chain(Some(0)).collect()
    }

    fn get_class_name(hwnd: HWND) -> String {
        if hwnd == 0 {
            return String::new();
        }
        let mut buffer = [0u16; 256];
        let len = unsafe { GetClassNameW(hwnd, buffer.as_mut_ptr(), buffer.len() as i32) };
        if len <= 0 {
            return String::new();
        }
        String::from_utf16_lossy(&buffer[..len as usize])
    }

    fn get_window_pid(hwnd: HWND) -> DWORD {
        if hwnd == 0 {
            return 0;
        }
        let mut pid: DWORD = 0;
        unsafe {
            GetWindowThreadProcessId(hwnd, &mut pid);
        }
        pid
    }

    fn tick_now() -> u64 {
        unsafe { GetTickCount64() }
    }

    fn is_key_down(vkey: i32) -> bool {
        unsafe { (GetAsyncKeyState(vkey) as u16 & 0x8000) != 0 }
    }

    fn is_desktop_or_shell_hwnd(hwnd: HWND, desktop_host: HWND) -> bool {
        if hwnd == 0 {
            return false;
        }
        if desktop_host != 0 && hwnd == desktop_host {
            return true;
        }
        let class_name = get_class_name(hwnd);
        matches!(
            class_name.as_str(),
            "Progman"
                | "WorkerW"
                | "SHELLDLL_DefView"
                | "SysListView32"
                | "Shell_TrayWnd"
                | "Shell_SecondaryTrayWnd"
                | "TrayShowDesktopButtonWClass"
        )
    }

    fn find_desktop_host() -> HWND {
        let progman_cls = wide_null("Progman");
        let worker_cls = wide_null("WorkerW");
        let defview_cls = wide_null("SHELLDLL_DefView");

        unsafe {
            let shell = GetShellWindow();
            let shell_pid = get_window_pid(shell);
            if shell != 0 && IsWindowVisible(shell) != 0 {
                let def_view = FindWindowExW(shell, 0, defview_cls.as_ptr(), ptr::null());
                if def_view != 0 {
                    return shell;
                }
            }

            let progman = FindWindowW(progman_cls.as_ptr(), ptr::null());
            if progman != 0 && IsWindowVisible(progman) != 0 {
                let def_view = FindWindowExW(progman, 0, defview_cls.as_ptr(), ptr::null());
                if def_view != 0 {
                    return progman;
                }
            }

            let mut worker = FindWindowExW(0, 0, worker_cls.as_ptr(), ptr::null());
            while worker != 0 {
                if IsWindowVisible(worker) != 0
                    && (shell_pid == 0 || get_window_pid(worker) == shell_pid)
                {
                    let def_view = FindWindowExW(worker, 0, defview_cls.as_ptr(), ptr::null());
                    if def_view != 0 {
                        return worker;
                    }
                }
                worker = FindWindowExW(0, worker, worker_cls.as_ptr(), ptr::null());
            }

            if shell != 0 {
                shell
            } else {
                progman
            }
        }
    }

    fn is_window_above(reference_hwnd: HWND, candidate_hwnd: HWND) -> bool {
        if reference_hwnd == 0 || candidate_hwnd == 0 {
            return false;
        }
        unsafe {
            let mut cursor = GetWindow(reference_hwnd, GW_HWNDPREV);
            let mut steps = 0usize;
            while cursor != 0 && steps < 2048 {
                if cursor == candidate_hwnd {
                    return true;
                }
                cursor = GetWindow(cursor, GW_HWNDPREV);
                steps += 1;
            }
        }
        false
    }

    fn set_dwm_transitions_disabled(hwnd: HWND, disabled: bool) {
        if hwnd == 0 {
            return;
        }
        let Some(dwm_set_attr) = resolve_dwm_set_window_attribute() else {
            return;
        };
        let val: BOOL = if disabled { 1 } else { 0 };
        unsafe {
            let _ = dwm_set_attr(
                hwnd,
                DWMWA_TRANSITIONS_FORCEDISABLED,
                &val as *const BOOL,
                std::mem::size_of::<BOOL>() as DWORD,
            );
        }
    }

    fn emit_json(line: &str) {
        let stdout = io::stdout();
        let mut handle = stdout.lock();
        let _ = writeln!(handle, "{}", line);
        let _ = handle.flush();
    }

    #[derive(Debug)]
    enum Command {
        Attach {
            hwnd: HWND,
            pid: DWORD,
            tool_window: bool,
            prevent_minimize: bool,
        },
        Config {
            tool_window: bool,
            prevent_minimize: bool,
        },
        Sink,
        Detach,
        Quit,
    }

    fn parse_bool_flag(token: Option<&str>, default_val: bool) -> bool {
        match token {
            Some("1") | Some("true") => true,
            Some("0") | Some("false") => false,
            _ => default_val,
        }
    }

    fn parse_command(line: &str) -> Option<Command> {
        let cleaned = line.trim_start_matches('\u{feff}');
        let mut parts = cleaned.split_whitespace();
        let verb = parts.next()?;
        match verb {
            "ATTACH" => {
                let hwnd_raw = parts.next()?.parse::<u64>().ok()?;
                let pid = parts.next()?.parse::<DWORD>().ok()?;
                let tool_window = parse_bool_flag(parts.next(), true);
                let prevent_minimize = parse_bool_flag(parts.next(), true);
                Some(Command::Attach {
                    hwnd: hwnd_raw as HWND,
                    pid,
                    tool_window,
                    prevent_minimize,
                })
            }
            "CONFIG" => {
                let tool_window = parse_bool_flag(parts.next(), true);
                let prevent_minimize = parse_bool_flag(parts.next(), true);
                Some(Command::Config {
                    tool_window,
                    prevent_minimize,
                })
            }
            "SINK" => Some(Command::Sink),
            "DETACH" => Some(Command::Detach),
            "QUIT" => Some(Command::Quit),
            _ => None,
        }
    }

    #[derive(Default)]
    struct Controller {
        target_hwnd: HWND,
        target_pid: DWORD,
        tool_window: bool,
        prevent_minimize: bool,
        saved_ex_bits: Option<isize>,
        tool_window_applied: bool,
        last_phase: String,
        folia_was_foreground: bool,
        last_desktop_fg_tick: u64,
        last_other_minimize_tick: u64,
        last_folia_minimize_tick: u64,
        pending_restore_deadline: u64,
        sync_timer_id: usize,
        restore_timer_id: usize,
        watchdog_timer_id: usize,
    }

    impl Controller {
        fn is_attached(&self) -> bool {
            self.target_hwnd != 0 && unsafe { IsWindow(self.target_hwnd) != 0 }
        }

        fn attach(&mut self, hwnd: HWND, pid: DWORD, tool_window: bool, prevent_minimize: bool) {
            if self.target_hwnd != 0 && self.target_hwnd != hwnd {
                self.detach();
            }
            if hwnd == 0 || unsafe { IsWindow(hwnd) == 0 } {
                emit_json(r#"{"event":"error","message":"invalid target hwnd"}"#);
                return;
            }

            let resolved_pid = if pid != 0 { pid } else { get_window_pid(hwnd) };
            self.target_hwnd = hwnd;
            self.target_pid = resolved_pid;
            self.tool_window = tool_window;
            self.prevent_minimize = prevent_minimize;
            self.last_phase.clear();
            self.folia_was_foreground = self.is_folia_active_foreground();

            set_dwm_transitions_disabled(self.target_hwnd, true);
            self.apply_tool_window_style();
            self.ensure_watchdog(true);

            let desktop_host = find_desktop_host();
            emit_json(&format!(
                r#"{{"event":"attached","hwnd":{},"desktopHost":{}}}"#,
                hwnd as u64, desktop_host as u64
            ));
            self.sync_z_order();
            self.schedule_sync(80);
        }

        fn update_config(&mut self, tool_window: bool, prevent_minimize: bool) {
            self.tool_window = tool_window;
            self.prevent_minimize = prevent_minimize;
            if self.is_attached() {
                self.apply_tool_window_style();
                self.sync_z_order();
            }
        }

        fn detach(&mut self) {
            let previous_hwnd = self.target_hwnd;
            self.cancel_all_timers();
            self.restore_tool_window_style();
            if previous_hwnd != 0 && unsafe { IsWindow(previous_hwnd) != 0 } {
                set_dwm_transitions_disabled(previous_hwnd, false);
            }
            self.target_hwnd = 0;
            self.target_pid = 0;
            self.last_phase.clear();
            self.pending_restore_deadline = 0;
            if previous_hwnd != 0 {
                emit_json(&format!(
                    r#"{{"event":"detached","hwnd":{}}}"#,
                    previous_hwnd as u64
                ));
            }
        }

        fn apply_tool_window_style(&mut self) {
            if !self.is_attached() {
                return;
            }
            if self.tool_window {
                unsafe {
                    let current_ex = get_window_long_ptr(self.target_hwnd, GWL_EXSTYLE);
                    let mask = WS_EX_TOOLWINDOW | WS_EX_APPWINDOW;
                    if !self.tool_window_applied {
                        self.saved_ex_bits = Some(current_ex & mask);
                    }
                    let next_ex = (current_ex | WS_EX_TOOLWINDOW) & !WS_EX_APPWINDOW;
                    if next_ex != current_ex {
                        set_window_long_ptr(self.target_hwnd, GWL_EXSTYLE, next_ex);
                        SetWindowPos(
                            self.target_hwnd,
                            0,
                            0,
                            0,
                            0,
                            0,
                            SWP_NOMOVE
                                | SWP_NOSIZE
                                | SWP_NOZORDER
                                | SWP_NOACTIVATE
                                | SWP_FRAMECHANGED,
                        );
                    }
                    self.tool_window_applied = true;
                }
            } else {
                self.restore_tool_window_style();
            }
        }

        fn restore_tool_window_style(&mut self) {
            if !self.tool_window_applied {
                self.saved_ex_bits = None;
                return;
            }
            if self.target_hwnd != 0 && unsafe { IsWindow(self.target_hwnd) != 0 } {
                if let Some(original_bits) = self.saved_ex_bits {
                    unsafe {
                        let current_ex = get_window_long_ptr(self.target_hwnd, GWL_EXSTYLE);
                        let mask = WS_EX_TOOLWINDOW | WS_EX_APPWINDOW;
                        let restored_ex = (current_ex & !mask) | (original_bits & mask);
                        if restored_ex != current_ex {
                            set_window_long_ptr(self.target_hwnd, GWL_EXSTYLE, restored_ex);
                            SetWindowPos(
                                self.target_hwnd,
                                0,
                                0,
                                0,
                                0,
                                0,
                                SWP_NOMOVE
                                    | SWP_NOSIZE
                                    | SWP_NOZORDER
                                    | SWP_NOACTIVATE
                                    | SWP_FRAMECHANGED,
                            );
                        }
                    }
                }
            }
            self.saved_ex_bits = None;
            self.tool_window_applied = false;
        }

        fn is_folia_active_foreground(&self) -> bool {
            if self.target_hwnd == 0 {
                return false;
            }
            let fg_hwnd = unsafe { GetForegroundWindow() };
            if fg_hwnd == 0 {
                return false;
            }
            if fg_hwnd == self.target_hwnd {
                return true;
            }
            let owner = unsafe { GetWindow(fg_hwnd, GW_OWNER) };
            if owner == self.target_hwnd {
                return true;
            }
            if self.folia_was_foreground
                && self.target_pid != 0
                && get_window_pid(fg_hwnd) == self.target_pid
                && get_class_name(fg_hwnd) == "#32768"
            {
                return true;
            }
            false
        }

        fn emit_phase(&mut self, phase: &str, desktop_host: HWND) {
            if self.last_phase == phase {
                return;
            }
            self.last_phase.clear();
            self.last_phase.push_str(phase);
            emit_json(&format!(
                r#"{{"event":"state","phase":"{}","hwnd":{},"desktopHost":{}}}"#,
                phase, self.target_hwnd as u64, desktop_host as u64
            ));
        }

        fn sync_z_order(&mut self) {
            if self.target_hwnd == 0 {
                return;
            }
            unsafe {
                if IsWindow(self.target_hwnd) == 0 {
                    self.detach();
                    return;
                }
                if IsWindowVisible(self.target_hwnd) == 0 {
                    self.emit_phase("hidden", 0);
                    return;
                }
                if IsIconic(self.target_hwnd) != 0 {
                    self.emit_phase("minimized", 0);
                    return;
                }
                let ex_style = get_window_long_ptr(self.target_hwnd, GWL_EXSTYLE);
                if (ex_style & WS_EX_TOPMOST) != 0 {
                    self.emit_phase("paused_topmost", 0);
                    return;
                }
                if self.tool_window
                    && ((ex_style & WS_EX_TOOLWINDOW) == 0 || (ex_style & WS_EX_APPWINDOW) != 0)
                {
                    self.apply_tool_window_style();
                }
            }

            let desktop_host = find_desktop_host();
            if self.is_folia_active_foreground()
                && (desktop_host == 0 || is_window_above(desktop_host, self.target_hwnd))
            {
                self.folia_was_foreground = true;
                self.emit_phase("front", desktop_host);
                return;
            }

            self.folia_was_foreground = false;
            if desktop_host == 0 || unsafe { IsWindow(desktop_host) == 0 } {
                return;
            }

            unsafe {
                let mut cursor = GetWindow(desktop_host, GW_HWNDPREV);
                let mut insert_after: HWND = HWND_NOTOPMOST;
                let mut already_in_desktop_band = false;
                let mut steps = 0usize;

                while cursor != 0 && steps < 512 {
                    steps += 1;
                    if cursor == self.target_hwnd {
                        already_in_desktop_band = true;
                        break;
                    }

                    let cursor_ex = get_window_long_ptr(cursor, GWL_EXSTYLE);
                    if (cursor_ex & WS_EX_TOPMOST) != 0 {
                        break;
                    }

                    let visible = IsWindowVisible(cursor) != 0;
                    let is_desktop_widget =
                        (cursor_ex & WS_EX_TOOLWINDOW) != 0 && (cursor_ex & WS_EX_NOACTIVATE) != 0;
                    if visible && !is_desktop_widget {
                        insert_after = cursor;
                        break;
                    }

                    cursor = GetWindow(cursor, GW_HWNDPREV);
                }

                if !already_in_desktop_band {
                    SetWindowPos(
                        self.target_hwnd,
                        insert_after,
                        0,
                        0,
                        0,
                        0,
                        SWP_NOMOVE | SWP_NOSIZE | SWP_NOACTIVATE | SWP_NOOWNERZORDER,
                    );
                }
            }

            self.emit_phase("desktop", desktop_host);
        }

        fn restore_from_win_d(&mut self) {
            if !self.is_attached() || !self.prevent_minimize {
                return;
            }
            unsafe {
                if IsWindowVisible(self.target_hwnd) != 0 && IsIconic(self.target_hwnd) != 0 {
                    ShowWindow(self.target_hwnd, SW_SHOWNOACTIVATE);
                }
            }
            self.pending_restore_deadline = 0;
            self.sync_z_order();
            self.schedule_sync(60);
        }

        fn should_restore_minimized(&self, now: u64, desktop_host: HWND) -> bool {
            if !self.prevent_minimize {
                return false;
            }
            if !self.folia_was_foreground {
                return true;
            }
            if now.saturating_sub(self.last_desktop_fg_tick) <= 450 {
                return true;
            }
            if now.saturating_sub(self.last_other_minimize_tick) <= 350 {
                return true;
            }
            let win_held = is_key_down(VK_LWIN) || is_key_down(VK_RWIN);
            if win_held && (is_key_down(VK_KEY_D) || is_key_down(VK_KEY_M)) {
                return true;
            }
            let fg_hwnd = unsafe { GetForegroundWindow() };
            if is_desktop_or_shell_hwnd(fg_hwnd, desktop_host) {
                return true;
            }
            false
        }

        fn on_win_event(&mut self, event: DWORD, hwnd: HWND, id_object: LONG, id_child: LONG) {
            if !self.is_attached() {
                return;
            }
            let now = tick_now();
            match event {
                EVENT_SYSTEM_FOREGROUND => {
                    let desktop_host = find_desktop_host();
                    if is_desktop_or_shell_hwnd(hwnd, desktop_host) {
                        self.last_desktop_fg_tick = now;
                        if self.prevent_minimize
                            && unsafe {
                                IsWindowVisible(self.target_hwnd) != 0
                                    && IsIconic(self.target_hwnd) != 0
                            }
                            && (now.saturating_sub(self.last_folia_minimize_tick) <= 600
                                || now <= self.pending_restore_deadline)
                        {
                            self.restore_from_win_d();
                            return;
                        }
                    }

                    if self.is_folia_active_foreground() {
                        self.folia_was_foreground = true;
                        if desktop_host != 0 && !is_window_above(desktop_host, self.target_hwnd) {
                            self.sync_z_order();
                        } else {
                            self.emit_phase("front", desktop_host);
                        }
                    } else {
                        self.folia_was_foreground = false;
                        self.sync_z_order();
                        self.schedule_sync(20);
                    }
                }
                EVENT_SYSTEM_MINIMIZESTART => {
                    if id_object != OBJID_WINDOW || id_child != CHILDID_SELF {
                        return;
                    }
                    if hwnd == self.target_hwnd {
                        self.last_folia_minimize_tick = now;
                        let desktop_host = find_desktop_host();
                        if self.should_restore_minimized(now, desktop_host) {
                            self.restore_from_win_d();
                        } else if self.prevent_minimize {
                            self.pending_restore_deadline = now + 220;
                            self.schedule_restore_check(55);
                        }
                    } else if hwnd != 0 {
                        self.last_other_minimize_tick = now;
                        if now <= self.pending_restore_deadline
                            && unsafe {
                                IsWindowVisible(self.target_hwnd) != 0
                                    && IsIconic(self.target_hwnd) != 0
                            }
                        {
                            self.restore_from_win_d();
                        }
                    }
                }
                EVENT_SYSTEM_MINIMIZEEND => {
                    if hwnd == self.target_hwnd {
                        self.schedule_sync(30);
                    }
                }
                EVENT_SYSTEM_MOVESIZEEND => {
                    if hwnd == self.target_hwnd {
                        self.schedule_sync(30);
                    }
                }
                EVENT_OBJECT_SHOW => {
                    if id_child != CHILDID_SELF
                        || (id_object != OBJID_WINDOW && id_object != OBJID_CLIENT)
                    {
                        return;
                    }
                    let desktop_window = unsafe { GetDesktopWindow() };
                    if hwnd == self.target_hwnd || hwnd == desktop_window {
                        self.sync_z_order();
                        return;
                    }
                    let cls = get_class_name(hwnd);
                    if matches!(cls.as_str(), "WorkerW" | "Progman" | "SHELLDLL_DefView") {
                        self.sync_z_order();
                    }
                }
                EVENT_OBJECT_CREATE..=EVENT_OBJECT_REORDER => {
                    if event != EVENT_OBJECT_REORDER
                        && (id_child != CHILDID_SELF
                            || (id_object != OBJID_WINDOW && id_object != OBJID_CLIENT))
                    {
                        return;
                    }
                    let desktop_window = unsafe { GetDesktopWindow() };
                    if hwnd == 0 || hwnd == desktop_window {
                        self.sync_z_order();
                        return;
                    }
                    let cls = get_class_name(hwnd);
                    if matches!(cls.as_str(), "WorkerW" | "Progman" | "SHELLDLL_DefView") {
                        self.sync_z_order();
                    }
                }
                _ => {}
            }
        }

        fn on_timer(&mut self, timer_id: usize) {
            if timer_id == self.sync_timer_id && timer_id != 0 {
                unsafe {
                    KillTimer(0, self.sync_timer_id);
                }
                self.sync_timer_id = 0;
                self.sync_z_order();
                return;
            }
            if timer_id == self.restore_timer_id && timer_id != 0 {
                unsafe {
                    KillTimer(0, self.restore_timer_id);
                }
                self.restore_timer_id = 0;
                let now = tick_now();
                let desktop_host = find_desktop_host();
                if self.is_attached()
                    && unsafe {
                        IsWindowVisible(self.target_hwnd) != 0 && IsIconic(self.target_hwnd) != 0
                    }
                    && self.should_restore_minimized(now, desktop_host)
                {
                    self.restore_from_win_d();
                } else {
                    self.pending_restore_deadline = 0;
                }
                return;
            }
            if timer_id == self.watchdog_timer_id && timer_id != 0 {
                if self.is_attached() {
                    self.sync_z_order();
                } else {
                    self.ensure_watchdog(false);
                }
            }
        }

        fn schedule_sync(&mut self, delay_ms: UINT) {
            unsafe {
                let id = SetTimer(0, self.sync_timer_id, delay_ms, None);
                if id != 0 {
                    self.sync_timer_id = id;
                }
            }
        }

        fn schedule_restore_check(&mut self, delay_ms: UINT) {
            unsafe {
                let id = SetTimer(0, self.restore_timer_id, delay_ms, None);
                if id != 0 {
                    self.restore_timer_id = id;
                }
            }
        }

        fn ensure_watchdog(&mut self, enabled: bool) {
            if enabled {
                if self.watchdog_timer_id == 0 {
                    unsafe {
                        let id = SetTimer(0, 0, WATCHDOG_INTERVAL_MS, None);
                        if id != 0 {
                            self.watchdog_timer_id = id;
                        }
                    }
                }
            } else if self.watchdog_timer_id != 0 {
                unsafe {
                    KillTimer(0, self.watchdog_timer_id);
                }
                self.watchdog_timer_id = 0;
            }
        }

        fn cancel_all_timers(&mut self) {
            unsafe {
                if self.sync_timer_id != 0 {
                    KillTimer(0, self.sync_timer_id);
                    self.sync_timer_id = 0;
                }
                if self.restore_timer_id != 0 {
                    KillTimer(0, self.restore_timer_id);
                    self.restore_timer_id = 0;
                }
                if self.watchdog_timer_id != 0 {
                    KillTimer(0, self.watchdog_timer_id);
                    self.watchdog_timer_id = 0;
                }
            }
        }
    }

    static CMD_QUEUE: OnceLock<Mutex<VecDeque<Command>>> = OnceLock::new();

    thread_local! {
        static CONTROLLER: RefCell<Controller> = RefCell::new(Controller::default());
    }

    unsafe extern "system" fn win_event_callback(
        _hook: HWINEVENTHOOK,
        event: DWORD,
        hwnd: HWND,
        id_object: LONG,
        id_child: LONG,
        _id_event_thread: DWORD,
        _event_time: DWORD,
    ) {
        CONTROLLER.with(|cell| {
            if let Ok(mut ctrl) = cell.try_borrow_mut() {
                ctrl.on_win_event(event, hwnd, id_object, id_child);
            }
        });
    }

    fn spawn_stdin_reader(main_thread_id: DWORD) {
        let queue = CMD_QUEUE.get_or_init(|| Mutex::new(VecDeque::new()));
        thread::spawn(move || {
            let stdin = io::stdin();
            for line_result in stdin.lock().lines() {
                let Ok(line) = line_result else {
                    break;
                };
                let trimmed = line.trim();
                if trimmed.is_empty() {
                    continue;
                }
                if let Some(cmd) = parse_command(trimmed) {
                    let is_quit = matches!(cmd, Command::Quit);
                    if let Ok(mut locked) = queue.lock() {
                        locked.push_back(cmd);
                    }
                    unsafe {
                        PostThreadMessageW(
                            main_thread_id,
                            if is_quit { WM_APP_QUIT } else { WM_APP_CMD },
                            0,
                            0,
                        );
                    }
                    if is_quit {
                        return;
                    }
                }
            }
            unsafe {
                PostThreadMessageW(main_thread_id, WM_APP_QUIT, 0, 0);
            }
        });
    }

    fn drain_commands() -> bool {
        let Some(queue) = CMD_QUEUE.get() else {
            return false;
        };
        let drained: Vec<Command> = {
            let Ok(mut locked) = queue.lock() else {
                return false;
            };
            locked.drain(..).collect()
        };

        let mut should_quit = false;
        CONTROLLER.with(|cell| {
            let mut ctrl = cell.borrow_mut();
            for cmd in drained {
                match cmd {
                    Command::Attach {
                        hwnd,
                        pid,
                        tool_window,
                        prevent_minimize,
                    } => ctrl.attach(hwnd, pid, tool_window, prevent_minimize),
                    Command::Config {
                        tool_window,
                        prevent_minimize,
                    } => ctrl.update_config(tool_window, prevent_minimize),
                    Command::Sink => ctrl.sync_z_order(),
                    Command::Detach => ctrl.detach(),
                    Command::Quit => {
                        ctrl.detach();
                        should_quit = true;
                    }
                }
            }
        });
        should_quit
    }

    pub fn run() {
        let main_thread_id = unsafe { GetCurrentThreadId() };

        // Initialize the thread message queue before spawning stdin reader thread.
        let mut init_msg = MSG::default();
        unsafe {
            PeekMessageW(&mut init_msg, 0, 0, 0, PM_NOREMOVE);
        }

        let flags = WINEVENT_OUTOFCONTEXT | WINEVENT_SKIPOWNPROCESS;
        let hooks = unsafe {
            [
                SetWinEventHook(
                    EVENT_SYSTEM_FOREGROUND,
                    EVENT_SYSTEM_FOREGROUND,
                    0,
                    win_event_callback,
                    0,
                    0,
                    flags,
                ),
                SetWinEventHook(
                    EVENT_SYSTEM_MOVESIZEEND,
                    EVENT_SYSTEM_MOVESIZEEND,
                    0,
                    win_event_callback,
                    0,
                    0,
                    flags,
                ),
                SetWinEventHook(
                    EVENT_SYSTEM_MINIMIZESTART,
                    EVENT_SYSTEM_MINIMIZEEND,
                    0,
                    win_event_callback,
                    0,
                    0,
                    flags,
                ),
                SetWinEventHook(
                    EVENT_OBJECT_CREATE,
                    EVENT_OBJECT_REORDER,
                    0,
                    win_event_callback,
                    0,
                    0,
                    flags,
                ),
            ]
        };

        spawn_stdin_reader(main_thread_id);
        emit_json(r#"{"event":"ready"}"#);

        let mut msg = MSG::default();
        loop {
            let status = unsafe { GetMessageW(&mut msg, 0, 0, 0) };
            if status <= 0 {
                break;
            }
            if msg.hwnd == 0 {
                match msg.message {
                    WM_APP_CMD => {
                        if drain_commands() {
                            break;
                        }
                        continue;
                    }
                    WM_APP_QUIT => {
                        let _ = drain_commands();
                        CONTROLLER.with(|cell| cell.borrow_mut().detach());
                        break;
                    }
                    WM_TIMER => {
                        CONTROLLER.with(|cell| cell.borrow_mut().on_timer(msg.w_param));
                        continue;
                    }
                    _ => {}
                }
            }
            unsafe {
                TranslateMessage(&msg);
                DispatchMessageW(&msg);
            }
        }

        CONTROLLER.with(|cell| cell.borrow_mut().detach());
        for hook in hooks {
            if hook != 0 {
                unsafe {
                    UnhookWinEvent(hook);
                }
            }
        }
    }
}

#[cfg(windows)]
fn main() {
    win_app::run();
}

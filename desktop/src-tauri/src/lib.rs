#[cfg(target_os = "windows")]
use std::process::{Command as StdCommand, Stdio};
use std::{
    collections::VecDeque,
    fs,
    io::{Error as IoError, ErrorKind},
    net::{SocketAddr, TcpListener, TcpStream},
    path::{Path, PathBuf},
    str,
    sync::{Arc, Mutex},
    time::{Duration, Instant},
};

use serde::{Deserialize, Serialize};
use tauri::menu::MenuBuilder;
#[cfg(target_os = "macos")]
use tauri::menu::{MenuItemBuilder, SubmenuBuilder};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::Emitter;
use tauri::{AppHandle, Manager, PhysicalPosition, PhysicalSize, RunEvent, State, WindowEvent};
use tauri_plugin_shell::{
    process::{CommandChild, CommandEvent},
    ShellExt,
};

#[cfg(target_os = "macos")]
mod macos_notifications {
    use std::ffi::{CStr, CString};
    use std::os::raw::{c_char, c_int};
    use std::sync::{Mutex, OnceLock};

    use serde::Serialize;
    use tauri::{AppHandle, Emitter};

    const ERROR_BUFFER_LEN: usize = 1024;

    unsafe extern "C" {
        fn dc_notification_authorization_status(
            error_buffer: *mut c_char,
            error_buffer_len: usize,
        ) -> c_int;
        fn dc_request_notification_authorization(
            error_buffer: *mut c_char,
            error_buffer_len: usize,
        ) -> bool;
        fn dc_send_user_notification(
            title: *const c_char,
            body: *const c_char,
            target: *const c_char,
            error_buffer: *mut c_char,
            error_buffer_len: usize,
        ) -> bool;
        fn dc_set_notification_response_callback(callback: Option<extern "C" fn(*const c_char)>);
    }

    #[derive(Clone, Serialize)]
    #[serde(rename_all = "camelCase")]
    struct NotificationClickPayload {
        target: Option<String>,
    }

    static NOTIFICATION_APP_HANDLE: OnceLock<Mutex<Option<AppHandle>>> = OnceLock::new();

    fn new_error_buffer() -> [c_char; ERROR_BUFFER_LEN] {
        [0; ERROR_BUFFER_LEN]
    }

    fn read_error(buffer: &[c_char; ERROR_BUFFER_LEN]) -> Option<String> {
        let message = unsafe { CStr::from_ptr(buffer.as_ptr()) }
            .to_string_lossy()
            .trim()
            .to_string();
        if message.is_empty() {
            None
        } else {
            Some(message)
        }
    }

    fn permission_from_status(status: c_int) -> &'static str {
        match status {
            1 => "denied",
            2 | 3 | 4 => "granted",
            _ => "default",
        }
    }

    pub fn permission_state() -> Result<String, String> {
        let mut error_buffer = new_error_buffer();
        let status = unsafe {
            dc_notification_authorization_status(error_buffer.as_mut_ptr(), ERROR_BUFFER_LEN)
        };

        if status < 0 {
            return Err(read_error(&error_buffer)
                .unwrap_or_else(|| "failed to read macOS notification permission".to_string()));
        }

        Ok(permission_from_status(status).to_string())
    }

    pub fn request_permission() -> Result<String, String> {
        let mut error_buffer = new_error_buffer();
        let granted = unsafe {
            dc_request_notification_authorization(error_buffer.as_mut_ptr(), ERROR_BUFFER_LEN)
        };

        if granted {
            return Ok("granted".to_string());
        }

        if let Some(error) = read_error(&error_buffer) {
            return Err(error);
        }

        permission_state()
    }

    extern "C" fn handle_notification_response(target: *const c_char) {
        let target = if target.is_null() {
            None
        } else {
            let value = unsafe { CStr::from_ptr(target) }
                .to_string_lossy()
                .trim()
                .to_string();
            (!value.is_empty()).then_some(value)
        };

        let Some(app) = NOTIFICATION_APP_HANDLE
            .get()
            .and_then(|handle| handle.lock().ok().and_then(|guard| guard.clone()))
        else {
            return;
        };

        super::show_main_window(&app);
        let _ = app.emit(
            "desktop-notification-clicked",
            NotificationClickPayload { target },
        );
    }

    pub fn install_click_handler(app: AppHandle) {
        let handle = NOTIFICATION_APP_HANDLE.get_or_init(|| Mutex::new(None));
        if let Ok(mut guard) = handle.lock() {
            *guard = Some(app);
        }
        unsafe { dc_set_notification_response_callback(Some(handle_notification_response)) };
    }

    pub fn send_notification(
        title: String,
        body: Option<String>,
        target: Option<String>,
    ) -> Result<bool, String> {
        let title = CString::new(title)
            .map_err(|_| "notification title contains an unsupported NUL byte".to_string())?;
        let body = body
            .map(CString::new)
            .transpose()
            .map_err(|_| "notification body contains an unsupported NUL byte".to_string())?;
        let target = target
            .map(CString::new)
            .transpose()
            .map_err(|_| "notification target contains an unsupported NUL byte".to_string())?;

        let mut error_buffer = new_error_buffer();
        let sent = unsafe {
            dc_send_user_notification(
                title.as_ptr(),
                body.as_ref()
                    .map_or(std::ptr::null(), |value| value.as_ptr()),
                target
                    .as_ref()
                    .map_or(std::ptr::null(), |value| value.as_ptr()),
                error_buffer.as_mut_ptr(),
                ERROR_BUFFER_LEN,
            )
        };

        if sent {
            return Ok(true);
        }

        match read_error(&error_buffer).as_deref() {
            Some("not_authorized") | None => Ok(false),
            Some(error) => Err(error.to_string()),
        }
    }
}

#[cfg(not(target_os = "macos"))]
mod macos_notifications {
    use tauri::AppHandle;

    pub fn permission_state() -> Result<String, String> {
        Ok("unsupported".to_string())
    }

    pub fn request_permission() -> Result<String, String> {
        Ok("unsupported".to_string())
    }

    pub fn install_click_handler(_app: AppHandle) {}

    pub fn send_notification(
        _title: String,
        _body: Option<String>,
        _target: Option<String>,
    ) -> Result<bool, String> {
        Ok(false)
    }
}

const SERVER_STARTUP_LOG_LIMIT: usize = 80;
const SERVER_BIND_HOST: &str = "0.0.0.0";
const SERVER_CONTROL_HOST: &str = "127.0.0.1";
const MAIN_WINDOW_LABEL: &str = "main";
const TRAY_SHOW_ID: &str = "tray_show";
const TRAY_QUIT_ID: &str = "tray_quit";
const WINDOW_STATE_FILE: &str = "window-state.json";
const TERMINAL_CONFIG_FILE: &str = "terminal-config.json";
const APP_MODE_FILE: &str = "app-mode.json";
/// DreamCoder's config directory variable. Claude Code's own variable is not used.
pub const CONFIG_DIR_ENV: &str = "DREAMCODER_CONFIG_DIR";
/// Name of the portable data folder next to the executable. It predates
/// `DREAMCODER_CONFIG_DIR` and is kept so existing portable installs keep their data.
pub const PORTABLE_DIR_NAME: &str = "CLAUDE_CONFIG_DIR";
/// Set when the config directory came from portable mode rather than the launch environment.
pub const PORTABLE_MARKER_ENV: &str = "DREAMCODER_APP_PORTABLE_DIR";
const MIN_WINDOW_WIDTH: u32 = 960;
const MIN_WINDOW_HEIGHT: u32 = 640;
const MIN_VISIBLE_PIXELS: i64 = 64;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
enum AppMode {
    #[serde(alias = "Default")]
    Default,
    #[serde(alias = "Portable")]
    Portable,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct AppModeConfig {
    #[serde(default = "default_app_mode")]
    mode: AppMode,
    #[serde(default)]
    portable_dir: Option<String>,
}

fn default_app_mode() -> AppMode {
    AppMode::Default
}

impl Default for AppModeConfig {
    fn default() -> Self {
        Self {
            mode: AppMode::Default,
            portable_dir: None,
        }
    }
}

fn write_app_mode_config(config_dir: &Path, config: &AppModeConfig) {
    let path = config_dir.join(APP_MODE_FILE);
    if let Some(parent) = path.parent() {
        if let Err(e) = fs::create_dir_all(parent) {
            eprintln!("[desktop] failed to create dir for app-mode.json: {e}");
            return;
        }
    }
    let data = match serde_json::to_string_pretty(config) {
        Ok(data) => data,
        Err(e) => {
            eprintln!("[desktop] failed to serialize app-mode.json: {e}");
            return;
        }
    };
    if let Err(e) = fs::write(&path, data) {
        eprintln!("[desktop] failed to write app-mode.json: {e}");
    }
}

fn dir_has_portable_data(dir: &Path) -> bool {
    if !dir.is_dir() {
        return false;
    }
    [
        "settings.json",
        ".claude.json",
        ".mcp.json",
        WINDOW_STATE_FILE,
        TERMINAL_CONFIG_FILE,
    ]
        .iter()
        .any(|f| dir.join(f).is_file())
        || dir.join("Cache").is_dir()
        || dir.join("EBWebView").is_dir()
        || dir.join("projects").is_dir()
        || dir.join("skills").is_dir()
        || dir.join("plugins").is_dir()
        || dir.join("cowork_plugins").is_dir()
        || dir.join("dreamcoder").is_dir()
}

fn get_default_portable_dir() -> Option<PathBuf> {
    let exe = std::env::current_exe().ok()?;
    let mut dir = exe.parent()?.to_path_buf();
    dir.push(PORTABLE_DIR_NAME);
    Some(dir)
}

fn legacy_terminal_config_path(app: &AppHandle) -> Option<PathBuf> {
    std::env::var(CONFIG_DIR_ENV)
        .ok()
        .map(|dir| PathBuf::from(&dir).join(TERMINAL_CONFIG_FILE))
        .or_else(|| match app.path().app_config_dir() {
            Ok(dir) => Some(dir.join(TERMINAL_CONFIG_FILE)),
            Err(err) => {
                eprintln!("[desktop] failed to resolve app config dir: {err}");
                None
            }
        })
}

#[derive(Default)]
struct ServerState(Mutex<ServerStatus>);

struct ServerRuntime {
    url: String,
    child: CommandChild,
}

#[derive(Default)]
struct ServerStatus {
    runtime: Option<ServerRuntime>,
    startup_error: Option<String>,
}

#[derive(Default)]
struct AppExitState {
    is_quitting: Mutex<bool>,
}

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
struct StoredWindowState {
    x: i32,
    y: i32,
    width: u32,
    height: u32,
    maximized: bool,
}

#[tauri::command]
fn get_server_url(state: State<'_, ServerState>) -> Result<String, String> {
    let guard = state
        .0
        .lock()
        .map_err(|_| "desktop server state is unavailable".to_string())?;

    if let Some(runtime) = guard.runtime.as_ref() {
        return Ok(runtime.url.clone());
    }

    Err(guard
        .startup_error
        .clone()
        .unwrap_or_else(|| "desktop server did not start".to_string()))
}

#[tauri::command]
fn prepare_for_update_install(app: AppHandle) -> Result<(), String> {
    mark_app_quitting(&app);
    stop_server_sidecar(&app);

    #[cfg(target_os = "windows")]
    {
        kill_windows_sidecars();
    }

    std::thread::sleep(Duration::from_millis(750));
    Ok(())
}

#[tauri::command]
fn prepare_for_app_mode_restart(app: AppHandle) -> Result<(), String> {
    mark_app_quitting(&app);
    stop_server_sidecar(&app);

    // The relaunched process inherits this environment. Drop the directory that
    // portable mode set so it reads app-mode.json again; a directory from the
    // launch environment has no marker and stays.
    if std::env::var_os(PORTABLE_MARKER_ENV).is_some() {
        std::env::remove_var(CONFIG_DIR_ENV);
        std::env::remove_var(PORTABLE_MARKER_ENV);
    }

    #[cfg(target_os = "windows")]
    {
        kill_windows_sidecars();
    }

    std::thread::sleep(Duration::from_millis(300));
    Ok(())
}

/// Session exports (#133) are rendered by the server and written here, to the
/// path the user picked in the native save dialog. Only .md and .json files.
fn validate_export_path(path: &str) -> Result<PathBuf, String> {
    let path = PathBuf::from(path);
    if !path.is_absolute() {
        return Err("Export path must be absolute".to_string());
    }
    let extension = path
        .extension()
        .and_then(|value| value.to_str())
        .map(|value| value.to_ascii_lowercase());
    match extension.as_deref() {
        Some("md") | Some("markdown") | Some("json") => Ok(path),
        _ => Err("Exports must be .md or .json files".to_string()),
    }
}

#[tauri::command]
fn write_session_export(path: String, contents: String) -> Result<(), String> {
    let path = validate_export_path(&path)?;
    fs::write(&path, contents).map_err(|err| format!("Could not write {}: {err}", path.display()))
}

#[tauri::command]
fn cancel_update_install(app: AppHandle) -> Result<(), String> {
    clear_app_quitting(&app);
    Ok(())
}

#[tauri::command]
fn get_app_mode(_app: AppHandle) -> serde_json::Value {
    let env_config_dir = std::env::var(CONFIG_DIR_ENV).ok().map(PathBuf::from);
    let config_dir_source = if env_config_dir.is_some() {
        if std::env::var_os(PORTABLE_MARKER_ENV).is_some() {
            "portable"
        } else {
            "environment"
        }
    } else {
        "system"
    };
    let config_dir = env_config_dir.clone().or_else(get_default_portable_dir);

    serde_json::json!({
        "mode": if env_config_dir.is_some() { "portable" } else { "default" },
        "portableDir": config_dir.as_ref().and_then(|p| p.to_str()),
        "defaultPortableDir": get_default_portable_dir().as_ref().and_then(|p| p.to_str()),
        "configDirSource": config_dir_source,
    })
}

#[tauri::command]
fn set_app_mode(
    app: tauri::AppHandle,
    mode: String,
    portable_dir: Option<String>,
) -> Result<(), String> {
    let active_config_dir = if let Ok(cd) = std::env::var(CONFIG_DIR_ENV) {
        std::path::PathBuf::from(&cd)
    } else {
        app.path()
            .app_config_dir()
            .map_err(|e| format!("resolve app config dir: {e}"))?
    };

    let (app_mode, portable_dir, target_portable_dir) = if mode == "portable" {
        let selected_dir = portable_dir
            .as_deref()
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .map(PathBuf::from)
            .or_else(get_default_portable_dir)
            .ok_or_else(|| "portable config directory is unavailable".to_string())?;

        if selected_dir.exists() && !selected_dir.is_dir() {
            return Err(format!(
                "portable config path is not a directory: {}",
                selected_dir.display()
            ));
        }

        fs::create_dir_all(&selected_dir)
            .map_err(|e| format!("create portable config directory: {e}"))?;

        let persisted_portable_dir = if get_default_portable_dir().as_ref() == Some(&selected_dir) {
            None
        } else {
            Some(selected_dir.to_string_lossy().to_string())
        };

        (
            AppMode::Portable,
            persisted_portable_dir,
            Some(selected_dir),
        )
    } else {
        (AppMode::Default, None, None)
    };

    let config = AppModeConfig {
        mode: app_mode,
        portable_dir: portable_dir.clone(),
    };

    write_app_mode_config(&active_config_dir, &config);

    if let Some(dir) = target_portable_dir.as_ref() {
        if dir != &active_config_dir {
            write_app_mode_config(dir, &config);
        }
    }

    if let Ok(sys_dir) = app.path().app_config_dir() {
        if sys_dir != active_config_dir {
            write_app_mode_config(&sys_dir, &config);
        }
    }

    Ok(())
}

#[tauri::command]
fn detect_portable_dir() -> serde_json::Value {
    let default_portable = get_default_portable_dir();
    let has_data = default_portable
        .as_ref()
        .map(|d| dir_has_portable_data(d))
        .unwrap_or(false);
    serde_json::json!({
        "defaultPortableDir": default_portable.as_ref().and_then(|p| p.to_str()),
        "hasData": has_data,
    })
}

fn set_app_quitting(app: &AppHandle, next: bool) {
    if let Some(state) = app.try_state::<AppExitState>() {
        if let Ok(mut is_quitting) = state.is_quitting.lock() {
            *is_quitting = next;
        }
    }
}

fn mark_app_quitting(app: &AppHandle) {
    set_app_quitting(app, true);
}

fn clear_app_quitting(app: &AppHandle) {
    set_app_quitting(app, false);
}

fn should_hide_to_tray(app: &AppHandle, label: &str) -> bool {
    if label != MAIN_WINDOW_LABEL {
        return false;
    }

    app.try_state::<AppExitState>()
        .and_then(|state| state.is_quitting.lock().ok().map(|value| !*value))
        .unwrap_or(true)
}

fn is_persistable_window_state(state: &StoredWindowState) -> bool {
    state.width >= MIN_WINDOW_WIDTH && state.height >= MIN_WINDOW_HEIGHT
}

fn has_meaningful_intersection(
    state: &StoredWindowState,
    monitor_x: i32,
    monitor_y: i32,
    monitor_width: u32,
    monitor_height: u32,
) -> bool {
    let left = state.x as i64;
    let top = state.y as i64;
    let right = left + state.width as i64;
    let bottom = top + state.height as i64;

    let monitor_left = monitor_x as i64;
    let monitor_top = monitor_y as i64;
    let monitor_right = monitor_left + monitor_width as i64;
    let monitor_bottom = monitor_top + monitor_height as i64;

    right > monitor_left + MIN_VISIBLE_PIXELS
        && bottom > monitor_top + MIN_VISIBLE_PIXELS
        && left < monitor_right - MIN_VISIBLE_PIXELS
        && top < monitor_bottom - MIN_VISIBLE_PIXELS
}

fn is_window_state_visible_on_any_monitor(
    state: &StoredWindowState,
    monitors: &[tauri::Monitor],
) -> bool {
    if monitors.is_empty() {
        return true;
    }

    monitors.iter().any(|monitor| {
        let position = monitor.position();
        let size = monitor.size();
        has_meaningful_intersection(state, position.x, position.y, size.width, size.height)
    })
}

fn window_state_path(app: &AppHandle) -> Option<PathBuf> {
    resolve_portable_state_path().or_else(|| match app.path().app_config_dir() {
        Ok(dir) => Some(dir.join(WINDOW_STATE_FILE)),
        Err(err) => {
            eprintln!("[desktop] failed to resolve app config dir: {err}");
            None
        }
    })
}

fn resolve_portable_state_path() -> Option<PathBuf> {
    std::env::var(CONFIG_DIR_ENV)
        .ok()
        .map(|dir| PathBuf::from(&dir).join(WINDOW_STATE_FILE))
}

fn read_stored_window_state(app: &AppHandle) -> Option<StoredWindowState> {
    let path = window_state_path(app)?;
    let data = match fs::read_to_string(&path) {
        Ok(data) => data,
        Err(err) if err.kind() == ErrorKind::NotFound => return None,
        Err(err) => {
            eprintln!(
                "[desktop] failed to read window state {}: {err}",
                path.display()
            );
            return None;
        }
    };

    match serde_json::from_str::<StoredWindowState>(&data) {
        Ok(state) if is_persistable_window_state(&state) => Some(state),
        Ok(_) => None,
        Err(err) => {
            eprintln!(
                "[desktop] failed to parse window state {}: {err}",
                path.display()
            );
            None
        }
    }
}

fn write_stored_window_state(app: &AppHandle, state: &StoredWindowState) {
    if !is_persistable_window_state(state) {
        return;
    }

    let Some(path) = window_state_path(app) else {
        return;
    };

    if let Some(parent) = path.parent() {
        if let Err(err) = fs::create_dir_all(parent) {
            eprintln!(
                "[desktop] failed to create window state directory {}: {err}",
                parent.display()
            );
            return;
        }
    }

    let data = match serde_json::to_string_pretty(state) {
        Ok(data) => data,
        Err(err) => {
            eprintln!("[desktop] failed to serialize window state: {err}");
            return;
        }
    };

    if let Err(err) = fs::write(&path, data) {
        eprintln!(
            "[desktop] failed to write window state {}: {err}",
            path.display()
        );
    }
}

fn capture_window_state(window: &tauri::WebviewWindow) -> Option<StoredWindowState> {
    if window.is_minimized().unwrap_or(false) {
        return None;
    }

    let position = match window.outer_position() {
        Ok(position) => position,
        Err(err) => {
            eprintln!("[desktop] failed to read window position: {err}");
            return None;
        }
    };
    let size = match window.outer_size() {
        Ok(size) => size,
        Err(err) => {
            eprintln!("[desktop] failed to read window size: {err}");
            return None;
        }
    };

    let state = StoredWindowState {
        x: position.x,
        y: position.y,
        width: size.width,
        height: size.height,
        maximized: window.is_maximized().unwrap_or(false),
    };

    is_persistable_window_state(&state).then_some(state)
}

fn save_main_window_state(app: &AppHandle) {
    let Some(window) = app.get_webview_window(MAIN_WINDOW_LABEL) else {
        return;
    };
    let Some(state) = capture_window_state(&window) else {
        return;
    };

    write_stored_window_state(app, &state);
}

fn restore_main_window_state(app: &AppHandle) {
    let Some(window) = app.get_webview_window(MAIN_WINDOW_LABEL) else {
        return;
    };
    let Some(state) = read_stored_window_state(app) else {
        return;
    };

    let monitors = window.available_monitors().unwrap_or_default();
    if !is_window_state_visible_on_any_monitor(&state, &monitors) {
        return;
    }

    let _ = window.unmaximize();
    let _ = window.set_size(PhysicalSize::new(state.width, state.height));
    let _ = window.set_position(PhysicalPosition::new(state.x, state.y));
    if state.maximized {
        let _ = window.maximize();
    }
}

fn show_main_window(app: &AppHandle) {
    if let Some(window) = app.get_webview_window(MAIN_WINDOW_LABEL) {
        let _ = window.show();
        let _ = window.unminimize();
        let _ = window.set_focus();
    }
}

fn setup_system_tray(app: &mut tauri::App) -> tauri::Result<()> {
    let menu = MenuBuilder::new(app)
        .text(TRAY_SHOW_ID, "Show DreamCoder")
        .separator()
        .text(TRAY_QUIT_ID, "Quit DreamCoder")
        .build()?;

    let mut tray = TrayIconBuilder::with_id("main-tray")
        .tooltip("DreamCoder")
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_menu_event(|app, event| match event.id().as_ref() {
            TRAY_SHOW_ID => show_main_window(app),
            TRAY_QUIT_ID => {
                mark_app_quitting(app);
                app.exit(0);
            }
            _ => {}
        })
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } = event
            {
                show_main_window(tray.app_handle());
            }
        });

    if let Some(icon) = app.default_window_icon() {
        tray = tray.icon(icon.clone());
    }

    tray.build(app)?;

    Ok(())
}

#[tauri::command]
async fn macos_notification_permission_state() -> Result<String, String> {
    run_notification_bridge(macos_notifications::permission_state).await
}

#[tauri::command]
async fn macos_request_notification_permission() -> Result<String, String> {
    run_notification_bridge(macos_notifications::request_permission).await
}

#[tauri::command]
async fn macos_send_notification(
    title: String,
    body: Option<String>,
    target: Option<String>,
) -> Result<bool, String> {
    run_notification_bridge(move || macos_notifications::send_notification(title, body, target))
        .await
}

#[tauri::command]
fn open_windows_notification_settings() -> Result<bool, String> {
    open_windows_notification_settings_impl()
}

#[tauri::command]
fn set_app_zoom(window: tauri::WebviewWindow, zoom_factor: f64) -> Result<(), String> {
    let clamped = zoom_factor.clamp(0.5, 2.0);
    window
        .set_zoom(clamped)
        .map_err(|err| format!("set app zoom: {err}"))
}

#[cfg(target_os = "windows")]
fn open_windows_notification_settings_impl() -> Result<bool, String> {
    StdCommand::new("explorer.exe")
        .arg("ms-settings:notifications")
        .spawn()
        .map_err(|err| format!("open Windows notification settings: {err}"))?;

    Ok(true)
}

#[cfg(not(target_os = "windows"))]
fn open_windows_notification_settings_impl() -> Result<bool, String> {
    Ok(false)
}

async fn run_notification_bridge<T, F>(operation: F) -> Result<T, String>
where
    T: Send + 'static,
    F: FnOnce() -> Result<T, String> + Send + 'static,
{
    tauri::async_runtime::spawn_blocking(operation)
        .await
        .map_err(|err| format!("notification bridge worker failed: {err}"))?
}

fn reserve_local_port(bind_host: &str) -> Result<u16, String> {
    let listener = TcpListener::bind(format!("{bind_host}:0"))
        .map_err(|err| format!("bind local port: {err}"))?;
    let port = listener
        .local_addr()
        .map_err(|err| format!("read local port: {err}"))?
        .port();
    drop(listener);
    Ok(port)
}

fn wait_for_server(url_host: &str, port: u16) -> Result<(), String> {
    let addr: SocketAddr = format!("{url_host}:{port}")
        .parse()
        .map_err(|err| format!("parse server address: {err}"))?;
    let deadline = Instant::now() + Duration::from_secs(10);

    while Instant::now() < deadline {
        if TcpStream::connect_timeout(&addr, Duration::from_millis(200)).is_ok() {
            return Ok(());
        }
        std::thread::sleep(Duration::from_millis(150));
    }

    Err(format!(
        "desktop server did not start listening on {url_host}:{port} within 10 seconds"
    ))
}

fn push_server_startup_log(logs: &Arc<Mutex<VecDeque<String>>>, line: String) {
    let line = line.trim_end().to_string();
    if line.is_empty() {
        return;
    }

    let Ok(mut guard) = logs.lock() else {
        return;
    };
    if guard.len() >= SERVER_STARTUP_LOG_LIMIT {
        guard.pop_front();
    }
    guard.push_back(line);
}

fn format_server_startup_error(message: &str, logs: &Arc<Mutex<VecDeque<String>>>) -> String {
    let log_text = logs
        .lock()
        .ok()
        .map(|guard| guard.iter().cloned().collect::<Vec<_>>().join("\n"))
        .filter(|text| !text.trim().is_empty())
        .unwrap_or_else(|| "No server stdout/stderr was captured before the timeout.".to_string());

    format!("{message}\n\nRecent server logs:\n{log_text}")
}

fn resolve_app_root(_app: &AppHandle) -> Result<PathBuf, String> {
    let exe = std::env::current_exe().map_err(|err| format!("resolve current exe path: {err}"))?;
    let dir = exe
        .parent()
        .ok_or_else(|| "current exe has no parent dir".to_string())?
        .to_path_buf();
    Ok(dir)
}

fn select_h5_dist_dir(resource_dir: Option<&Path>, app_root: &Path) -> PathBuf {
    let mut candidates = Vec::new();
    if let Some(resource_dir) = resource_dir {
        candidates.push(resource_dir.join("_up_").join("dist"));
        candidates.push(resource_dir.join("dist"));
    }
    candidates.push(app_root.join("../Resources/_up_/dist"));
    candidates.push(app_root.join("../Resources/dist"));

    candidates
        .iter()
        .find(|candidate| candidate.join("index.html").is_file())
        .cloned()
        .unwrap_or_else(|| {
            resource_dir
                .map(|dir| dir.join("_up_").join("dist"))
                .unwrap_or_else(|| app_root.join("../Resources/_up_/dist"))
        })
}

fn resolve_h5_dist_dir(app: &AppHandle, app_root: &Path) -> PathBuf {
    let resource_dir = app.path().resource_dir().ok();
    select_h5_dist_dir(resource_dir.as_deref(), app_root)
}

fn start_server_sidecar(app: &AppHandle) -> Result<ServerRuntime, String> {
    let bind_host = SERVER_BIND_HOST;
    let control_host = SERVER_CONTROL_HOST;
    let port = reserve_local_port(bind_host)?;
    let url = format!("http://{control_host}:{port}");
    let app_root = resolve_app_root(app)?;
    let app_root_arg = app_root.to_string_lossy().to_string();
    let h5_dist_dir = resolve_h5_dist_dir(app, &app_root)
        .to_string_lossy()
        .to_string();

    let mut sidecar = app
        .shell()
        .sidecar("dreamcoder-sidecar")
        .map_err(|err| format!("resolve sidecar: {err}"))?;
    if let Ok(config_dir) = std::env::var(CONFIG_DIR_ENV) {
        let cache_dir = PathBuf::from(&config_dir).join("Cache");
        if let Err(e) = fs::create_dir_all(&cache_dir) {
            eprintln!("[desktop] failed to create Cache dir: {e}");
        }
        sidecar = sidecar
            .env(CONFIG_DIR_ENV, &config_dir)
            .env("XDG_CACHE_HOME", cache_dir.to_string_lossy().to_string())
            .env("CLAUDE_H5_AUTO_PUBLIC_URL", "1")
            .env("CLAUDE_H5_DIST_DIR", h5_dist_dir);
    } else {
        sidecar = sidecar
            .env("CLAUDE_H5_AUTO_PUBLIC_URL", "1")
            .env("CLAUDE_H5_DIST_DIR", h5_dist_dir);
    }
    if let Some(path) = legacy_terminal_config_path(app) {
        sidecar = sidecar.env("DREAMCODER_LEGACY_TERMINAL_CONFIG_PATH", path);
    }
    let sidecar = sidecar
        .env("DREAMCODER_PARENT_PID", std::process::id().to_string())
        .env("APP_VERSION", app.package_info().version.to_string());
    let sidecar = sidecar.args([
        "server",
        "--app-root",
        &app_root_arg,
        "--host",
        bind_host,
        "--port",
        &port.to_string(),
    ]);

    let startup_logs = Arc::new(Mutex::new(VecDeque::new()));
    let logs_for_task = Arc::clone(&startup_logs);

    let (mut rx, child) = sidecar
        .spawn()
        .map_err(|err| format!("spawn server sidecar: {err}"))?;

    tauri::async_runtime::spawn(async move {
        while let Some(event) = rx.recv().await {
            match event {
                CommandEvent::Stdout(line) => {
                    let line = String::from_utf8_lossy(&line);
                    let line = line.trim_end();
                    println!("[claude-server] {line}");
                    push_server_startup_log(&logs_for_task, format!("[stdout] {line}"));
                }
                CommandEvent::Stderr(line) => {
                    let line = String::from_utf8_lossy(&line);
                    let line = line.trim_end();
                    eprintln!("[claude-server] {line}");
                    push_server_startup_log(&logs_for_task, format!("[stderr] {line}"));
                }
                CommandEvent::Terminated(payload) => {
                    let line = format!(
                        "sidecar exited (code={:?}, signal={:?})",
                        payload.code, payload.signal
                    );
                    eprintln!("[claude-server] {line}");
                    push_server_startup_log(&logs_for_task, format!("[exit] {line}"));
                }
                _ => {}
            }
        }
    });

    if let Err(err) = wait_for_server(control_host, port) {
        let _ = child.kill();
        return Err(format_server_startup_error(&err, &startup_logs));
    }

    Ok(ServerRuntime { url, child })
}

fn stop_server_sidecar(app: &AppHandle) {
    let Some(state) = app.try_state::<ServerState>() else {
        return;
    };

    let Ok(mut guard) = state.0.lock() else {
        return;
    };

    if let Some(runtime) = guard.runtime.take() {
        let _ = runtime.child.kill();
    }
}

#[cfg(target_os = "windows")]
fn kill_windows_sidecars() {
    for image_name in [
        "dreamcoder-sidecar-x86_64-pc-windows-msvc.exe",
        "dreamcoder-sidecar-aarch64-pc-windows-msvc.exe",
        "dreamcoder-sidecar.exe",
    ] {
        let _ = StdCommand::new("taskkill")
            .args(["/F", "/T", "/IM", image_name])
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .status();
    }
}

#[cfg(test)]
mod tests {
    use super::{
        dir_has_portable_data, has_meaningful_intersection, is_persistable_window_state,
        run_notification_bridge, select_h5_dist_dir, validate_export_path, StoredWindowState,
        SERVER_BIND_HOST, SERVER_CONTROL_HOST,
    };
    use std::fs;

    #[test]
    fn export_paths_must_be_absolute_markdown_or_json() {
        let base = std::env::temp_dir();
        assert!(validate_export_path(base.join("a.md").to_str().unwrap()).is_ok());
        assert!(validate_export_path(base.join("a.JSON").to_str().unwrap()).is_ok());
        assert!(validate_export_path(base.join("a.sh").to_str().unwrap()).is_err());
        assert!(validate_export_path(base.join("noext").to_str().unwrap()).is_err());
        assert!(validate_export_path("relative.md").is_err());
    }

    #[test]
    fn window_state_rejects_too_small_sizes() {
        let valid = StoredWindowState {
            x: 100,
            y: 100,
            width: 1200,
            height: 800,
            maximized: false,
        };
        let too_narrow = StoredWindowState {
            width: 959,
            ..valid.clone()
        };
        let too_short = StoredWindowState {
            height: 639,
            ..valid.clone()
        };

        assert!(is_persistable_window_state(&valid));
        assert!(!is_persistable_window_state(&too_narrow));
        assert!(!is_persistable_window_state(&too_short));
    }

    #[test]
    fn window_state_requires_visible_monitor_intersection() {
        let state = StoredWindowState {
            x: 100,
            y: 100,
            width: 1200,
            height: 800,
            maximized: false,
        };

        assert!(has_meaningful_intersection(&state, 0, 0, 1920, 1080));
        assert!(!has_meaningful_intersection(
            &StoredWindowState {
                x: -1200,
                y: 100,
                ..state.clone()
            },
            0,
            0,
            1920,
            1080,
        ));
        assert!(!has_meaningful_intersection(
            &StoredWindowState {
                x: 1900,
                y: 100,
                ..state
            },
            0,
            0,
            1920,
            1080,
        ));
    }

    #[test]
    fn portable_data_detection_includes_cli_state_dirs() {
        let root = std::env::temp_dir().join(format!(
            "dc-portable-data-detect-{}",
            std::process::id()
        ));
        let skills = root.join("skills");
        fs::create_dir_all(&skills).expect("create skills dir");

        assert!(dir_has_portable_data(&root));

        fs::remove_dir_all(root).expect("remove portable data fixture");
    }

    #[test]
    fn server_sidecar_binds_lan_but_reports_loopback_control_url() {
        assert_eq!(SERVER_BIND_HOST, "0.0.0.0");
        assert_eq!(SERVER_CONTROL_HOST, "127.0.0.1");
    }

    #[test]
    fn h5_dist_dir_prefers_tauri_parent_resource_mapping() {
        let root = std::env::temp_dir().join(format!("dc-h5-dist-test-{}", std::process::id()));
        let resource_dir = root.join("Contents").join("Resources");
        let app_root = root.join("Contents").join("MacOS");
        let mapped_dist = resource_dir.join("_up_").join("dist");

        fs::create_dir_all(&mapped_dist).expect("create mapped dist dir");
        fs::create_dir_all(&app_root).expect("create app root dir");
        fs::write(mapped_dist.join("index.html"), "").expect("write h5 shell");

        assert_eq!(
            select_h5_dist_dir(Some(&resource_dir), &app_root),
            mapped_dist
        );

        fs::remove_dir_all(root).expect("remove temp app tree");
    }

    #[test]
    fn notification_bridge_runs_off_the_calling_thread() {
        let caller_thread = std::thread::current().id();
        let ran_on_worker = tauri::async_runtime::block_on(run_notification_bridge(move || {
            Ok(std::thread::current().id() != caller_thread)
        }))
        .expect("notification bridge operation should complete");

        assert!(ran_on_worker);
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let builder = tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            show_main_window(app);
        }))
        .manage(ServerState::default())
        .manage(AppExitState::default())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .invoke_handler(tauri::generate_handler![
            get_server_url,
            prepare_for_update_install,
            prepare_for_app_mode_restart,
            cancel_update_install,
            write_session_export,
            macos_notification_permission_state,
            macos_request_notification_permission,
            macos_send_notification,
            open_windows_notification_settings,
            get_app_mode,
            set_app_mode,
            detect_portable_dir,
            set_app_zoom
        ]);

    #[cfg(target_os = "macos")]
    let builder = builder
        .menu(|app| {
            let about_item =
                MenuItemBuilder::with_id("nav_about", "关于 DreamCoder").build(app)?;
            let settings_item = MenuItemBuilder::with_id("nav_settings", "设置...")
                .accelerator("CmdOrCtrl+,")
                .build(app)?;

            let app_submenu = SubmenuBuilder::new(app, "DreamCoder")
                .item(&about_item)
                .separator()
                .item(&settings_item)
                .separator()
                .services()
                .separator()
                .hide()
                .hide_others()
                .show_all()
                .separator()
                .quit()
                .build()?;

            let edit_submenu = SubmenuBuilder::new(app, "Edit")
                .undo()
                .redo()
                .separator()
                .cut()
                .copy()
                .paste()
                .select_all()
                .build()?;

            let view_submenu = SubmenuBuilder::new(app, "View").fullscreen().build()?;

            let window_submenu = SubmenuBuilder::new(app, "Window")
                .minimize()
                .maximize()
                .close_window()
                .build()?;

            MenuBuilder::new(app)
                .item(&app_submenu)
                .item(&edit_submenu)
                .item(&view_submenu)
                .item(&window_submenu)
                .build()
        })
        .on_menu_event(|app, event| match event.id().as_ref() {
            "nav_about" => {
                let _ = app.emit("native-menu-navigate", "about");
            }
            "nav_settings" => {
                let _ = app.emit("native-menu-navigate", "settings");
            }
            _ => {}
        });

    let app = builder
        .setup(|app| {
            setup_system_tray(app)?;
            macos_notifications::install_click_handler(app.handle().clone());
            restore_main_window_state(&app.handle());

            let state = app.state::<ServerState>();
            let mut guard = state
                .0
                .lock()
                .map_err(|_| IoError::new(ErrorKind::Other, "server state lock poisoned"))?;

            match start_server_sidecar(&app.handle()) {
                Ok(runtime) => {
                    guard.runtime = Some(runtime);
                    guard.startup_error = None;
                }
                Err(err) => {
                    eprintln!("[desktop] failed to start local server: {err}");
                    guard.runtime = None;
                    guard.startup_error = Some(err);
                }
            }
            drop(guard);

            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("error while building tauri application");

    app.run(|app_handle, event| match event {
        RunEvent::WindowEvent {
            label,
            event: WindowEvent::CloseRequested { api, .. },
            ..
        } if should_hide_to_tray(app_handle, &label) => {
            api.prevent_close();
            save_main_window_state(app_handle);
            if let Some(window) = app_handle.get_webview_window(&label) {
                let _ = window.hide();
            }
        }
        RunEvent::WindowEvent {
            label,
            event: WindowEvent::Moved(_) | WindowEvent::Resized(_),
            ..
        } if label == MAIN_WINDOW_LABEL => {
            save_main_window_state(app_handle);
        }
        #[cfg(target_os = "macos")]
        RunEvent::Reopen {
            has_visible_windows: false,
            ..
        } => {
            show_main_window(app_handle);
        }
        RunEvent::ExitRequested { .. } => {
            mark_app_quitting(app_handle);
            save_main_window_state(app_handle);
            stop_server_sidecar(app_handle);
        }
        RunEvent::Exit => {
            mark_app_quitting(app_handle);
            save_main_window_state(app_handle);
            stop_server_sidecar(app_handle);
        }
        _ => {}
    });
}

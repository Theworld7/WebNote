//! WebNote 桌面壳。
//!
//! 这一层只做一件事：把「用户选定的笔记目录」变成 fs 插件认可的授权范围。
//!
//! **为什么不在 capability 里写死 `$HOME/**` 之类的宽 scope。** 那样等于给 WebView 开了
//! 整盘读写，与「只碰用户明确选择的那个目录」的安全模型不符。这里的做法是：静态 scope
//! 一条不写，全部走运行时 `allow_directory`，授权范围严格等于用户这一次的选择。
//! 选择结果落在 app config 目录的 `workspace.json`，重启由 `restore_workspace_root`
//! 重新授权，用户不必每次重选。
//!
//! 注意授权是**进程级**的、且只增不减：换目录会在旧目录的授权上再叠一个新目录。
//! 对本应用（单窗口、用户自己的笔记库）这没问题，也就不做收回。

use std::fs;
use std::path::{Path, PathBuf};
use std::sync::Mutex;

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, Manager};
use tauri_plugin_fs::FsExt;

/// 工作区记录文件名，位于 app config 目录（macOS 上是
/// `~/Library/Application Support/com.webnote.app/`）。
const CONFIG_FILE: &str = "workspace.json";

/// Windows 长路径前缀。`\\?\UNC\host\share` 要还原成 `\\host\share`，所以两条分开判。
const VERBATIM_PREFIX: &str = r"\\?\";
const VERBATIM_UNC_PREFIX: &str = r"\\?\UNC\";

#[derive(Serialize, Deserialize)]
struct WorkspaceConfig {
    root: PathBuf,
}

fn config_path(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .app_config_dir()
        .map_err(|error| format!("取不到应用配置目录：{error}"))?;
    fs::create_dir_all(&dir).map_err(|error| format!("创建配置目录失败：{error}"))?;
    Ok(dir.join(CONFIG_FILE))
}

fn load_config(app: &AppHandle) -> Option<WorkspaceConfig> {
    let raw = fs::read_to_string(config_path(app).ok()?).ok()?;
    serde_json::from_str(&raw).ok()
}

/// 把目录纳入 fs 插件的运行时 scope，`recursive: true` 覆盖全部后代。
fn grant(app: &AppHandle, root: &Path) -> Result<(), String> {
    app.fs_scope()
        .allow_directory(root, true)
        .map_err(|error| format!("授权目录失败：{error}"))
}

/// 规范化根目录：解析软链、去掉结尾斜杠。
///
/// **这一步不能省。** fs 插件在 scope 匹配前会把**被查询的路径**规范化
/// （tauri 的 `scope::fs::try_resolve_symlink_and_canonicalize` → `std::fs::canonicalize`），
/// 而 `allow_directory` 是拿我们给的字符串**原样**建 glob 的。两边坐标系不一致时，
/// 只要路径里含任何软链成分，授权就会静默失效 —— macOS 上 `/tmp`、`/var` 本身就是软链，
/// 所以这事儿一点都不罕见。表现是「目录选上了、树是空的」，且不报任何错。
///
/// 规范化之后 pattern 与查询路径同源，匹配才成立。
fn canonical_root(raw: &str) -> Result<PathBuf, String> {
    let path = fs::canonicalize(raw).map_err(|error| format!("路径不可用：{error}"))?;
    if !path.is_dir() {
        return Err(format!("不是目录：{}", path.display()));
    }
    Ok(path)
}

/// 给前端用的路径文本。
///
/// Windows 的 `canonicalize` 会带上 `\\?\` 长路径前缀，直接回给前端会显示成一串乱码。
/// 去掉它不影响授权：查询路径会被规范化回带前缀的形式，而 glob 是在那个形式上比的。
fn display_path(path: &Path) -> String {
    let text = path.to_string_lossy();
    if let Some(rest) = text.strip_prefix(VERBATIM_UNC_PREFIX) {
        return format!(r"\\{rest}");
    }
    if let Some(rest) = text.strip_prefix(VERBATIM_PREFIX) {
        return rest.to_string();
    }
    text.into_owned()
}

/// 校验 → 规范化 → 授权 → 落盘，四步绑成一个入口，避免调用方漏掉授权那步
/// （漏了的表现同样是「目录能选中、树是空的」）。
///
/// 返回落地的路径字符串，前端直接当根目录标签用，并从这个根往下拼子路径。
fn adopt(app: &AppHandle, raw: &str) -> Result<String, String> {
    let root = canonical_root(raw)?;
    grant(app, &root)?;

    let config = WorkspaceConfig { root: root.clone() };
    let raw_config =
        serde_json::to_string_pretty(&config).map_err(|error| format!("序列化配置失败：{error}"))?;
    fs::write(config_path(app)?, raw_config).map_err(|error| format!("写入配置失败：{error}"))?;

    Ok(display_path(&root))
}

/// 启动时调用：有记录且目录仍存在 → 重新授权并返回路径；否则返回 `None`，
/// 前端据此显示「打开文件夹」引导。
///
/// 目录被删或被移走是正常情况（用户自己动过盘），所以失败不报错，只当没配过。
#[tauri::command]
fn restore_workspace_root(app: AppHandle) -> Option<String> {
    let config = load_config(&app)?;
    adopt(&app, &config.root.to_string_lossy()).ok()
}

/// 用户在原生目录选择器里选定后调用。`path` 由选择器给出，必然存在，
/// 但仍过一遍 `adopt` 的校验 —— 选择器与实际目录状态之间存在竞态。
#[tauri::command]
fn set_workspace_root(app: AppHandle, path: String) -> Result<String, String> {
    adopt(&app, &path)
}

/// 关窗守卫。
///
/// 窗口没有系统装饰，右上角那颗关闭键走的是 `window.close()`，而 WebView 里的
/// `beforeunload` 并不能可靠阻断它 —— 脏文档会随着进程退出静默消失。
/// 所以拦在原生这一层：前端报告「有没有未保存的东西」，这里在 `CloseRequested`
/// 上把窗口留下并通知前端去问。
///
/// 判断放在前端是因为「哪篇脏了」只有工作区知道；这一层不理解笔记，只认一个开关。
#[derive(Default)]
struct CloseGuard {
    dirty: bool,
    /// 一次性放行票。用户在前端确认过「保存 / 不保存」之后置位，下一次
    /// `CloseRequested` 直接过 —— 否则确认完又会被自己拦一次。
    allow: bool,
}

/// 前端在有未保存改动时把它置脏（`hasDirty` 变化时调用）。
#[tauri::command]
fn set_close_guard(state: tauri::State<Mutex<CloseGuard>>, dirty: bool) {
    if let Ok(mut guard) = state.lock() {
        guard.dirty = dirty;
    }
}

/// 前端确认过之后调用：放行并关窗。
///
/// 不在这里直接摘掉守卫：`window.close()` 仍会再走一遍 `CloseRequested`，
/// 靠那张一次性放行票过闸，两条路径（用户点关闭 / 用户确认后关闭）才只有一套判定。
#[tauri::command]
fn confirm_close(
    window: tauri::Window,
    state: tauri::State<Mutex<CloseGuard>>,
) -> Result<(), String> {
    if let Ok(mut guard) = state.lock() {
        guard.allow = true;
    }
    window
        .close()
        .map_err(|error| format!("关闭窗口失败：{error}"))
}

/// 本机已安装字体的 family 名（去重、按字母序）。
///
/// 字体偏好落盘只存 family 名，这一层只回答「本机有哪些」—— 选择框与渲染都在前端。
/// 每次调用全量扫一遍系统字体（Windows 走注册表 + 字体目录）：装字体不是高频动作，
/// 缓存反而要额外处理「刚装了字体列表却是旧的」。
///
/// 只取每个字面的第一个 family 名（fontdb 保证第一个是英文 US 名，缺失时才取别的）：
/// 同一个字体往往还有本地化名，一并收进列表会出现「微软雅黑 / Microsoft YaHei」两条。
#[tauri::command]
fn list_system_fonts() -> Vec<String> {
    let mut database = fontdb::Database::new();
    database.load_system_fonts();

    let mut names: Vec<String> = database
        .faces()
        .filter_map(|face| face.families.first().map(|(name, _)| name.clone()))
        .collect();

    names.sort_by_key(|name| name.to_lowercase());
    names.dedup_by(|left, right| left.eq_ignore_ascii_case(right));
    names
}

/// 让**原生标题栏**跟着应用外观走。
///
/// 界面本身是 `<html class="dark">` 的事（CSS token 全在那一侧），但窗口的边框与
/// 标题栏是 DWM 画的，WebView 里碰不到它 —— 得从这一层说一声。
///
/// **为什么不只用 `window.set_theme`。** 那是跨平台的正路，走的是 tao 的
/// `preferred_theme` 状态机。实测（Windows 11 25H2 / tauri 2.12.3 / tao 0.37.1）：
/// 命令返回 `Ok`、`theme()` 读出来也对，但 `DwmGetWindowAttribute(hwnd, 20)` 始终是 0，
/// 标题栏一直浅色 —— 界面深了、只有窗口边框没深。所以这里再直接写一次
/// `DWMWA_USE_IMMERSIVE_DARK_MODE`，并像 tao 那样手动触发一次非客户区重绘。
///
/// **Windows 上不走 `set_theme`，只涂 DWM。** `set_theme(Some(..))` 会把 tao 的
/// `preferred_theme` 钉成 `Some`，而 tao 处理 `WM_SETTINGCHANGE` 时只要看到它非空就
/// 直接早退：既不再发 `ThemeChanged`，tauri-runtime-wry 也就不会把系统的翻转同步给
/// WebView2 的 `PreferredColorScheme` —— 于是 `prefers-color-scheme` 永远停在启动那一刻，
/// 「跟随系统」彻底失效。直接写 `DWMWA_USE_IMMERSIVE_DARK_MODE` 不碰那份状态，
/// 系统翻转仍由 tao 与 runtime 自己传导，标题栏的最终配色则由前端在翻转后再涂一次。
#[tauri::command]
fn set_window_theme(window: tauri::Window, dark: bool) -> Result<(), String> {
    #[cfg(windows)]
    {
        let hwnd = window.hwnd().map_err(|error| error.to_string())?.0 as isize;
        window_frame::paint(hwnd, dark)
    }

    #[cfg(not(windows))]
    {
        // macOS 上外观是应用级的，框架入口改的正是它；Linux 没有这条设置，返回错误可忽略。
        let theme = if dark {
            tauri::Theme::Dark
        } else {
            tauri::Theme::Light
        };
        window
            .set_theme(Some(theme))
            .map_err(|error| format!("设置窗口主题失败：{error}"))
    }
}

/// Windows 上「把窗口边框涂成深色」这件事。
///
/// 不用 `windows` crate：只要三个 P/Invoke，为它加一整个依赖不划算。
#[cfg(windows)]
mod window_frame {
    /// `DWMWA_USE_IMMERSIVE_DARK_MODE`。Win10 17763~18985 上是 19，往后是 20，
    /// 而本应用的下限远高过那条线，只认 20。
    const USE_IMMERSIVE_DARK_MODE: u32 = 20;
    /// `WM_NCACTIVATE`：非客户区的「激活状态变了」，DWM 收到它才会重画边框配色。
    const WM_NCACTIVATE: u32 = 0x0086;

    #[link(name = "dwmapi")]
    extern "system" {
        fn DwmSetWindowAttribute(
            hwnd: isize,
            attribute: u32,
            value: *const i32,
            size: u32,
        ) -> i32;
    }

    #[link(name = "user32")]
    extern "system" {
        fn DefWindowProcW(hwnd: isize, message: u32, wparam: usize, lparam: isize) -> isize;
    }

    /// `hwnd` 由调用方从 `tauri::Window::hwnd()` 取好并转成 `isize` —— 那个类型来自
    /// `windows` crate，为了传个参把依赖引进来不值当。
    pub fn paint(hwnd: isize, dark: bool) -> Result<(), String> {
        let handle = hwnd;
        let value: i32 = i32::from(dark);

        // 返回值是 HRESULT：负数才算失败。
        let result = unsafe {
            DwmSetWindowAttribute(
                handle,
                USE_IMMERSIVE_DARK_MODE,
                &value,
                std::mem::size_of::<i32>() as u32,
            )
        };
        if result < 0 {
            return Err(format!("DwmSetWindowAttribute 失败：{result:#x}"));
        }

        // 和 tao 里那段一样：DWM 只缓存了新的配色，要主动请它重画非客户区。
        // 两次 WM_NCACTIVATE 的 wparam 顺序按窗口是否在前台分，这里一律「先否后是」，
        // 后台窗口同样能刷到。
        unsafe {
            DefWindowProcW(handle, WM_NCACTIVATE, 0, 0);
            DefWindowProcW(handle, WM_NCACTIVATE, 1, 0);
        }

        Ok(())
    }
}

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_dialog::init())
        .manage(Mutex::new(CloseGuard::default()))
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                let state = match window.try_state::<Mutex<CloseGuard>>() {
                    Some(state) => state,
                    None => return,
                };
                let mut guard = match state.lock() {
                    Ok(guard) => guard,
                    Err(_) => return,
                };
                if guard.allow {
                    guard.allow = false;
                    return;
                }
                if !guard.dirty {
                    return;
                }
                // 有未保存的改动：留下窗口，交给前端问「保存 / 不保存」。
                // 前端没在听（或已经崩了）时窗口就停在原处 —— 关不掉远好过悄悄丢数据。
                api.prevent_close();
                drop(guard);
                let _ = window.emit("webnote-close-blocked", ());
            }
        })
        .invoke_handler(tauri::generate_handler![
            restore_workspace_root,
            set_workspace_root,
            list_system_fonts,
            set_window_theme,
            set_close_guard,
            confirm_close
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

//! WebNote 桌面壳。
//!
//! 这一层只做一件事：把「用户选定的笔记目录」变成 fs 插件与 asset 协议都认可的授权范围。
//!
//! **为什么不在 capability 里写死 `$HOME/**` 之类的宽 scope。** 那样等于给 WebView 开了
//! 整盘读写，与「只碰用户明确选择的那个目录」的安全模型不符。这里的做法是：静态 scope
//! 一条不写，全部走运行时 `allow_directory`，授权范围严格等于用户这一次的选择。
//! asset 协议也一样（它的静态 `scope` 是空数组）—— 视频块要的正是「这一篇笔记旁边的
//! 那几个文件能被 `<video>` 取到」，而不是整盘可播。见 `grant`。
//! 选择结果落在 app config 目录的 `workspace.json`，重启由 `restore_workspace_root`
//! 重新授权，用户不必每次重选。
//!
//! 注意授权是**进程级**的、且只增不减：换目录会在旧目录的授权上再叠一个新目录。
//! 对本应用（单窗口、用户自己的笔记库）这没问题，也就不做收回。

mod webdav;

use std::fs;
use std::path::{Path, PathBuf};
use std::sync::Mutex;

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, Manager};
use tauri_plugin_fs::FsExt;

/// 工作区记录文件名，位于 app config 目录（macOS 上是
/// `~/Library/Application Support/com.webnote.app/`）。
const CONFIG_FILE: &str = "workspace.json";

/// WebDAV 连接记录。与工作区记录分开放：一个是「本地目录授权」，一个是「远端账号」，
/// 生命周期也不同 —— 换回本地目录时不该把账号一起删掉（下次还想连）。
const WEBDAV_FILE: &str = "webdav.json";

/// Windows 长路径前缀。`\\?\UNC\host\share` 要还原成 `\\host\share`，所以两条分开判。
const VERBATIM_PREFIX: &str = r"\\?\";
const VERBATIM_UNC_PREFIX: &str = r"\\?\UNC\";

#[derive(Serialize, Deserialize)]
struct WorkspaceConfig {
    root: PathBuf,
}

/// WebDAV 工作区。`path` 是服务器上放笔记的目录（相对 `url`，空串表示就是它本身）；
/// `active` 记录「上次打开的就是它」—— 启动时据此决定重连远端还是回到本地目录。
///
/// 密码是明文。这与「笔记本身也是明文 HTML」是同一个取舍：本地笔记库不该被锁进
/// 某个加密容器，但界面会建议用应用专用密码而不是账号主密码（`webdav.json` 的
/// 可读性同时也意味着可备份、可手改）。
#[derive(Serialize, Deserialize, Clone)]
struct WebDavConfig {
    url: String,
    username: String,
    password: String,
    path: String,
    active: bool,
}

fn config_path_of(app: &AppHandle, name: &str) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .app_config_dir()
        .map_err(|error| format!("取不到应用配置目录：{error}"))?;
    fs::create_dir_all(&dir).map_err(|error| format!("创建配置目录失败：{error}"))?;
    Ok(dir.join(name))
}

fn config_path(app: &AppHandle) -> Result<PathBuf, String> {
    config_path_of(app, CONFIG_FILE)
}

fn load_config(app: &AppHandle) -> Option<WorkspaceConfig> {
    let raw = fs::read_to_string(config_path(app).ok()?).ok()?;
    serde_json::from_str(&raw).ok()
}

/// 把目录纳入 fs 插件与 asset 协议的运行时 scope，`recursive: true` 覆盖全部后代。
///
/// **两个 scope 是各自独立的名单，必须一起授。** fs scope 管 `readDir` / `readFile` 这类
/// JS 调用；asset 协议拿自己的名单判「这个路径能不能交给页面取流」。只授前者时，
/// 普通笔记读写一切正常，唯独视频区一片黑 —— 协议处理器回 403，控制台一句
/// `not configured to allow the path`，看起来完全不像权限问题。
///
/// 这里同样**不写静态 scope**（`tauri.conf.json` 里 `assetProtocol.scope` 是空数组）：
/// 授权范围仍严格等于用户这一次选的目录，换目录只是在这份名单上再叠一条。
fn grant(app: &AppHandle, root: &Path) -> Result<(), String> {
    app.fs_scope()
        .allow_directory(root, true)
        .map_err(|error| format!("授权目录失败：{error}"))?;
    app.asset_protocol_scope()
        .allow_directory(root, true)
        .map_err(|error| format!("授权媒体目录失败：{error}"))
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

/// 上次连的 WebDAV。读不出来（首次运行、文件被手改坏）一律当没配过 ——
/// 这里没有「配置损坏」这种需要用户处理的状态，重新填一遍就好。
#[tauri::command]
fn load_webdav_config(app: AppHandle) -> Option<WebDavConfig> {
    let raw = fs::read_to_string(config_path_of(&app, WEBDAV_FILE).ok()?).ok()?;
    serde_json::from_str(&raw).ok()
}

/// 写入或清除 WebDAV 记录。传 `null` 表示忘掉这个账号。
///
/// 不在这里校验连通性：那需要联网，而「记住配置」与「现在能不能连上」是两件事 ——
/// 服务器临时挂掉时用户仍应该能保留账号，下次再试。
#[tauri::command]
fn save_webdav_config(app: AppHandle, config: Option<WebDavConfig>) -> Result<(), String> {
    let path = config_path_of(&app, WEBDAV_FILE)?;
    match config {
        Some(config) => {
            let raw = serde_json::to_string_pretty(&config)
                .map_err(|error| format!("序列化配置失败：{error}"))?;
            fs::write(path, raw).map_err(|error| format!("写入配置失败：{error}"))
        }
        None => match fs::remove_file(path) {
            Ok(()) => Ok(()),
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()),
            Err(error) => Err(format!("删除配置失败：{error}")),
        },
    }
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

/// macOS 上的窗口形状：把那圈圆角交给系统画。
///
/// **为什么 Windows 不用管这件事。** Windows 11 的圆角是 DWM 画的 —— 只要是普通顶层窗口，
/// 系统就替它把角磨圆，跟有没有自绘标题栏无关。macOS 没有这一层：圆角是**标题栏**的一部分，
/// 只有带标题栏的窗口才画得到；`decorations: false` 造出来的是无边框窗口，四个角是直的。
/// 于是这里把窗口改回「有标题栏」的样子，只是那条标题栏的**底**藏进我们自己的 chrome 底下 ——
/// 红绿灯留着，那是系统的窗口按钮（ADR-0058）。
///
/// **为什么不用「透明窗口 + CSS 圆角」那条路。** 那条路要开 `macOSPrivateApi`，
/// 换来的是自己画的一圈角与一层自己画的阴影 —— 而系统本来就能画得更好，还带正确的阴影。
#[cfg(target_os = "macos")]
mod macos_frame {
    use objc2_app_kit::{
        NSResponder, NSView, NSWindow, NSWindowStyleMask, NSWindowTitleVisibility,
    };

    /// 让窗口有系统那圈圆角与阴影。
    ///
    /// 窗口的「样式掩码」是它有哪些零件的清单。这里补上「有标题栏」与「可关闭」，
    /// 再让内容顶到标题栏底下（`FullSizeContentView`）：正文于是铺满整扇窗，
    /// 不留一条 28px 的空标题栏，我们自己画的那条 chrome 仍然贴在最上面。
    pub fn apply(window: &tauri::Window) -> Result<(), String> {
        let raw = window.ns_window().map_err(|error| error.to_string())?;
        // SAFETY: `ns_window` 交回来的是这个窗口自己的 NSWindow（Tauri 内部 retain 过，
        // 生命周期与窗口一致），这里只用它做几处 AppKit 调用。
        let ns_window: &NSWindow = unsafe { &*(raw as *const NSWindow) };

        // 换掩码之前先记住外框：AppKit 重算标题栏时会把窗口撑高、挪位置。
        let frame = ns_window.frame();
        let mask = ns_window.styleMask();
        let titled = mask
            | NSWindowStyleMask::Titled
            | NSWindowStyleMask::FullSizeContentView
            | NSWindowStyleMask::Closable;
        if titled != mask {
            ns_window.setStyleMask(titled);
            // 外框放回原处。两种掩码下「外框 = 内容区」（有标题栏且内容顶满时正是如此），
            // 所以还原外框就是还原内容区，窗口不会因为多出一条标题栏而挪位。
            ns_window.setFrame_display(frame, true);
        }

        // 标题栏透明、标题不画：标题栏那层底色与标题文字不要了 —— 这一条 chrome
        // 是我们自己画的（ADR-0024），系统那套画上去会跟我们的内容叠在一处。
        // 红绿灯留着：它们是系统的窗口按钮（ADR-0058）。
        //
        // 顺带把系统自己的「双击标题栏缩放」让掉 —— 标题栏透明之后系统不再替我们缩放，
        // 拖拽区那一份（Tauri 内建的双击缩放）就成了唯一的一份，
        // 不会一按两下、缩放完又缩回来。
        ns_window.setTitlebarAppearsTransparent(true);
        ns_window.setTitleVisibility(NSWindowTitleVisibility::Hidden);

        // 换过掩码之后第一响应者可能掉回窗口自己，键盘就送不到正文里了 ——
        // 跟 tao 换装饰时做的是同一件事：把内容视图重新按成第一响应者。
        if let Some(view) = ns_window.contentView() {
            let view: &NSView = &view;
            let responder: &NSResponder = view;
            ns_window.makeFirstResponder(Some(responder));
        }

        Ok(())
    }
}

/// 把每扇窗摆成系统那圈圆角。
///
/// **只有 macOS 需要这一步。** Windows 11 的圆角是 DWM 画的，普通顶层窗口系统就替它磨圆；
/// macOS 的圆角是标题栏的一部分，窗口得有标题栏才画得到（ADR-0058）。
#[cfg(target_os = "macos")]
fn shape_windows(app: &tauri::App) {
    for webview_window in app.webview_windows().values() {
        let window = webview_window.as_ref().window();
        // 摆不上也只是直角而已，不该拦住应用启动 —— 记一行日志就够了。
        if let Err(error) = macos_frame::apply(&window) {
            eprintln!("[webnote] macOS 窗口圆角没摆上：{error}");
        }
    }
}

/// 别的平台不需要这一步：那圈圆角本来就是系统给的。
#[cfg(not(target_os = "macos"))]
fn shape_windows(_app: &tauri::App) {}

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_dialog::init())
        .manage(Mutex::new(CloseGuard::default()))
        .setup(|app| {
            // macOS 的圆角要在窗口建好之后、显示之前摆上：系统只在窗口有标题栏时才画那圈角。
            // （`setup` 早于事件循环开始，所以用户看不到「先是直角、再变圆角」的过程。）
            shape_windows(app);
            Ok(())
        })
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
            load_webdav_config,
            save_webdav_config,
            webdav::webdav_request,
            list_system_fonts,
            set_window_theme,
            set_close_guard,
            confirm_close
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

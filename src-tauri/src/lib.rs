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

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager};
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

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![
            restore_workspace_root,
            set_workspace_root
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

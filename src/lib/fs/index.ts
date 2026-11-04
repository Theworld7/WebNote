import type { WorkspaceFs } from "./types"
import { canPickDirectory, createBrowserFs } from "./browser"
import { isTauriRuntime } from "./runtime"

/**
 * 浏览器端是不是只能落到内置存储（OPFS）。
 *
 * 判据与 `createBrowserFs` 内部挑路的那一个完全一致（有没有目录选择器），不按 UA 认
 * 浏览器：Chrome 装在 file:// 下同样没有这个 API，那时它和 Firefox 是一回事。桌面端
 * 不算 —— 它读写的是真实路径，跟这条通道无关。
 */
export function usesBuiltinStorage(): boolean {
  return !isTauriRuntime() && !canPickDirectory()
}

/**
 * 按运行环境挑一份 `WorkspaceFs` 实现。
 *
 * 用特性探测（`__TAURI_INTERNALS__`）而不是构建期常量：同一份 dist 产物既跑在
 * Tauri 的 WebView 里，也用浏览器直接打开调试，不必维护两套构建。
 *
 * 注意这里**只挑本地目录那份**。WebDAV 是用户在工作区入口里显式选的另一种来源，
 * 由 `createWebDavFs` 单独构造（见 `./webdav`）—— 它不该因为「上次连过」就在
 * 启动时悄悄顶掉本地目录。
 *
 * 工厂是异步的，为的是把桌面端实现整块**动态**引入：静态 import 会让
 * `@tauri-apps/plugin-fs` / `plugin-dialog` 一起进浏览器包，那些模块会去读
 * `window.__TAURI_INTERNALS__`，在非 Tauri 环境里是纯粹的负担；顺带还把它们从
 * 首屏 chunk 里切了出去。
 */
export async function createWorkspaceFs(): Promise<WorkspaceFs> {
  if (!isTauriRuntime()) return createBrowserFs()
  const { createTauriFs } = await import("./tauri")
  return createTauriFs()
}

export type { FsKind, FsRoot, RestoreOffer, WorkspaceFs } from "./types"
export { isTauriRuntime } from "./runtime"

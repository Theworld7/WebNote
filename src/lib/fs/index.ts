import type { WorkspaceFs } from "./types"
import { createBrowserFs } from "./browser"

/**
 * 按运行环境挑一份 `WorkspaceFs` 实现。
 *
 * 用特性探测（`__TAURI_INTERNALS__`）而不是构建期常量：同一份 dist 产物既跑在
 * Tauri 的 WebView 里，也用浏览器直接打开调试，不必维护两套构建。
 */
export function isTauriRuntime(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window
}

/**
 * 工厂是异步的，为的是把桌面端实现整块**动态**引入。
 *
 * 静态 import 会让 `@tauri-apps/plugin-fs` / `plugin-dialog` 一起进浏览器包，
 * 那些模块会去读 `window.__TAURI_INTERNALS__`，在非 Tauri 环境里是纯粹的负担；
 * 顺带还把它们从首屏 chunk 里切了出去。
 */
export async function createWorkspaceFs(): Promise<WorkspaceFs> {
  if (!isTauriRuntime()) return createBrowserFs()
  const { createTauriFs } = await import("./tauri")
  return createTauriFs()
}

export type { FsKind, FsRoot, WorkspaceFs } from "./types"

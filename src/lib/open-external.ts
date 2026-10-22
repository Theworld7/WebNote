import { isTauriRuntime } from "@/lib/fs"

/**
 * 用系统默认浏览器打开一个外部地址。
 *
 * 桌面端走 opener 插件（`opener:default` 已放开 `http(s)` / `mailto` / `tel`），
 * 浏览器端退回 `window.open` —— 两者都不是「应用内新建 webview」：链接指向的是别人的
 * 站点，把它塞进笔记应用里既没有地址栏也没有后退，只会让人以为卡住了。
 *
 * 插件动态引入，理由与 `createWorkspaceFs` 相同：浏览器里跑调试时不该把 Tauri 的包
 * 一起拉进首屏。
 */
export async function openExternalUrl(url: string): Promise<void> {
  if (isTauriRuntime()) {
    const { openUrl } = await import("@tauri-apps/plugin-opener")
    await openUrl(url)
    return
  }
  window.open(url, "_blank", "noopener,noreferrer")
}

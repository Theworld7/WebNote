/**
 * 运行时判据。
 *
 * 单独成文件是为了避开循环依赖：`fs/index` 要按环境挑驱动，而 WebDAV 驱动自己也得
 * 知道「现在走的哪条传输通道」。两边都从 `fs/index` 拿的话就绕成了一个环。
 */
export function isTauriRuntime(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window
}

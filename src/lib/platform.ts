/**
 * 平台判据。
 *
 * 窗口 chrome 在两个平台上不是一回事：macOS 用系统那三颗红绿灯（画在左上角），
 * Windows 用我们自己画的三颗（贴在右上角）。标题栏要先知道自己在哪，才排得出版。
 *
 * **为什么嗅 user agent，而不是问原生那层。** 原生那层当然知道（`cfg!(target_os)`），
 * 但问它要一次 IPC 往返 —— 标题栏的第一帧就得按平台排版，等往返回来再改一次版，
 * 用户会看见一次跳版。WebView 的 user agent 里带着系统名（macOS 上是 `Macintosh`），
 * 同步就能拿到。
 */
export function isMacOS(): boolean {
  return typeof navigator !== "undefined" && navigator.userAgent.includes("Macintosh")
}

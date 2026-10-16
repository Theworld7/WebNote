/**
 * HTML 块的沙箱 srcdoc 文档。
 *
 * 收在 lib 层：探针的量法要在自检页里对真 iframe 验证（见 `design/html-check.html`），
 * 留在组件里就没法测了。
 *
 * **高度量法必须是 body 而不是 documentElement**：`documentElement.scrollHeight`
 * 恒 ≥ iframe 视口高度 —— 编辑器按上报值撑高 iframe 后，视口跟着变大，下次上报
 * 只会持平或更大、永远缩不回去（正反馈）。body 高度只由内容决定，与视口无关，
 * 循环不成立。`display:flow-root` 让 body 成为 BFC 根，末子元素的底边距不再
 * 穿透 body、被计入测量。
 *
 * 探针脚本向父页面报内容高度：load 时一次、ResizeObserver 兜内容动态增减。
 * `</script>` 写成 `<\/script>`：字面闭合标签会把 SFC 的 script 块提前截断。
 */
export function buildHtmlFrameDoc(source: string): string {
  const probe =
    "<script>(function(){var send=function(){parent.postMessage({height:Math.ceil(document.body.scrollHeight)},'*')};window.addEventListener('load',send);send();new ResizeObserver(send).observe(document.body)})()<\/script>"
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><style>body{margin:0;display:flow-root;background:transparent;font:14px/1.6 -apple-system,"PingFang SC","Helvetica Neue",sans-serif}</style></head><body>${source}${probe}</body></html>`
}

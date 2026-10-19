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
 *
 * **iframe 不是「另一页」，它是这篇笔记正文的一个洞**：导出时 HTML 块的原文直接落在
 * 笔记 `<body>` 里，页面级 CSS（`<style data-note-style>`）自然作用其上 —— `.bg-demo-block`
 * 这种类写在页面样式里，就能用在这块 HTML 上。沙箱文档是独立文档，不把那份 CSS 一起
 * 送进去，预览就和导出对不上（导出有底色、编辑器里没有）。所以第二参数把页面样式原样
 * 注入到 `<head>`，位置在基础 reset **之后** —— 与导出侧的层叠顺序一致：同权重取后者。
 *
 * 注入的是**未限定**的原文，不是编辑器里那份 `scopeCss` 改写结果：iframe 内部没有
 * `[data-doc]` 正文列，`:root` / `body` 指的就是这一小块文档本身，和导出时的语义对得上。
 * 代价是 `body { background: … }` 会在这一块里再画一遍（导出时它铺满整页）—— 纯色看不出，
 * 渐变 / 背景图会对不齐。这条预览本来就是近似的（见 ADR-0011 / 0013）。
 *
 * 但**盒模型例外**：整页的版心（`padding` / `max-width` / `margin: 0 auto`）在编辑器里由
 * 正文列负责，iframe 再套一遍就是双重内缩 —— 页面样式里一句 `body { padding: 3rem }`
 * 会让每个 HTML 块凭空缩一圈。所以注入之后紧跟一条只重置盒模型的规则，见 `FRAME_BOX_RESET`。
 */
/**
 * iframe 的 body 是**页面上的一个洞**，不是页面本身。
 *
 * 页面样式里的 `body { padding: 3rem 1.5rem }` / `max-width: 46rem` 描述的是整页版心，
 * 编辑器里这层版心由正文列（`[data-doc]`）负责；iframe 里再套一遍就是双重内缩 ——
 * 块内容凭空多出一圈 padding（曾经真的这样：旧笔记的基础排版被误当成页面样式，
 * 于是每个 HTML 块都被 `body { padding: 3rem }` 缩了一圈）。
 *
 * 注入之后追加一条只针对**盒模型**的重置。`!important` 是必要的：用户规则可能带更高
 * 特异度（`body.dark`、`html body.theme-x`），这层修正必须压得住。字体 / 颜色 / 背景
 * 不在此列 —— 它们在块里同样成立，与导出侧一致（见 ADR-0013）。
 *
 * `min-height: 0` 是防御性的：页面样式里一句 `body { min-height: 100vh }` 会让 body 的
 * 高度跟着 iframe 视口走，而 iframe 又按上报的 body 高度长大 —— 高度探针的正反馈就成立了。
 */
const FRAME_BOX_RESET =
  "<style>html,body{margin:0!important;padding:0!important;max-width:none!important;width:auto!important;min-height:0!important}</style>"

/**
 * 空样式不落任何标签：没有页面样式的笔记，生成的文档与加这个功能之前逐字节相同。
 */
export function buildHtmlFrameDoc(source: string, pageStyle = ""): string {
  const probe =
    "<script>(function(){var send=function(){parent.postMessage({height:Math.ceil(document.body.scrollHeight)},'*')};window.addEventListener('load',send);send();new ResizeObserver(send).observe(document.body)})()<\/script>"
  const base = `<style>body{margin:0;display:flow-root;background:transparent;font:14px/1.6 -apple-system,"PingFang SC","Helvetica Neue",sans-serif}</style>`
  const style =
    pageStyle.trim() === "" ? "" : `<style data-note-style>${pageStyle}</style>${FRAME_BOX_RESET}`
  return `<!DOCTYPE html><html><head><meta charset="utf-8">${base}${style}</head><body>${source}${probe}</body></html>`
}

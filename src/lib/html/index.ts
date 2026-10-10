/**
 * 静态 HTML 与块模型之间的两个方向。
 *
 * 往返契约（`design/parse-check.html` 会逐份样本自检）：
 * `parseHtml(blocksToHtml(blocks))` 与 `blocks` 等价（不计 id）；
 * 对任意脏 HTML，先 `parseHtml` 规范化一次，之后每一轮往返都稳定。
 *
 * **一处例外**：含数据表引用块的笔记不精确往返 —— 写出时它是当前表格内容的快照，
 * 读回来是普通表格块。见 ADR-0005 与 `CONTEXT.md` 的「Snapshot exception」。
 */
export { parseHtml } from "./parse"
export { blocksToHtml, serializeHtml } from "./serialize"
export type { DocumentMeta, DataTableLookup } from "./serialize"
export { runsFromNode, runsFromNodes } from "./runs-dom"
export type { RunsFromNodeOptions } from "./runs-dom"

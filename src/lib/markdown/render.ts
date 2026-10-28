/**
 * Markdown → 预览 HTML。
 *
 * 与导入共用 `marked`，但产物是直接挂进应用 DOM 的（不像 HTML 块那样装在沙箱 iframe 里），
 * 所以先摘掉脚本与事件属性：笔记库里的 Markdown 可能来自下载，不能让它有主意。
 * 再按块类型打上 `data-block-type`，预览就能复用导出文档那份 `docStyle()`（见
 * `lib/typography.ts` 的 `scopeCss` 用法），不必为 Markdown 另写一套视觉常量。
 */
import { marked } from "marked"
import { ALERT_MARKER } from "./import"

/** 与 `docStyle()` 里按标签写的规则对齐：标签 → 编辑器里的块类型。 */
const BLOCK_TYPES: Readonly<Record<string, string>> = {
  p: "text",
  h1: "h1",
  h2: "h2",
  h3: "h3",
  h4: "h4",
  h5: "h5",
  h6: "h6",
  blockquote: "quote",
  ul: "ul",
  ol: "ol",
  pre: "code",
  hr: "divider",
  aside: "callout",
}

const BLOCK_TAGS = "p,h1,h2,h3,h4,h5,h6,blockquote,ul,ol,pre,hr,aside"

/** 这些元素会把样式或脚本带进应用文档，直接连内容一起丢掉。 */
const DANGEROUS_ELEMENTS = new Set(["script", "style", "iframe", "object", "embed", "link", "meta", "base", "form"])

/** `javascript:` 一类可执行地址；`data:` 只挡 HTML，免得连正常的 data URI 图片也杀掉。 */
const DANGEROUS_URL = /^\s*(?:javascript|vbscript|data:text\/html)/i

export function markdownToHtml(source: string): string {
  const template = document.createElement("template")
  template.innerHTML = marked.parse(source, { async: false, gfm: true })
  sanitize(template.content)
  promoteAlerts(template.content)
  tagBlockTypes(template.content)
  return template.innerHTML
}

function sanitize(root: DocumentFragment): void {
  for (const element of [...root.querySelectorAll("*")]) {
    if (DANGEROUS_ELEMENTS.has(element.tagName.toLowerCase())) {
      element.remove()
      continue
    }
    for (const attribute of [...element.attributes]) {
      const name = attribute.name.toLowerCase()
      if (name.startsWith("on")) {
        element.removeAttribute(attribute.name)
      } else if ((name === "href" || name === "src" || name === "xlink:href") && DANGEROUS_URL.test(attribute.value)) {
        element.removeAttribute(attribute.name)
      }
    }
  }
}

function tagBlockTypes(root: DocumentFragment): void {
  for (const element of root.querySelectorAll(BLOCK_TAGS)) {
    const type = BLOCK_TYPES[element.tagName.toLowerCase()]
    if (type !== undefined) element.setAttribute("data-block-type", type)
  }
}

/**
 * GFM alert（`> [!NOTE]` 等）还原成提示框。
 *
 * 提示框在应用里没有 Markdown 原生语法：导入端摘掉触发词、换成提示框块（见
 * `import.ts`），导出端写成 `> [!NOTE]`。预览若照 marked 的原样渲染，同一篇 Markdown
 * 浏览时是引用块、转成笔记后却成了提示框 —— 这里是那条规则的 DOM 版：摘掉触发词，
 * 把 `<blockquote>` 换成 `<aside>`（导出文档里提示框就是 aside，`docStyle()` 按它上色）。
 */
function promoteAlerts(root: DocumentFragment): void {
  for (const quote of [...root.querySelectorAll("blockquote")]) {
    const paragraph = quote.firstElementChild
    if (paragraph === null || paragraph.tagName.toLowerCase() !== "p") continue
    if (!stripAlertMarker(paragraph)) continue
    // 触发词独占一整段（`> [!NOTE]` 换行接正文）时那一段已经空了，留着会多一个空行。
    if (paragraph.textContent === "" && paragraph.childElementCount === 0) paragraph.remove()
    const callout = document.createElement("aside")
    callout.append(...quote.childNodes)
    quote.replaceWith(callout)
  }
}

/**
 * 摘掉段落开头的触发词，摘到返回 `true`。
 *
 * 只看**第一个子节点**：触发词必须顶在内容最前面，前面套了行内标记就不是 alert
 * （与导入端读 `runs[0].text` 同一口径）。摘完顺手去掉 marked 因「触发词独占一行」
 * 留下的 `<br>`，否则提示框顶上会空一行。
 */
function stripAlertMarker(paragraph: Element): boolean {
  const first = paragraph.firstChild
  if (!(first instanceof Text)) return false
  if (!ALERT_MARKER.test(first.data)) return false
  first.data = first.data.replace(ALERT_MARKER, "").replace(/^\n/, "").replace(/^ /, "")
  if (first.data === "") first.remove()
  const leading = paragraph.firstChild
  if (leading instanceof HTMLBRElement) leading.remove()
  return true
}

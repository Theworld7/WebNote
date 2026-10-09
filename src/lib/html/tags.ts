/**
 * 标签分类表。解析器与行内采集器共用 —— 块级判定必须只有一份，
 * 否则「容器穿透」和「行内攒批」两处会对同一个标签给出不同答案。
 */

/** 图片标签。它虽是行内元素，但在笔记模型里永远是独立块。 */
export const IMAGE_TAG = "IMG"

/**
 * 块级标签：遇到就断行、开新块；集合外的标签按行内处理，连着攒进同一个文本块。
 *
 * `ASIDE` / `TABLE` / `PRE` / `HR` / `UL` / `OL` 在这一层会被各自的解析分支接走，
 * 列在这里是为了「容器穿透」判定能一致地认出它们是块边界。
 */
export const BLOCK_TAGS: ReadonlySet<string> = new Set([
  "ADDRESS",
  "ARTICLE",
  "ASIDE",
  "BLOCKQUOTE",
  "DD",
  "DETAILS",
  "DIALOG",
  "DIV",
  "DL",
  "DT",
  "FIELDSET",
  "FIGCAPTION",
  "FIGURE",
  "FOOTER",
  "FORM",
  "H1",
  "H2",
  "H3",
  "H4",
  "H5",
  "H6",
  "HEADER",
  "HGROUP",
  "HR",
  "LI",
  "MAIN",
  "NAV",
  "OL",
  "P",
  "PRE",
  "SECTION",
  "TABLE",
  "UL",
])

/**
 * 整段跳过的标签：这些元素的文本不属于笔记正文。
 * 剪藏来的页面里 `<script>` / `<style>` 往往带几十 KB 代码，不排掉正文会被淹没。
 */
export const SKIPPED_TAGS: ReadonlySet<string> = new Set([
  "AUDIO",
  "BUTTON",
  "CANVAS",
  "EMBED",
  "IFRAME",
  "MAP",
  "NOSCRIPT",
  "OBJECT",
  "OPTION",
  "SCRIPT",
  "SELECT",
  "STYLE",
  "SVG",
  "TEMPLATE",
  "TEXTAREA",
  "VIDEO",
])

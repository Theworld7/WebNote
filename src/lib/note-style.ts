/**
 * 页面级 CSS 的编辑器内预览：把用户写的选择器限定到正文列之内。
 *
 * 文件里的那份 CSS 是**整页**语义（`body`、`h1`、`:root` 都指整份文档），直接扔进
 * 应用文档会连侧栏、对话框、按钮一起改掉。所以预览前过一遍改写：
 *
 * - `html` / `body` / `:root` 开头的选择器 → 落到正文列本身 —— 用户写
 *   `body { font-family: … }` 想改的就是「整页的字体」，正文列就是这一页；
 * - 导出文件里的块级标签 → 编辑器里对应的块正文（`p` → `[data-block-type="text"]`，
 *   `h1` → `[data-block-type="h1"]`…）—— 编辑器不把正文渲染成 `<p>` / `<h1>`，
 *   不映射的话 `h1 { color: red }` 在编辑器里一条都命中不了；
 * - 其余选择器前挂正文列 → `p strong` 变成 `[data-doc] [data-block-type="text"] strong`。
 *
 * **改写用浏览器自己的 CSSOM，不自己写解析器**：`CSSStyleSheet.replaceSync` 拿到
 * 的就是规范解析结果，`selectorText` / `cssText` 是规范序列化，`@media` / `@supports`
 * 递归下去即可。手写一个 CSS 解析器来干这件事，只会在 `:is(a, b)`、注释、转义上翻车。
 *
 * 选择器**不做** `:where()` 降权：块正文挂着 Tailwind 工具类（`0,1,0`），降权后的
 * 用户规则（`0,0,1`）会被它们压掉 —— 那就成了「导出有效、编辑时看不见」，恰好是这条
 * 预览要消除的偏差。挂一层正文列 + 一块正文的类型钩子（`0,2,0`）才与导出侧的层叠
 * 顺序对得上（那边用户样式写在基础样式之后、同权重取后者）。
 *
 * 已知偏差（改写不了的不假装支持）：`@import` 会被丢掉（外部表不受这里的限定，
 * 放进来等于把不受控的整张表引进程），`@layer` / `@container` 里的规则不改写，
 * 其余 `@font-face` / `@keyframes` / `@property` 原样保留 —— 它们只注册名字、不按
 * 选择器生效，外泄无从谈起；表格 / 图片 / 行内标记在编辑器里本就是真元素，无需映射。
 */

/** 被视作「整页」的选择器起点 —— 改写到正文列自身上。 */
const ROOT_TOKENS: ReadonlySet<string> = new Set(["html", "body", ":root"])

/**
 * 导出文件里的块级标签 → 编辑器里承载同一段正文的块类型。
 *
 * 键是导出 HTML 的标签名，值是该标签在编辑器里对应的块正文类型（`BlockItem` 把
 * `data-block-type` 挂在承载 runs 的那个元素上，而不是整行 —— 整行的字号会被
 * 正文自己的工具类盖掉，改颜色却会生效，那种「一半生效」比不生效更难解释）。
 *
 * `li` 一对多：编辑器里三种列表块各自成行，没有 `<li>`。
 * `code` 不在此列 —— 行内 code 在编辑器里就是真的 `<code>`，映射到代码块会误伤。
 */
const TAG_TO_BLOCK_TYPE: ReadonlyMap<string, readonly string[]> = new Map([
  ["p", ["text"]],
  ["h1", ["h1"]],
  ["h2", ["h2"]],
  ["h3", ["h3"]],
  ["h4", ["h4"]],
  ["h5", ["h5"]],
  ["h6", ["h6"]],
  ["blockquote", ["quote"]],
  ["aside", ["callout"]],
  ["ul", ["ul"]],
  ["ol", ["ol"]],
  ["li", ["ul", "ol", "todo"]],
  ["pre", ["code"]],
  ["hr", ["divider"]],
])

function blockTypeSelector(type: string): string {
  return `[data-block-type="${type}"]`
}

/**
 * 一条选择器列表里各项的改写结果。
 *
 * 逗号要按**顶层**切：`:is(a, b)` 里的逗号属于函数参数，切开就成了两条残破的选择器。
 */
function scopeSelectorList(selectorText: string, root: string): string {
  return splitTopLevel(selectorText)
    .flatMap((part) => scopeSelector(part, root))
    .join(", ")
}

function splitTopLevel(text: string): string[] {
  const parts: string[] = []
  let depth = 0
  let current = ""
  for (const char of text) {
    if (char === "(" || char === "[") depth += 1
    else if (char === ")" || char === "]") depth -= 1
    if (char === "," && depth === 0) {
      parts.push(current)
      current = ""
      continue
    }
    current += char
  }
  parts.push(current)
  return parts
}

/** 单个（不含顶层逗号的）选择器：剥掉开头的根选择器，再把正文列挂到最前面。 */
function scopeSelector(selector: string, root: string): string[] {
  const tokens = selector.trim().split(/\s+/).filter((token) => token !== "")
  let index = 0
  while (index < tokens.length && ROOT_TOKENS.has(tokens[index])) index += 1
  // 整条就是 `body` / `html body` / `:root` —— 指的就是这一页本身。
  if (index === tokens.length) return [root]

  const rest = tokens.slice(index + 1)
  const types = TAG_TO_BLOCK_TYPE.get(tokens[index])
  if (types !== undefined) {
    return types.map((type) => [root, blockTypeSelector(type), ...rest].join(" "))
  }
  return [[root, ...tokens.slice(index)].join(" ")]
}

function scopeRules(rules: CSSRuleList, root: string): string[] {
  const out: string[] = []
  for (const rule of rules) {
    if (rule instanceof CSSStyleRule) {
      rule.selectorText = scopeSelectorList(rule.selectorText, root)
      out.push(rule.cssText)
      continue
    }
    if (rule instanceof CSSMediaRule || rule instanceof CSSSupportsRule) {
      // 条件本身不动，只把块内的规则逐条改写：`cssText` 序列化的是改写后的子规则。
      scopeRules(rule.cssRules, root)
      out.push(rule.cssText)
      continue
    }
    // `@import` 会把一张不受限定的表拉进来，丢掉；其余 at-rule 只注册名字，原样留。
    if (rule instanceof CSSImportRule) continue
    out.push(rule.cssText)
  }
  return out
}

/**
 * 把一份页面级 CSS 限定到 `root`（一个 CSS 选择器，如 `[data-doc]`）。
 *
 * 解析不了（浏览器不认的写法、构造器不可用）时返回空串 —— 预览少一块，比把
 * 半份错误的 CSS 贴进应用文档要好。落盘那份始终是原文，不受这里影响。
 */
export function scopeCss(css: string, root: string): string {
  if (css.trim() === "") return ""
  let sheet: CSSStyleSheet
  try {
    sheet = new CSSStyleSheet()
    sheet.replaceSync(css)
  } catch {
    return ""
  }
  try {
    return scopeRules(sheet.cssRules, root).join("\n")
  } catch {
    return ""
  }
}

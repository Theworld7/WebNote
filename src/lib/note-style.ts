import type { Theme } from "@/types/workspace"

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
 * - 其余选择器前挂正文列 → `p strong` 变成 `[data-doc] [data-block-type="text"] strong`；
 * - 自定义属性统一加 `--doc-` 前缀（声明与 `var()` 引用一起改）—— 见 `VAR_PREFIX`；
 * - `color-scheme: light dark` 与 `@media (prefers-color-scheme: …)` 按**应用**此刻的
 *   外观判一次 —— 见 `resolveScheme` / `resolveSchemeMedia`。预览的读者是应用本身，
 *   不是这台机器的系统外观。
 *
 * 只判外观、不改选择器的那一份是 `pinScheme`：沙箱 iframe（HTML 块）用的是页面样式的
 * **原文**，没有正文列可限定、也没有应用 token 可撞名，但同样得按应用外观解析。
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
 * 用 `or` 把外观与别的条件并起来的媒体查询不判（`and` 链才判 —— `or` 的短路语义
 * 会让「摘掉一段」不再是等价改写），
 * 其余 `@font-face` / `@keyframes` / `@property` 原样保留 —— 它们只注册名字、不按
 * 选择器生效，外泄无从谈起；表格 / 图片 / 行内标记在编辑器里本就是真元素，无需映射。
 */

/** 被视作「整页」的选择器起点 —— 改写到正文列自身上。 */
const ROOT_TOKENS: ReadonlySet<string> = new Set(["html", "body", ":root"])

/**
 * 预览里给页面 CSS 的自定义属性加的前缀。
 *
 * `:root { --muted: #6b7280 }` 改写后落在正文列上，自定义属性会随继承钻进正文列下面的
 * **一切** —— 包括编辑器自己的悬浮手柄：它们靠应用 token 上色，而 `--muted` 恰好同名，
 * 于是 ghost 按钮的 `hover:bg-muted` 从浅灰变成用户的深灰（`--line` / `--accent` /
 * `--background` 同理）。素材变量统一加前缀，撞名这件事就不存在；声明与 `var()` 引用
 * 一起改，内容侧照旧生效。落盘与 HTML 块 iframe 用的仍是原文，不受这里影响。
 */
const VAR_PREFIX = "--doc-"

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

/** 带声明块的规则。关键帧里的每一帧也是同一形态。 */
function declarationsOf(rule: CSSRule): CSSStyleDeclaration | null {
  if (rule instanceof CSSStyleRule || rule instanceof CSSKeyframeRule) return rule.style
  return null
}

/** 分组 / 关键帧规则：里面还有一层要改的声明。 */
function childRules(rule: CSSRule): CSSRuleList | null {
  if (rule instanceof CSSMediaRule || rule instanceof CSSSupportsRule || rule instanceof CSSKeyframesRule) {
    return rule.cssRules
  }
  return null
}

/**
 * 本份 CSS 声明过的自定义属性名。
 *
 * 只改这些名字的引用：用户写了 `var(--primary)` 却没在页面样式里声明它，那本来就解析
 * 不出来（导出侧也一样），不该由预览悄悄替他对上应用 token。
 */
function collectVarNames(rules: CSSRuleList, names: Set<string>): void {
  for (const rule of rules) {
    const style = declarationsOf(rule)
    if (style !== null) {
      for (let index = 0; index < style.length; index += 1) {
        const name = style.item(index)
        if (name.startsWith("--")) names.add(name)
      }
      continue
    }
    const inner = childRules(rule)
    if (inner !== null) collectVarNames(inner, names)
  }
}

/** 一条声明值里的 `var(--x` → `var(--doc-x`；未声明过的名字原样留。 */
function prefixVarRefs(value: string, names: ReadonlySet<string>): string {
  return value.replace(/var\(\s*(--[A-Za-z0-9_-]+)/g, (whole: string, name: string) =>
    names.has(name) ? `var(${VAR_PREFIX}${name.slice(2)}` : whole,
  )
}

/**
 * 声明与引用一起改名（见 `VAR_PREFIX`）。
 *
 * 分两步：属性**名**逐条改，属性**值**落到序列化文本上改。后者不能逐条来 ——
 * `border-color: var(--line)` 这种简写含 `var()` 时处于 pending-substitution 状态，
 * `getPropertyValue` 把展开出来的 longhand 全读成空串，逐条改会把值悄悄弄丢。
 */
function prefixVars(rules: CSSRuleList, names: ReadonlySet<string>): void {
  for (const rule of rules) {
    const style = declarationsOf(rule)
    if (style !== null) {
      // 先快照再改：`removeProperty` 会让后面各项的索引整体前移，边遍历边改会漏项。
      const declarations: Array<[string, string, string]> = []
      for (let index = 0; index < style.length; index += 1) {
        const name = style.item(index)
        declarations.push([name, style.getPropertyValue(name), style.getPropertyPriority(name)])
      }
      for (const [name, value, priority] of declarations) {
        if (!name.startsWith("--") || !names.has(name)) continue
        style.removeProperty(name)
        style.setProperty(`${VAR_PREFIX}${name.slice(2)}`, value, priority)
      }
      const rewritten = prefixVarRefs(style.cssText, names)
      if (rewritten !== style.cssText) style.cssText = rewritten
      continue
    }
    const inner = childRules(rule)
    if (inner !== null) prefixVars(inner, names)
  }
}

/** `prefers-color-scheme` 那一段条件（`and` 链里的一项）。 */
const SCHEME_TERM = /^\(\s*prefers-color-scheme\s*:\s*(light|dark)\s*\)$/i

/**
 * 媒体条件里的 `and` 链按顶层切段。
 *
 * 只切顶层的 `and`：`(min-width: 600px) and (prefers-color-scheme: dark)` 要把中间那段
 * 单独摘掉，而 `or` 与函数参数里的括号不能切坏。
 */
function splitMediaTerms(text: string): string[] {
  const terms: string[] = []
  let depth = 0
  let current = ""
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index] ?? ""
    if (char === "(") depth += 1
    else if (char === ")") depth -= 1
    const isAnd =
      depth === 0 &&
      /\s/.test(char) &&
      text.slice(index + 1, index + 4).toLowerCase() === "and" &&
      /\s/.test(text[index + 4] ?? "")
    if (isAnd) {
      terms.push(current.trim())
      current = ""
      // 跳过 " and " 的四个字符（循环本身还会再加一）。
      index += 4
      continue
    }
    current += char
  }
  terms.push(current.trim())
  return terms.filter((term) => term !== "")
}

/**
 * 对照应用外观判一条媒体查询：`null` = 与外观无关（原样保留），否则给出结论。
 *
 * 成立时把 `prefers-color-scheme` 那几段摘掉 —— 外层可以直接摊平，也可以与剩下的条件重拼。
 */
function resolveSchemeMedia(text: string, scheme: Theme): { matched: boolean; terms: string[] } | null {
  const terms = splitMediaTerms(text)
  const schemeTerms = terms.filter((term) => SCHEME_TERM.test(term))
  if (schemeTerms.length === 0) return null
  const matched = schemeTerms.every((term) => SCHEME_TERM.exec(term)?.[1]?.toLowerCase() === scheme)
  return { matched, terms: terms.filter((term) => !SCHEME_TERM.test(term)) }
}

/** 声明的值是不是「两种都收」（`light dark` / `dark light`，顺序无关）。 */
function declaresBothSchemes(value: string): boolean {
  const tokens = value.toLowerCase().split(/\s+/)
  return tokens.includes("light") && tokens.includes("dark")
}

/**
 * `color-scheme: light dark` 收到应用此刻的外观上。
 *
 * 导出文件里这条声明是写给**读者**的：打开它的那台机器是深就深。但预览的读者是应用 ——
 * 应用被手动切成深色、系统还停在浅色时，正文列的用色方案会退回浅色，正文列上的系统色
 * 关键词（`Canvas` 之类）就画成一张白纸（真实 bug：深色界面里笔记纸面全白，浅色文字
 * 压在上面）。同一条道理也管着 `@media (prefers-color-scheme: …)` 那一支，见
 * `resolveSchemeMedia`。
 *
 * 只动「两种都收」的写法：`normal` / `light` / `dark` 是作者明说要哪一侧，照他写的 ——
 * 一张写死浅色的卡片在深色界面里本来就该是浅色的。
 */
function resolveScheme(rules: CSSRuleList, scheme: Theme): void {
  for (const rule of rules) {
    const style = declarationsOf(rule)
    if (style !== null) {
      if (!declaresBothSchemes(style.getPropertyValue("color-scheme"))) continue
      style.setProperty("color-scheme", scheme, style.getPropertyPriority("color-scheme"))
      continue
    }
    const inner = childRules(rule)
    if (inner !== null) resolveScheme(inner, scheme)
  }
}

function scopeRules(rules: CSSRuleList, root: string, scheme: Theme): string[] {
  const out: string[] = []
  for (const rule of rules) {
    if (rule instanceof CSSStyleRule) {
      rule.selectorText = scopeSelectorList(rule.selectorText, root)
      out.push(rule.cssText)
      continue
    }
    if (rule instanceof CSSMediaRule) {
      const verdict = resolveSchemeMedia(rule.media.mediaText, scheme)
      if (verdict === null) {
        // 与外观无关：条件不动，只把块内的规则逐条改写（`cssText` 序列化的是改写后的子规则）。
        scopeRules(rule.cssRules, root, scheme)
        out.push(rule.cssText)
        continue
      }
      // 与外观有关：按应用此刻的外观判一次，不成立就整条丢掉。
      if (!verdict.matched) continue
      const inner = scopeRules(rule.cssRules, root, scheme).join("\n")
      out.push(verdict.terms.length === 0 ? inner : `@media ${verdict.terms.join(" and ")} { ${inner} }`)
      continue
    }
    if (rule instanceof CSSSupportsRule) {
      scopeRules(rule.cssRules, root, scheme)
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
 * `scheme` 是**应用此刻的外观**：页面样式里「浅色 / 深色两套」的写法按它解析，不按系统
 * （理由见 `resolveScheme`）。
 *
 * 解析不了（浏览器不认的写法、构造器不可用）时返回空串 —— 预览少一块，比把
 * 半份错误的 CSS 贴进应用文档要好。落盘那份始终是原文，不受这里影响。
 */
export function scopeCss(css: string, root: string, scheme: Theme): string {
  if (css.trim() === "") return ""
  let sheet: CSSStyleSheet
  try {
    sheet = new CSSStyleSheet()
    sheet.replaceSync(css)
  } catch {
    return ""
  }
  try {
    const names = new Set<string>()
    collectVarNames(sheet.cssRules, names)
    if (names.size > 0) prefixVars(sheet.cssRules, names)
    resolveScheme(sheet.cssRules, scheme)
    return scopeRules(sheet.cssRules, root, scheme)
      .filter((chunk) => chunk !== "")
      .join("\n")
  } catch {
    return ""
  }
}

/**
 * 只把「浅色 / 深色两套」按外观判一次，**不动选择器、不动自定义属性名**。
 *
 * 沙箱 iframe（HTML 块）用的就是这一份：那里没有 `[data-doc]` 正文列可限定，也没有会
 * 撞名的应用 token —— 它就是这篇笔记的一个洞，选择器语义与导出侧完全相同（见 ADR-0013）。
 * 唯一要改的是「听读者的」那类写法，因为读者是**应用**：`color-scheme: light dark`
 * 收成单一值，`@media (prefers-color-scheme: …)` 成立就摊平、不成立就丢掉。
 *
 * 不改写是行不通的：iframe 是独立文档，`color-scheme: light dark` 会退到这台机器的系统
 * 外观，而应用可以手动切到深色 —— 那时块里 `body { background: Canvas }` 就在深色界面上
 * 画一张白纸。
 *
 * 解析失败的 CSS 原样返回（不是空串）：iframe 此前一直吃原文，解析器不认的写法也不该
 * 因为这件事整份消失。
 */
export function pinScheme(css: string, scheme: Theme): string {
  if (css.trim() === "") return ""
  // 没有跟外观有关的写法就原样放行：改一句话不该把整份 CSS 过一遍 CSSOM 重新序列化
  // （注释会掉、格式会变，而块里的样式本来是和导出共用的那份原文）。
  if (!/color-scheme/i.test(css) && !/prefers-color-scheme/i.test(css)) return css
  let sheet: CSSStyleSheet
  try {
    sheet = new CSSStyleSheet()
    sheet.replaceSync(css)
  } catch {
    return css
  }
  try {
    resolveScheme(sheet.cssRules, scheme)
    return flattenSchemeMedia(sheet.cssRules, scheme).join("\n")
  } catch {
    return css
  }
}

/** `scopeRules` 的无改写版：只处理与外观有关的 `@media`，其余规则原样序列化。 */
function flattenSchemeMedia(rules: CSSRuleList, scheme: Theme): string[] {
  const out: string[] = []
  for (const rule of rules) {
    if (rule instanceof CSSMediaRule) {
      const verdict = resolveSchemeMedia(rule.media.mediaText, scheme)
      if (verdict === null) {
        out.push(rule.cssText)
        continue
      }
      if (!verdict.matched) continue
      const inner = flattenSchemeMedia(rule.cssRules, scheme).join("\n")
      out.push(verdict.terms.length === 0 ? inner : `@media ${verdict.terms.join(" and ")} { ${inner} }`)
      continue
    }
    out.push(rule.cssText)
  }
  return out
}

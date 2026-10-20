/**
 * 源码的格式化（prettier），以及页面级 CSS 的落盘紧凑化。
 *
 * 文件里的那份源码是**文档数据**，不是构建产物：它跟着笔记走、被人手改、被 git 比对。
 * 但一条压成一行的 `body{font-family:…}h1{color:#333}` 在抽屉里没法读也没法改。两个
 * 需求方向相反，所以按阶段分开：
 *
 * - **打开抽屉时** `formatCss()` / `formatHtml()` 把它排版成人能读的样子（prettier，
 *   只作用于编辑器里的文本缓冲）；
 * - **提交时** CSS 走 `compactCss()` 压回紧凑形态 —— 磁盘上永远不会多出 prettier 的缩进。
 *
 * HTML 没有对应的紧凑化：它本来就是按用户写的形态存进围栏注释的（见 `serialize.ts` 的
 * `htmlBlockHtml`），排版结果直接落盘，文件里不再有「读不出来的单行」可言。
 *
 * 中间那一层刻意分开：格式化是可丢的显示层（prettier 加载失败就退化成原文，不影响读写），
 * 紧凑化是写入路径必须成功的纯函数（不能因为它失败就写不进去）。
 *
 * 代码块编辑态的「格式化」按钮（ADR-0018）用的是同一台引擎，但**不自动**：代码块的正文
 * 就是笔记内容本身，打开即改写会在文件里凭空多出一层 diff。它只在按下按钮时排版缓冲，
 * 落盘仍走 blur / 完成那条路。
 */

/**
 * 有格式化器的语言。键是 **Monaco 的 language id**，也正是 `block.lang` 的取值 ——
 * 两边同一个名字，调用方不必再翻译一次。
 *
 * prettier 覆盖不到的（python / shell / sql / go / rust）不在这里，按钮据此置灰。
 */
export type FormatLanguage = "css" | "html" | "javascript" | "typescript" | "json" | "yaml" | "markdown"

/** prettier 的插件包。按**包**缓存而不是按语言：`javascript` 与 `json` 共用 babel，不各下两份。 */
type PluginPackage = "postcss" | "html" | "babel" | "estree" | "typescript" | "yaml" | "markdown"

interface FormatSpec {
  /** prettier 的 parser 名 —— 不总等于语言 id：`javascript` 走 babel，`json` 也走 babel。 */
  parser: string
  /** 见下：babel / typescript 都只出 AST，printer 在 estree 里，必须成对加载。 */
  plugins: readonly PluginPackage[]
}

/**
 * estree 不是可选优化：prettier 的 babel / typescript 插件只负责把源码解析成
 * `astFormat: "estree"`，打印器住在 `plugins/estree` 里。少了它 standalone 会直接报
 * `Couldn't find plugin for AST format "estree"`。CSS / HTML / YAML / Markdown 的
 * parser 与 printer 在同一个包里，不需要它。
 */
const SPECS: Record<FormatLanguage, FormatSpec> = {
  css: { parser: "css", plugins: ["postcss"] },
  html: { parser: "html", plugins: ["html"] },
  javascript: { parser: "babel", plugins: ["babel", "estree"] },
  typescript: { parser: "typescript", plugins: ["typescript", "estree"] },
  json: { parser: "json", plugins: ["babel", "estree"] },
  yaml: { parser: "yaml", plugins: ["yaml"] },
  markdown: { parser: "markdown", plugins: ["markdown"] },
}

/** 加载好的引擎；`null` = 加载过且失败（不再重试，退化成原文）。 */
type Engine = {
  /** prettier 的 `formatWithCursor` —— 排版的同时把光标偏移翻译到新文本里。 */
  format: typeof import("prettier/standalone").formatWithCursor
  plugins: readonly import("prettier").Plugin[]
}

/** 按语言缓存 —— 一门语言加载一次，之后重排不再碰网络。 */
const engines = new Map<FormatLanguage, Promise<Engine | null>>()

/**
 * 懒加载 prettier。
 *
 * 走 `standalone` + 按语言的插件而不是完整包：这是浏览器环境，prettier 的 Node 入口
 * 依赖 `fs` / `process`。动态 import 让它只进「格式化」那条链路 —— 只排 CSS 的会话
 * 不为 babel / typescript 那几百 KB 付钱。
 */
const LOADERS: Record<PluginPackage, () => Promise<import("prettier").Plugin>> = {
  postcss: () => import("prettier/plugins/postcss"),
  html: () => import("prettier/plugins/html"),
  babel: () => import("prettier/plugins/babel"),
  estree: () => import("prettier/plugins/estree"),
  typescript: () => import("prettier/plugins/typescript"),
  yaml: () => import("prettier/plugins/yaml"),
  markdown: () => import("prettier/plugins/markdown"),
}

function loadEngine(language: FormatLanguage): Promise<Engine | null> {
  const cached = engines.get(language)
  if (cached !== undefined) return cached
  const pending = (async (): Promise<Engine | null> => {
    try {
      const [standalone, ...plugins] = await Promise.all([
        import("prettier/standalone"),
        ...SPECS[language].plugins.map((name) => LOADERS[name]()),
      ])
      // 插件模块本身就是 `{ parsers, printers }`，没有 default 导出，整个命名空间当插件用。
      return { format: standalone.formatWithCursor, plugins }
    } catch {
      return null
    }
  })()
  engines.set(language, pending)
  return pending
}

/** 类型守卫：把任意 `block.lang` 收窄成有格式化器的那些。 */
function isFormatLanguage(language: string): language is FormatLanguage {
  return Object.prototype.hasOwnProperty.call(SPECS, language)
}

/** 这门语言有没有格式化器 —— 工具栏据此决定「格式化」按钮是否置灰。 */
export function supportsFormat(language: string): boolean {
  return isFormatLanguage(language)
}

export interface FormattedSource {
  /** 排版后的全文（结尾不留空行）。 */
  text: string
  /** 调用方给的 `cursorOffset` 在排版后文本里的对应位置。 */
  cursorOffset: number
}

/**
 * 排版一段源码。
 *
 * 空串、语言没有格式化器、解析失败（编辑到一半的代码、引擎没装起来）一律返回 `null`，
 * 调用方据此保留原文 —— 格式化是锦上添花，任何情况下都不该挡住编辑。
 *
 * `cursorOffset` 必须落在 `[0, source.length]` 内（prettier 会断言），越界由调用方夹紧。
 */
export async function formatCode(language: string, source: string, cursorOffset: number): Promise<FormattedSource | null> {
  if (!isFormatLanguage(language) || source.trim() === "") return null
  const loaded = await loadEngine(language)
  if (loaded === null) return null
  try {
    const result = await loaded.format(source, {
      parser: SPECS[language].parser,
      plugins: [...loaded.plugins],
      cursorOffset,
    })
    // prettier 结尾恒有一个换行，摆进编辑器会多出一行空行。
    const text = result.formatted.replace(/\n+$/, "")
    return { text, cursorOffset: Math.min(result.cursorOffset, text.length) }
  } catch {
    return null
  }
}

/** 排版页面级 CSS。 */
export async function formatCss(css: string): Promise<string> {
  return (await formatCode("css", css, 0))?.text ?? ""
}

/** 排版 HTML 块的原文。 */
export async function formatHtml(html: string): Promise<string> {
  return (await formatCode("html", html, 0))?.text ?? ""
}

/** 空格可以丢掉的「前一个字符」。 */
const TIGHT_AFTER: ReadonlySet<string> = new Set(["{", "}", ";", ",", ":", "(", ">", "~"])

/**
 * 空格可以丢掉的「后一个字符」。
 *
 * **不含 `:`** —— `a :hover`（后代）和 `a:hover` 是两个选择器；
 * **不含 `(`** —— `and (min-width:…)` 里的空格一丢，`and(` 就成了函数记号，条件直接失效；
 * **不含 `+` `-` `*` `/`** —— `calc(100% - 10px)` 少一个空格就是非法值。
 * 宁可留一个多余空格，也不要猜。
 */
const TIGHT_BEFORE: ReadonlySet<string> = new Set(["{", "}", ";", ",", ")", ">", "~"])

/**
 * 把 CSS 压成紧凑形态：去掉多余的空白与换行，**不改值、不删注释**。
 *
 * 这不是压缩器。`#ffffff → #fff`、`0px → 0`、合并同值规则那类优化都有语义风险
 * （值序列化、`calc` 里的单位、自定义属性的原文），而这份文件是用户的笔记 —— 省几十
 * 个字节不值得赌一次写坏。这里只做「空白层面的重排」，因此可证明地不改语义：
 * 字符串里的空白（`content: "a  b"`）原样保留，注释保留但内部压成一行，唯一被删掉的
 * 是分号（块内多余的 `;;`、`}` 前的最后一个 `;`）。
 */
export function compactCss(css: string): string {
  const out: string[] = []
  let pendingSpace = false
  let index = 0

  // 取「最后吐出去的那个字符」而不是最后一段文本：一段可能是整条字符串 / 整条注释。
  // 需要看末字的都是 `{` `}` `;` `,` `:` 这类单字符，所以这样取才是对的。
  const last = () => (out[out.length - 1] ?? "").slice(-1)

  /** 落一段确定要输出的文本：先按边界规则决定前面那个空格还要不要。 */
  const put = (text: string) => {
    if (pendingSpace && out.length > 0) {
      const next = text[0] ?? ""
      if (!TIGHT_AFTER.has(last()) && !TIGHT_BEFORE.has(next)) out.push(" ")
    }
    pendingSpace = false
    out.push(text)
  }

  while (index < css.length) {
    const char = css[index] ?? ""

    if (char === "/" && css[index + 1] === "*") {
      const end = css.indexOf("*/", index + 2)
      const body = end === -1 ? css.slice(index + 2) : css.slice(index + 2, end)
      // 注释留着（可能是用户写的注记），但内部的换行与缩进压成单空格。
      put(`/*${body.replace(/\s+/g, " ").trim()}*/`)
      // 注释本身就是分隔符：`a/**/b` 里的两端不能被粘成一个记号。
      pendingSpace = true
      index = end === -1 ? css.length : end + 2
      continue
    }

    if (char === '"' || char === "'") {
      let end = index + 1
      while (end < css.length) {
        if (css[end] === "\\") {
          end += 2
          continue
        }
        if (css[end] === char) {
          end += 1
          break
        }
        end += 1
      }
      put(css.slice(index, end))
      index = end
      continue
    }

    // 字符串外的反斜杠转义（选择器里的 `\:`、`\ ` 等）：两个字符是一个整体。
    if (char === "\\") {
      put(css.slice(index, index + 2))
      index += 2
      continue
    }

    if (/\s/.test(char)) {
      pendingSpace = true
      index += 1
      continue
    }

    if (char === "}") {
      // 块尾的分号没有意义：前提是它确实是这一块的分号，而不是某个函数 / 字符串里的字符
      // （字符串与转义已在上面整段吞掉，走到这里的分号都属于声明层）。
      if (last() === ";") out.pop()
      put("}")
      index += 1
      continue
    }

    if (char === ";" && (last() === "{" || last() === ";" || last() === "}")) {
      index += 1
      continue
    }

    put(char)
    index += 1
  }

  return out.join("")
}

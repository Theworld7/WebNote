/**
 * 页面级 CSS 的「编辑期格式化 / 落盘紧凑化」。
 *
 * 文件里的那份 CSS 是**文档数据**，不是构建产物：它跟着笔记走、被人手改、被 git 比对。
 * 但一条压成一行的 `body{font-family:…}h1{color:#333}` 在抽屉里没法读也没法改。两个
 * 需求方向相反，所以按阶段分开：
 *
 * - **打开抽屉时** `formatCss()` 把它排版成人能读的样子（prettier，只作用于编辑器里的
 *   文本缓冲）；
 * - **提交时** `compactCss()` 再压回紧凑形态 —— 磁盘上永远不会多出 prettier 的缩进。
 *
 * 中间那一层刻意分开：格式化是可丢的显示层（prettier 加载失败就退化成原文，不影响读写），
 * 紧凑化是写入路径必须成功的纯函数（不能因为它失败就写不进去）。
 */

/** 加载好的 prettier 引擎；`null` = 加载过且失败（不再重试，抽屉退化成原文）。 */
type Engine = {
  format: (source: string, options: Record<string, unknown>) => Promise<string>
  plugin: Record<string, unknown>
}

let engine: Promise<Engine | null> | null = null

/**
 * 懒加载 prettier。
 *
 * 走 `standalone` + `postcss` 插件而不是完整包：这是浏览器环境，prettier 的 Node 入口
 * 依赖 `fs` / `process`。动态 import 让它只进「页面样式」那条链路 —— 不用这个功能的人
 * 不为它付启动成本。
 */
function loadEngine(): Promise<Engine | null> {
  engine ??= (async () => {
    try {
      const [standalone, postcss] = await Promise.all([
        import("prettier/standalone"),
        import("prettier/plugins/postcss"),
      ])
      return {
        format: standalone.format as Engine["format"],
        // 插件模块本身就是 `{ parsers, printers }`，没有 default 导出，整个命名空间当插件用。
        plugin: postcss as unknown as Record<string, unknown>,
      }
    } catch {
      return null
    }
  })()
  return engine
}

/**
 * 排版一段 CSS，供编辑器显示。
 *
 * 空串、解析失败（浏览器不认的写法、引擎没装起来）一律返回 `""`，调用方据此保留原文 ——
 * 格式化是锦上添花，任何情况下都不该挡住「打开抽屉」这件事。
 */
export async function formatCss(css: string): Promise<string> {
  if (css.trim() === "") return ""
  const loaded = await loadEngine()
  if (loaded === null) return ""
  try {
    const formatted = await loaded.format(css, { parser: "css", plugins: [loaded.plugin] })
    // prettier 结尾恒有一个换行，摆进编辑器会多出一行空行。
    return formatted.replace(/\n+$/, "")
  } catch {
    return ""
  }
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

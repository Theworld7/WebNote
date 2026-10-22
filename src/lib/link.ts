import { isNoteFile, isTableFile } from "@/lib/fs/policy"

/**
 * 行内链接「点下去会去哪儿」的判定。
 *
 * 链接地址是一段自由文本（浮层里粘什么进什么），所以「这是网址还是工作区文档」这件事
 * 只能有一处结论 —— 正文块与表格格子共用它，否则同一个 href 在两处会跳向不同的地方。
 */

/**
 * 一条链接的落地目标。
 *
 * - `none`：空地址与页内片段（`#xxx`），没有可打开的文档；
 * - `external`：带 scheme 的地址，交给系统浏览器；
 * - `workspace`：工作区里的笔记或数据表，在应用内开标签；
 * - `unsupported`：相对地址但指向的不是那两种文件，应用里打不开。
 */
export type LinkTarget =
  | { kind: "none" }
  | { kind: "external"; url: string }
  | { kind: "workspace"; path: string }
  | { kind: "unsupported"; href: string }

/** 地址里的 scheme（`mailto:` / `https:` / `data:` 都算外部）。 */
const SCHEME = /^[a-z][a-z0-9+.-]*:/i

/** 地址 → 落地目标。 */
export function linkTargetOf(href: string): LinkTarget {
  const text = href.trim()
  if (text === "" || text.startsWith("#")) return { kind: "none" }
  if (SCHEME.test(text)) return { kind: "external", url: text }

  const path = workspacePathOf(text)
  if (!isWorkspaceDoc(path)) return { kind: "unsupported", href: text }
  return { kind: "workspace", path }
}

/**
 * 这条工作区路径指向的是不是**能在应用里打开**的东西。
 *
 * 只有笔记与数据表有编辑器（见 ADR-0005），别的文件即使真在盘上，也没有可开的标签。
 * 后缀判定复用 `policy` 的那两个函数（它们只看名字末尾，传整条路径同样成立）——
 * 「什么后缀算笔记」不许有第二份口径。
 */
export function isWorkspaceDoc(path: string): boolean {
  return isNoteFile(path) || isTableFile(path)
}

/**
 * 把一条地址折成工作区路径（`日记 / 2026-10-08.html`）。
 *
 * 认三种写法：工作区路径本身（已带 ` / `）、正斜杠相对路径（`日记/2026-10-08.html`）、
 * 以及从磁盘路径里抄来的反斜杠写法。百分号编码先解码 —— 从浏览器地址栏复制出来的
 * 中文路径是编码过的。
 *
 * 不解析 `..`：工作区路径以根为基准，没有「相对于哪一层」这回事，猜一个只会猜错；
 * 它留在段里，落到「工作区里没有这个文件」那条提示上，比悄悄跳错地方诚实。
 */
export function workspacePathOf(href: string): string {
  const [head = ""] = href.split("#")
  return decodeSafely(head)
    .replace(/\\/g, "/")
    .split("/")
    .map((segment) => segment.trim())
    .filter((segment) => segment !== "" && segment !== ".")
    .join(" / ")
}

/** 解码百分号编码。坏编码（`%zz`）原样返回，不因为一个手打错的地址把链接变成死链。 */
function decodeSafely(text: string): string {
  try {
    return decodeURIComponent(text)
  } catch {
    return text
  }
}

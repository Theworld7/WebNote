import type { Crumb } from "@/types/workspace"

/**
 * 文档路径工具。
 *
 * 路径统一用 `日记 / 2026-10-08.html` 这种「空格斜杠空格」分隔的字符串表示 ——
 * 它是标签、面包屑、目录树三处共用的唯一键，所以解析逻辑只能有一份。
 *
 * 接真实文件系统后这层多了一个职责：**它是磁盘路径与工作区路径之间唯一的翻译点**。
 * `lib/fs/*` 负责把段拼成 `/` 或 `\` 分隔的绝对路径，别处不许再手拼分隔符。
 */

const SEP = " / "

/** 取末段文件名。`日记 / 2026-10-08.html` → `2026-10-08.html`。空串返回空串。 */
export function fileName(path: string): string {
  if (path === "") return ""
  const parts = path.split(SEP)
  return parts[parts.length - 1] ?? path
}

/** 路径 → 面包屑。最后一段是文件，其余是文件夹。空串返回空数组。 */
export function toCrumbs(path: string): Crumb[] {
  if (path === "") return []
  const parts = path.split(SEP)
  return parts.map((name, index) => ({ name, isFile: index === parts.length - 1 }))
}

/** 路径 → 目录段。`日记 / 2026-10-08.html` → `["日记", "2026-10-08.html"]`。空串返回空数组。 */
export function toSegments(path: string): string[] {
  if (path === "") return []
  return path.split(SEP)
}

/** 目录段 → 路径，`toSegments` 的逆。 */
export function fromSegments(segments: readonly string[]): string {
  return segments.join(SEP)
}

/** 往路径尾部接一段。父级为空串时只留子名（根层节点就是这样来的）。 */
export function joinPath(parent: string, name: string): string {
  return parent === "" ? name : `${parent}${SEP}${name}`
}

/**
 * 把一条路径从 `from` 前缀改写到 `to` 前缀，不命中则原样返回。
 *
 * 移动一个 Note 之后，五个以路径为键的状态（标签、文档、已加载集、激活项、展开集）都要
 * 跟着换键，它们共用这一条规则，所以规则只此一份。见 ADR-0003。
 *
 * **判前缀时要求边界对齐**：`日记` 不该命中 `日记本 / a.html` —— 两者只是字符串前缀相同，
 * 层级上毫无关系。所以比的是「等于」或「以 `from + 分隔符` 开头」。
 *
 * `from` 为空串（移动根层节点）时没有可改写的层级，原样返回。
 */
export function migratePath(path: string, from: string, to: string): string {
  if (from === "") return path
  if (path === from) return to
  if (!path.startsWith(`${from}${SEP}`)) return path
  return `${to}${path.slice(from.length)}`
}

/** 去掉 `.html` / `.htm` 后缀，用作序列化时的 `<title>`。 */
export function titleOf(path: string): string {
  return fileName(path).replace(/\.html?$/i, "")
}

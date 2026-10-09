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

/** 去掉 `.html` / `.htm` 后缀，用作序列化时的 `<title>`。 */
export function titleOf(path: string): string {
  return fileName(path).replace(/\.html?$/i, "")
}

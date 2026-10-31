/**
 * 批量导入 / 导出 Markdown 里**不需要磁盘的那一半**。
 *
 * 这里只回答两个问题：一个文件夹里有哪几篇笔记、每篇该写成哪个相对路径；
 * 以及一次批量动作用一句什么话交代结果。读内容、选目录、写盘分别在
 * `useWorkspace` 与 `lib/fs/transfer` 里 —— 那条链路要真实工作区与真实对话框，
 * 探针拿不到；而「哪些笔记、落到哪个名字」恰恰是最容易算错的部分，所以抽成纯函数，
 * 由 `design/markdown-batch-check.html` 脱离工作区验证。
 */
import type { FileNode } from "@/types/workspace"
import { fileStem, MARKDOWN_EXTENSION } from "@/lib/fs/policy"
import { toSegments } from "@/lib/paths"

export interface NoteExport {
  /** 工作区路径（`日记 / 2026-10-08.html`），读内容时用它。 */
  path: string
  /** 相对导出目录的磁盘路径（`日记/2026-10-08.md`），只用 `/`。 */
  relativePath: string
}

/**
 * `folderPath` 之下（含子文件夹）全部笔记的导出清单。
 *
 * **保留目录结构**，而不是把文件名摊平到一层：摊平之后 `日记/2026.html` 与
 * `工作/2026.html` 会争同一个 `2026.md`，只能二选一 —— 改名对不起用户起的名字
 * （ADR-0002 拒绝过的做法），覆盖更不行。照搬层级则每个相对路径天然唯一。
 *
 * 只认笔记（`.html` / `.htm`）。`.md` 文件不再导出 —— 它本来就是 Markdown，
 * 复制一份出去只是同名同内容的重复；数据表也不是笔记。
 */
export function noteExportsUnder(nodes: readonly FileNode[], folderPath: string): NoteExport[] {
  const prefix = toSegments(folderPath)
  const exports: NoteExport[] = []

  const walk = (list: readonly FileNode[]): void => {
    for (const node of list) {
      if (node.kind === "folder") {
        if (node.children !== undefined) walk(node.children)
        continue
      }
      if (node.kind !== "note") continue

      // 路径按**段**比对，不做字符串前缀 —— `日记` 不是 `日记本 / a.html` 的前缀。
      const segments = toSegments(node.id)
      if (segments.length <= prefix.length) continue
      if (!prefix.every((segment, index) => segments[index] === segment)) continue

      const relative = segments.slice(prefix.length)
      const last = relative.length - 1
      relative[last] = `${fileStem(relative[last] ?? "")}${MARKDOWN_EXTENSION}`
      exports.push({ path: node.id, relativePath: relative.join("/") })
    }
  }

  walk(nodes)
  return exports
}

/** 一次批量导入的结果。取消不算结果 —— 那种情况返回 `null`。 */
export interface ImportSummary {
  imported: number
  /** 因为重名没导的。按 ADR-0002 的立场不自动改名，只如实说有几篇。 */
  skipped: readonly string[]
  /** 解析或落盘失败的。 */
  failed: readonly string[]
}

/** 一次批量导出的结果。取消返回 `null`。 */
export interface ExportSummary {
  written: number
  /**
   * 没写出去的笔记，按工作区路径记。
   *
   * 读不出来（外部删除、权限）与写不进去（磁盘满、目标目录只读、路径过长）都算
   * —— 对用户而言是同一种结果：这几篇不在导出的那份里。分两种说法只会让他去猜
   * 到底哪一步出的问题。
   */
  failed: readonly string[]
}

/**
 * 一次批量动作对用户说的那句话。
 *
 * 放进纯函数是因为 `AppSidebar` 与 `FileTreeNode` 两处调用同一批动作 —— 文案只该有一份，
 * 否则「导入 3 篇重名 2 篇」在两处的说法迟早会漂开。
 */
export function importSummaryText(summary: ImportSummary): string {
  const parts: string[] = []
  if (summary.imported > 0) parts.push(`已导入 ${summary.imported} 篇`)
  if (summary.skipped.length > 0) parts.push(`${summary.skipped.length} 篇重名未导入`)
  if (summary.failed.length > 0) parts.push(`${summary.failed.length} 篇失败`)
  // 一篇都没进来时不能以「已导入 0 篇」开头 —— 那不是结果，是没结果。
  if (parts.length === 0) return "没有可导入的文件"
  return parts.join("，")
}

export function exportSummaryText(summary: ExportSummary): string {
  if (summary.written === 0 && summary.failed.length === 0) return "没有可导出的笔记"
  const parts: string[] = []
  if (summary.written > 0) parts.push(`已导出 ${summary.written} 篇 Markdown`)
  if (summary.failed.length > 0) parts.push(`${summary.failed.length} 篇未导出`)
  return parts.join("，")
}

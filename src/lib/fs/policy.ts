import type { FileNode } from "@/types/workspace"
import { joinPath } from "@/lib/paths"

/**
 * 目录扫描的共同规则。
 *
 * 两份 `WorkspaceFs` 实现共用这里的过滤与排序 —— 如果各写各的，Tauri 里能看见的
 * 文件浏览器里看不见（或顺序不一致），这种差异极难排查，且看起来像「浏览器端有 bug」。
 */

/** 认作笔记的后缀。目录里其它文件一律不进树。 */
const NOTE_EXTENSIONS = [".html", ".htm"]

/** 明确不进的目录。点开头的（`.git`、`.obsidian` 之类）由 `isBrowsableDir` 一并挡掉。 */
const SKIP_DIRS = new Set(["node_modules"])

/**
 * 递归深度上限。
 *
 * 软链接成环时 `readDir` / `entries()` 会一直往下走，靠它兜底。8 层对笔记库绰绰有余，
 * 真到 8 层还没到底的库，其结构本身就该整理了。
 */
export const MAX_DEPTH = 8

/** 后缀大小写不敏感 —— macOS 上 `.HTML` 是常见写法。 */
export function isNoteFile(name: string): boolean {
  const lower = name.toLowerCase()
  return NOTE_EXTENSIONS.some((extension) => lower.endsWith(extension))
}

/** 点开头的一律不放行：它们的访问受 fs scope 的 `require_literal_leading_dot` 限制，显示出来也读不到。 */
export function isBrowsableDir(name: string): boolean {
  return !name.startsWith(".") && !SKIP_DIRS.has(name)
}

/** 文件夹在前、同级按拼音。返回入参数组本身，调用方即可 `return sortNodes(list)`。 */
export function sortNodes(nodes: FileNode[]): FileNode[] {
  nodes.sort((left, right) => {
    if (left.kind !== right.kind) return left.kind === "folder" ? -1 : 1
    return left.name.localeCompare(right.name, "zh-Hans-CN")
  })
  return nodes
}

/**
 * 造节点。id 取完整工作区路径 —— 稳定、可反查、与标签页的键同源，
 * 树里每个节点因此天然是它自己的路径。
 */
export function folderNode(parentPath: string, name: string, children: FileNode[]): FileNode {
  return { id: joinPath(parentPath, name), name, kind: "folder", children }
}

export function fileNode(parentPath: string, name: string): FileNode {
  return { id: joinPath(parentPath, name), name, kind: "file" }
}

/**
 * 默认展开哪些文件夹：只展开根层。
 *
 * 样本时代是全展开（就 9 篇），换成真实笔记库后全展开会把几十个子目录一次性摊开，
 * 反而找不到东西。只开一层是「看得见结构、点一下就到内容」的折中。
 */
export function defaultExpanded(nodes: readonly FileNode[]): string[] {
  return nodes.filter((node) => node.kind === "folder").map((node) => node.id)
}

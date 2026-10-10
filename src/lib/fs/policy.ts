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

/** 新建笔记时补上的后缀。用户输的名字里已经带后缀就不再补。 */
export const NOTE_EXTENSION = ".html"

/**
 * 文件夹名里不能出现的字符。
 *
 * 分隔符首当其冲：`/` 会被 `joinPath` 当成层级切分，`\` 在 Windows 上同理；
 * 其余是 Windows 的保留字符（`:` `<` `>` `"` `|` `?` `*`）与控制字符 —— 两端共用一个
 * 校验，否则同一个名字在桌面端建得出来、在浏览器里建不出来（或反过来）。
 */
const FORBIDDEN_NAME_CHARS = /[/\\:*?"<>|\u0000-\u001f]/

/** Windows 保留设备名。大小写不敏感，带后缀也算（`con.html` 一样打不开）。 */
const RESERVED_NAMES = new Set([
  "con", "prn", "aux", "nul",
  "com1", "com2", "com3", "com4", "com5", "com6", "com7", "com8", "com9",
  "lpt1", "lpt2", "lpt3", "lpt4", "lpt5", "lpt6", "lpt7", "lpt8", "lpt9",
])

/**
 * 检查一个用户输入的名字能不能用来新建。
 *
 * 返回 `null` 表示可用，否则返回给用户看的原因。合法性规则只此一份 ——
 * 桌面端与浏览器端都必须先过它，否则「哪些名字建不出来」会随平台漂移。
 */
export function checkName(raw: string): string | null {
  const name = raw.trim()
  if (name === "") return "名字不能为空"
  if (name === "." || name === "..") return "这个名字不可用"
  if (FORBIDDEN_NAME_CHARS.test(name)) return "名字里不能有 / \\ : * ? \" < > | 这些字符"
  if (RESERVED_NAMES.has(name.split(".")[0]!.toLowerCase())) return "这个名字是系统保留名"
  if (raw !== name) return "名字首尾不能有空格"
  return null
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

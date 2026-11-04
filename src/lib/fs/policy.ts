import type { FileNode } from "@/types/workspace"
import { fileName, fromSegments, joinPath, toSegments } from "@/lib/paths"
import { assetsFolderName, isAssetsFolder } from "@/lib/video"

/**
 * 目录扫描的共同规则。
 *
 * 两份 `WorkspaceFs` 实现共用这里的过滤与排序 —— 如果各写各的，Tauri 里能看见的
 * 文件浏览器里看不见（或顺序不一致），这种差异极难排查，且看起来像「浏览器端有 bug」。
 */

/** 认作笔记的后缀。目录里其它文件一律不进树。 */
const NOTE_EXTENSIONS = [".html", ".htm"]

/**
 * 认作数据表的后缀。
 *
 * **专用扩展名**，不是 `.json`：树是拿**文件名**建起来的，`readDir` 只给
 * `name` / `isFile` / `isDirectory`，靠内容区分就得在扫描时把每个 `.json` 都读一遍 ——
 * 开发者目录里到处是 `package.json` / `tsconfig.json`，既会被列成数据表，也要为此付
 * 上百次读盘。专用后缀让「它是什么」成为名字的属性，而名字正是扫描唯一看得到的东西。
 * 代价只有「编辑器不再按 `.json` 给语法高亮」。见 ADR-0005。
 */
const TABLE_EXTENSIONS = [".tbl"]

/**
 * 认作 Markdown 的后缀。只读浏览用的普通文本文件，与笔记同列在树里。
 * 后缀集合仍只此一份：扫描过滤、改名补后缀、名字主干都读它。
 */
const MARKDOWN_EXTENSIONS = [".md", ".markdown"]

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

/** 是否是数据表文件。判定与 `isNoteFile` 同一口径：只看名字、大小写不敏感。 */
export function isTableFile(name: string): boolean {
  const lower = name.toLowerCase()
  return TABLE_EXTENSIONS.some((extension) => lower.endsWith(extension))
}

/** 是否是 Markdown 文件。判定与 `isNoteFile` 同一口径：只看名字、大小写不敏感。 */
export function isMarkdownFile(name: string): boolean {
  const lower = name.toLowerCase()
  return MARKDOWN_EXTENSIONS.some((extension) => lower.endsWith(extension))
}

/** 扫描时放行的文件：笔记、数据表、Markdown，其余一律不进树。 */
export function isBrowsableFile(name: string): boolean {
  return isNoteFile(name) || isTableFile(name) || isMarkdownFile(name)
}

/** 新建笔记时补上的后缀。用户输的名字里已经带后缀就不再补。 */
export const NOTE_EXTENSION = ".html"

/** 新建数据表时补上的后缀。 */
export const TABLE_EXTENSION = ".tbl"

/** 改名 Markdown 文件时补上的后缀。 */
export const MARKDOWN_EXTENSION = ".md"

/**
 * 名字主干：去掉已知后缀。`客户.tbl` → `客户`。
 *
 * 放在这里而不是各处自己 `replace(/\.\w+$/)`：后缀集合是这份模块的知识，
 * 判「有没有后缀」的口径只能有一份。新建数据表时拿当前笔记名做主干的默认名，
 * 「已写了后缀就别再补」也读它。
 */
export function fileStem(name: string): string {
  const lower = name.toLowerCase()
  for (const extension of [...NOTE_EXTENSIONS, ...TABLE_EXTENSIONS, ...MARKDOWN_EXTENSIONS]) {
    if (lower.endsWith(extension)) return name.slice(0, name.length - extension.length)
  }
  return name
}

/**
 * 笔记旁边的资源目录路径（`目录/笔记名.assets`）。不是笔记返回 `null`。
 *
 * 推导只此一份：导入视频时按它落盘，删笔记时按它收尾。两边各算一遍的话，
 * 任何一处改了口径（后缀、主干、父级），清理就会静默空转 —— 盘上那些视频再也没有
 * 入口能删掉，因为它们本来就不进文件树（`isBrowsableDir`）。
 *
 * 放在这一层是因为它同时要用「什么是笔记」（`isNoteFile`）与「资源目录叫什么」
 * （`assetsFolderName`），而后者由 `lib/video` 拥有、本模块已经在用。
 */
export function assetsPathOfNote(notePath: string): string | null {
  if (!isNoteFile(notePath)) return null
  const segments = toSegments(notePath)
  const parent = fromSegments(segments.slice(0, -1))
  return joinPath(parent, assetsFolderName(fileStem(fileName(notePath))))
}

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

/**
 * 点开头的一律不放行：它们的访问受 fs scope 的 `require_literal_leading_dot` 限制，
 * 显示出来也读不到。
 *
 * `<笔记名>.assets/` 同样不放行：那里面只放视频这类大文件（见 `lib/video`），
 * 树里既打不开也删不掉，留一个看起来空空的文件夹只是噪声。注意这条**只是不进树**，
 * 读写照旧 —— 视频块按相对路径自己解析，桌面端走 asset 协议、浏览器端走 `readBinary`，
 * 都不经过扫描。它也不进树意味着**删笔记时必须顺手收掉**（`deleteFile` 的
 * `removeAssetsOf`），否则用户再也没有入口能删掉它。
 */
export function isBrowsableDir(name: string): boolean {
  return !name.startsWith(".") && !SKIP_DIRS.has(name) && !isAssetsFolder(name)
}

/**
 * 文件夹在前、同级按拼音。返回入参数组本身，调用方即可 `return sortNodes(list)`。
 *
 * 分组只看「是不是文件夹」—— `note` / `table` / `markdown` 都在文件这一组里一起按名字排，
 * 因为把它们分成两组会让 `客户.tbl` 与 `客户.html` 被拆到两处，而它们是同一个名字。
 */
export function sortNodes(nodes: FileNode[]): FileNode[] {
  nodes.sort((left, right) => {
    const leftFolder = left.kind === "folder"
    const rightFolder = right.kind === "folder"
    if (leftFolder !== rightFolder) return leftFolder ? -1 : 1
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
  const kind = isTableFile(name) ? "table" : isMarkdownFile(name) ? "markdown" : "note"
  return { id: joinPath(parentPath, name), name, kind }
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

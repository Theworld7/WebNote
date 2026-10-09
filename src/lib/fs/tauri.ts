import type { OpenDialogOptions } from "@tauri-apps/plugin-dialog"
import type { FileNode } from "@/types/workspace"
import type { FsRoot, WorkspaceFs } from "./types"
import { invoke } from "@tauri-apps/api/core"
import { open } from "@tauri-apps/plugin-dialog"
import { readDir, readTextFile, writeTextFile } from "@tauri-apps/plugin-fs"
import { joinPath, toSegments } from "@/lib/paths"
import {
  MAX_DEPTH,
  fileNode,
  folderNode,
  isBrowsableDir,
  isNoteFile,
  sortNodes,
} from "./policy"

/**
 * 桌面端实现：Tauri fs 插件 + 原生目录选择器。对应 ADR-0001。
 *
 * 两条通道的分工：
 * - **选目录**走自定义命令 `set_workspace_root`（Rust 侧）。选完必须让 fs 插件把该目录
 *   纳入运行时 scope，否则后面每次 readDir 都会被拒。授权与持久化都在那一步完成，
 *   前端只拿到一个已授权的路径。
 * - **读写**走 fs 插件的 JS API，路径一律拼成绝对路径 —— 插件按绝对路径做 scope 匹配。
 */

/**
 * 对话框选项写死成带字面量类型的常量，而不是内联进 `open()`。
 *
 * `open<T extends OpenDialogOptions>` 的返回类型是按 `T['directory']` / `T['multiple']`
 * 的条件类型算出来的；内联传对象字面量时 TS 会把这两个属性放宽成 `boolean`，
 * 条件类型随即退化成 `string[] | string | null`。标注成字面量类型才能收窄到 `string | null`，
 * 且不需要类型断言。
 */
const DIRECTORY_DIALOG: OpenDialogOptions & { directory: true; multiple: false } = {
  directory: true,
  multiple: false,
  title: "选择笔记目录",
}

/**
 * 系统分隔符从根路径本身推。
 *
 * 不用 `@tauri-apps/api/path` 的 `join`：那是异步的，一次扫描要拼上百条路径，
 * 每条一次 IPC 往返不值当。根路径的写法就决定了它下面所有路径的写法。
 */
function separatorOf(path: string): string {
  return path.includes("\\") ? "\\" : "/"
}

function joinNative(dir: string, name: string): string {
  const separator = separatorOf(dir)
  return dir.endsWith(separator) ? `${dir}${name}` : `${dir}${separator}${name}`
}

/** 工作区路径 → 磁盘绝对路径。段拼接只在这里做，别处不许手拼分隔符。 */
function absoluteOf(root: FsRoot, path: string): string {
  if (root.kind !== "path") throw new Error("桌面端实现收到了非路径形态的根目录")
  let absolute = root.path
  for (const segment of toSegments(path)) absolute = joinNative(absolute, segment)
  return absolute
}

/**
 * 递归扫一层。
 *
 * `isSymlink` 的条目直接跳过：指向文件的软链读出来内容会是目标内容，但序列化回写会
 * 把软链变成实体文件；指向目录的更会跟 `MAX_DEPTH` 配合出难以预期的树。
 */
async function walk(dir: string, parentPath: string, depth: number): Promise<FileNode[]> {
  const entries = await readDir(dir)
  const nodes: FileNode[] = []

  for (const entry of entries) {
    if (entry.isSymlink) continue
    if (entry.isDirectory) {
      if (depth >= MAX_DEPTH || !isBrowsableDir(entry.name)) continue
      const childPath = joinPath(parentPath, entry.name)
      nodes.push(folderNode(parentPath, entry.name, await walk(joinNative(dir, entry.name), childPath, depth + 1)))
      continue
    }
    if (entry.isFile && isNoteFile(entry.name)) nodes.push(fileNode(parentPath, entry.name))
  }

  return sortNodes(nodes)
}

export function createTauriFs(): WorkspaceFs {
  return {
    kind: "tauri",
    canRestore: true,
    hint: "桌面端 · 重启后自动回到这个目录",

    async pickRoot() {
      const selected = await open(DIRECTORY_DIALOG)
      if (selected === null) return null
      // 授权 + 持久化都在 Rust 侧完成；返回的是实际落地的路径。
      const path = await invoke<string>("set_workspace_root", { path: selected })
      return { kind: "path", path }
    },

    async restoreRoot() {
      const path = await invoke<string | null>("restore_workspace_root")
      return path === null ? null : { kind: "path", path }
    },

    rootName(root) {
      if (root.kind !== "path") return ""
      const parts = root.path.split(/[/\\]/).filter((part) => part !== "")
      return parts[parts.length - 1] ?? root.path
    },

    async scanTree(root) {
      if (root.kind !== "path") throw new Error("桌面端实现收到了非路径形态的根目录")
      return walk(root.path, "", 0)
    },

    async readNote(root, path) {
      return readTextFile(absoluteOf(root, path))
    },

    async writeNote(root, path, html) {
      await writeTextFile(absoluteOf(root, path), html)
    },
  }
}

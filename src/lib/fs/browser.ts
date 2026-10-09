import type { FileNode } from "@/types/workspace"
import type { FsRoot, WorkspaceFs } from "./types"
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
 * 浏览器端实现：File System Access API。
 *
 * 为什么需要这条通道：同一份 dist 产物也要能在浏览器里直接打开（解析调试、无头截图、
 * 交互验证全靠它）。退化成 mock 会让「验证过的」和「发出去的」变成两套东西，
 * 而浏览器本来就有一套真实的目录读写能力，没有理由不用。
 *
 * 与桌面端的差异只有一处是结构性的：**句柄无法跨会话恢复**。`canRestore` 因此为 false，
 * UI 会明说「每次打开都要重选」。存进 IndexedDB 也只能省下「选哪个目录」，
 * 省不掉「重新授权」那一次用户手势 —— 既然如此就不做，避免留下一个半可用的恢复路径。
 *
 * 注意 `showDirectoryPicker` 要求安全上下文：http://localhost 算安全，直接开 dist/ 的
 * file:// 不算（届时 `window.showDirectoryPicker` undefined，`pickRoot` 会如实报错）。
 */

/** 固定 id：浏览器据此记住上次选的目录，第二次打开直接落到那儿。 */
const PICKER_ID = "webnote-notes"

function rootOf(root: FsRoot): FileSystemDirectoryHandle {
  if (root.kind !== "handle") throw new Error("浏览器端实现收到了非句柄形态的根目录")
  return root.handle
}

/** 取消选择时浏览器抛 `AbortError` —— 那是正常路径，不是故障。 */
function isAbort(error: unknown): boolean {
  return error instanceof DOMException && error.name === "AbortError"
}

/** 按段逐级下沉到目录。中途任一段已不是目录就会抛，交给调用方报错。 */
async function descend(
  root: FileSystemDirectoryHandle,
  segments: readonly string[],
): Promise<FileSystemDirectoryHandle> {
  let dir = root
  for (const segment of segments) dir = await dir.getDirectoryHandle(segment)
  return dir
}

/** 取文件句柄。`create` 为真时文件不存在就建（写盘路径需要）。 */
async function fileHandleAt(
  root: FileSystemDirectoryHandle,
  path: string,
  create: boolean,
): Promise<FileSystemFileHandle> {
  const segments = toSegments(path)
  const name = segments[segments.length - 1]
  if (name === undefined) throw new Error(`工作区路径里没有文件名：${path}`)
  const parent = await descend(root, segments.slice(0, -1))
  return parent.getFileHandle(name, { create })
}

async function walk(
  dir: FileSystemDirectoryHandle,
  parentPath: string,
  depth: number,
): Promise<FileNode[]> {
  const nodes: FileNode[] = []
  for await (const [name, handle] of dir.entries()) {
    if (handle.kind === "directory") {
      if (depth >= MAX_DEPTH || !isBrowsableDir(name)) continue
      const childPath = joinPath(parentPath, name)
      nodes.push(folderNode(parentPath, name, await walk(handle, childPath, depth + 1)))
      continue
    }
    if (isNoteFile(name)) nodes.push(fileNode(parentPath, name))
  }
  return sortNodes(nodes)
}

export function createBrowserFs(): WorkspaceFs {
  return {
    kind: "browser",
    canRestore: false,
    hint: "浏览器端 · 每次打开都需要重新选择目录",

    async pickRoot() {
      try {
        // mode: "readwrite" 让选择动作本身就带上写权限，省掉一次额外的 requestPermission。
        const handle = await window.showDirectoryPicker({ id: PICKER_ID, mode: "readwrite" })
        return { kind: "handle", handle }
      } catch (error) {
        if (isAbort(error)) return null
        throw error
      }
    },

    /** 浏览器端没有可恢复的根：句柄是活对象，跨会话必须重新授权。 */
    async restoreRoot() {
      return null
    },

    rootName(root) {
      return rootOf(root).name
    },

    async scanTree(root) {
      return walk(rootOf(root), "", 0)
    },

    async readNote(root, path) {
      const handle = await fileHandleAt(rootOf(root), path, false)
      const file = await handle.getFile()
      return file.text()
    },

    async writeNote(root, path, html) {
      const handle = await fileHandleAt(rootOf(root), path, true)
      const stream = await handle.createWritable()
      try {
        await stream.write(html)
        await stream.close()
      } catch (error) {
        // 半途失败必须 abort 而不是 close：close 会把已写入的部分提交成一个残缺文件。
        await stream.abort()
        throw error
      }
    },
  }
}

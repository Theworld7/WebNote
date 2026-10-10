import type { FileNode } from "@/types/workspace"
import type { FsRoot, WorkspaceFs } from "./types"
import { joinPath, toSegments } from "@/lib/paths"
import {
  MAX_DEPTH,
  fileNode,
  folderNode,
  isBrowsableDir,
  isNoteFile,
  isTableFile,
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

/** 逐级建目录。`getDirectoryHandle(create: true)` 只建最后一级，中间层要自己下沉。 */
async function ensureDir(root: FileSystemDirectoryHandle, segments: readonly string[]): Promise<void> {
  let dir = root
  for (const segment of segments) dir = await dir.getDirectoryHandle(segment, { create: true })
}

/** 取某个路径的父目录句柄，顺带把最后一段名字摘出来。 */
async function parentOf(
  root: FileSystemDirectoryHandle,
  path: string,
): Promise<{ parent: FileSystemDirectoryHandle; name: string }> {
  const segments = toSegments(path)
  const name = segments[segments.length - 1]
  if (name === undefined) throw new Error(`工作区路径里没有名字：${path}`)
  return { parent: await descend(root, segments.slice(0, -1)), name }
}

/**
 * 读文件内容。`move` 靠它把源搬到目标 —— 浏览器端没有原生移动（见 ADR-0004）。
 */
async function readFileAt(root: FileSystemDirectoryHandle, path: string): Promise<string> {
  const handle = await fileHandleAt(root, path, false)
  return (await handle.getFile()).text()
}

/** 写文件（覆盖或新建），半途失败 abort 而不是 close。 */
async function writeFileAt(
  root: FileSystemDirectoryHandle,
  path: string,
  text: string,
): Promise<void> {
  const handle = await fileHandleAt(root, path, true)
  const stream = await handle.createWritable()
  try {
    await stream.write(text)
    await stream.close()
  } catch (error) {
    await stream.abort()
    throw error
  }
}

/**
 * 删掉一个文件或**空**目录。
 *
 * 只给 `move` 内部用，不暴露到 `WorkspaceFs` 上 —— 独立的删除动作另有一堆问题
 * （开着的标签、未保存的编辑、确认框），等它自己被要求时再决定（见 ADR-0004）。
 */
async function removeAt(root: FileSystemDirectoryHandle, path: string): Promise<void> {
  const { parent, name } = await parentOf(root, path)
  try {
    await parent.removeEntry(name)
    return
  } catch {
    // 目录句柄要显式 `recursive`，文件句柄则已经在上面删掉了。
  }
  await parent.removeEntry(name, { recursive: true })
}

/** 看一个路径在不在。文件与目录都算；任一层不是目录就直接「不存在」。 */
async function existsAt(root: FileSystemDirectoryHandle, path: string): Promise<boolean> {
  const segments = toSegments(path)
  if (segments.length === 0) return true
  const name = segments[segments.length - 1]
  if (name === undefined) return false
  try {
    const parent = await descend(root, segments.slice(0, -1))
    await parent.getFileHandle(name)
    return true
  } catch {
    // 不是文件，再试目录 —— 两种都不中才算不存在。
  }
  try {
    const parent = await descend(root, segments.slice(0, -1))
    await parent.getDirectoryHandle(name)
    return true
  } catch {
    return false
  }
}

/** 扫一层。与 `walk` 的区别是子目录只占位、不递归（见 ADR-0001）。 */
async function scanOne(
  dir: FileSystemDirectoryHandle,
  parentPath: string,
): Promise<FileNode[]> {
  const nodes: FileNode[] = []
  for await (const [name, handle] of dir.entries()) {
    if (handle.kind === "directory") {
      if (!isBrowsableDir(name)) continue
      nodes.push(folderNode(parentPath, name, []))
      continue
    }
    if (isNoteFile(name) || isTableFile(name)) nodes.push(fileNode(parentPath, name))
  }
  return sortNodes(nodes)
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
    if (isNoteFile(name) || isTableFile(name)) nodes.push(fileNode(parentPath, name))
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

    async scanDir(root, path) {
      const dir = path === "" ? rootOf(root) : await descend(rootOf(root), toSegments(path))
      return scanOne(dir, path)
    },

    async exists(root, path) {
      return existsAt(rootOf(root), path)
    },

    async readNote(root, path) {
      return readFileAt(rootOf(root), path)
    },

    async writeNote(root, path, html) {
      await writeFileAt(rootOf(root), path, html)
    },

    async createNote(root, path, html) {
      const directory = rootOf(root)
      if (await existsAt(directory, path)) throw new Error(`已存在同名文件：${path}`)
      await writeFileAt(directory, path, html)
    },

    async createFolder(root, path) {
      // 逐级建：新建子文件夹时父级必然已在，但 `ensureDir` 顺便把「在深层目录里
      // 新建」这条路径也走通了，不必让调用方保证父级存在。
      await ensureDir(rootOf(root), toSegments(path))
    },

    /**
     * 读 → 在目标写 → 删源。见 ADR-0004。
     *
     * 删源放在最后，所以中途失败只会留下**两份**，不会只剩零份 —— 失败模式是重复而非丢失。
     * 目标父级由 `writeFileAt` 自己保证（它 `create: true` 取句柄，但中间层要 `ensureDir`）。
     */
    async move(root, from, to) {
      const directory = rootOf(root)
      if (await existsAt(directory, to)) throw new Error(`已存在同名文件：${to}`)
      const { parent } = await parentOf(directory, to)
      if (parent !== directory) await ensureDir(directory, toSegments(to).slice(0, -1))
      await writeFileAt(directory, to, await readFileAt(directory, from))
      await removeAt(directory, from)
    },
  }
}

import type { FileNode } from "@/types/workspace"
import type { FsRoot, RestoreOffer, WorkspaceFs } from "./types"
import { joinPath, toSegments } from "@/lib/paths"
import {
  MAX_DEPTH,
  fileNode,
  folderNode,
  isBrowsableDir,
  isBrowsableFile,
  sortNodes,
} from "./policy"

/**
 * 浏览器端实现：File System Access API。
 *
 * 为什么需要这条通道：同一份 dist 产物也要能在浏览器里直接打开（解析调试、无头截图、
 * 交互验证全靠它）。退化成 mock 会让「验证过的」和「发出去的」变成两套东西，
 * 而浏览器本来就有一套真实的目录读写能力，没有理由不用。
 *
 * 与桌面端的差异：句柄是活对象，跨会话只能存进 IndexedDB（localStorage 只收字符串）。
 * 权限仍是 `granted` 时启动就能无感恢复；浏览器重启或站点数据被清后权限掉回 `prompt`，
 * 而 `requestPermission` 必须在用户手势内调用 —— 于是留给空状态一个「恢复上次工作区」
 * 的入口，由点击那一下补上授权（见 `pendingRestore`）。
 *
 * 注意 `showDirectoryPicker` 要求安全上下文：http://localhost 算安全，直接开 dist/ 的
 * file:// 不算（届时 `window.showDirectoryPicker` undefined，`pickRoot` 会如实报错）。
 */

/** 固定 id：浏览器据此记住上次选的目录，第二次打开直接落到那儿。 */
const PICKER_ID = "webnote-notes"

/**
 * 上次工作区句柄的存放处。
 *
 * 只留最近一个 —— 多工作区列表会多出一层「选哪个」的成本，而这里要解决的只是
 * 「下次别再让我重选」。
 */
const DB_NAME = "webnote"
const DB_STORE = "workspace"
const ROOT_KEY = "last-root"

/** 上一次恢复时发现已失效的目录名。`pendingRestore` 取走它，只提示一次。 */
let lostRootName: string | null = null

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1)
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(DB_STORE)) {
        request.result.createObjectStore(DB_STORE)
      }
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
}

/** 结构化克隆取回来的是 `unknown`；`kind === "directory"` 才当成目录句柄用。 */
function isDirectoryHandle(value: unknown): value is FileSystemDirectoryHandle {
  return typeof value === "object" && value !== null && "kind" in value && value.kind === "directory"
}

async function readStoredRoot(): Promise<FileSystemDirectoryHandle | null> {
  const db = await openDb()
  try {
    return await new Promise((resolve, reject) => {
      const request = db.transaction(DB_STORE, "readonly").objectStore(DB_STORE).get(ROOT_KEY)
      request.onsuccess = () => {
        const value: unknown = request.result
        resolve(isDirectoryHandle(value) ? value : null)
      }
      request.onerror = () => reject(request.error)
    })
  } finally {
    db.close()
  }
}

async function storeRoot(handle: FileSystemDirectoryHandle): Promise<void> {
  const db = await openDb()
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(DB_STORE, "readwrite")
      tx.objectStore(DB_STORE).put(handle, ROOT_KEY)
      tx.oncomplete = () => resolve()
      tx.onerror = () => reject(tx.error)
      tx.onabort = () => reject(tx.error)
    })
  } finally {
    db.close()
  }
}

async function forgetRoot(): Promise<void> {
  const db = await openDb()
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(DB_STORE, "readwrite")
      tx.objectStore(DB_STORE).delete(ROOT_KEY)
      tx.oncomplete = () => resolve()
      tx.onerror = () => reject(tx.error)
      tx.onabort = () => reject(tx.error)
    })
  } finally {
    db.close()
  }
}

/** 目录被删 / 被移动后读它抛 `NotFoundError`；权限被收回时抛 `NotAllowedError`。 */
function isLostRoot(error: unknown): boolean {
  return (
    error instanceof DOMException &&
    (error.name === "NotFoundError" || error.name === "NotAllowedError")
  )
}

/**
 * TS 的 DOM 类型里还没有 File System Access 的权限方法，浏览器原型上却确实有。
 * 用类型守卫把它们补回类型层面 —— 项目不写类型断言。
 */
interface PermissionedHandle extends FileSystemDirectoryHandle {
  queryPermission(options?: { mode: "read" | "readwrite" }): Promise<PermissionState>
  requestPermission(options?: { mode: "read" | "readwrite" }): Promise<PermissionState>
}

function hasPermissionApi(handle: FileSystemDirectoryHandle): handle is PermissionedHandle {
  return "queryPermission" in handle && "requestPermission" in handle
}

/**
 * 句柄还在不在。
 *
 * `queryPermission` 只回答「授权过没有」—— 目录被删了它照样说 `granted`，直到真去读
 * 才抛。读第一项是这里最省的一次试探，空目录也能正常走完。
 */
async function isReachable(handle: FileSystemDirectoryHandle): Promise<boolean> {
  try {
    await handle.entries().next()
    return true
  } catch (error) {
    if (isLostRoot(error)) return false
    throw error
  }
}

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
 * 删掉一个文件或目录（目录递归删除）。
 *
 * `move` 与 `rename` 的收尾都靠它，`WorkspaceFs.remove` 也直接落在它上面。
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

/** 目录判定：能按段下沉到它，它就是目录。文件与不存在的路径都会抛。 */
async function isDirectoryAt(root: FileSystemDirectoryHandle, path: string): Promise<boolean> {
  try {
    await descend(root, toSegments(path))
    return true
  } catch {
    return false
  }
}

/**
 * 把一个目录的全部内容复制进另一个**已存在**的目录。
 *
 * 只给目录改名用：File System Access API 没有原生改名（见 ADR-0004），文件可以读→写→删，
 * 目录只能整棵子树搬。失败模式与 `move` 同一个选择 —— 先复制后删源，中途失败留下两份，
 * 不会只剩零份。
 */
async function copyTree(
  source: FileSystemDirectoryHandle,
  target: FileSystemDirectoryHandle,
): Promise<void> {
  for await (const [name, handle] of source.entries()) {
    if (handle.kind === "file") {
      const file = await handle.getFile()
      const stream = await (await target.getFileHandle(name, { create: true })).createWritable()
      try {
        await stream.write(file)
        await stream.close()
      } catch (error) {
        await stream.abort()
        throw error
      }
      continue
    }
    await copyTree(handle, await target.getDirectoryHandle(name, { create: true }))
  }
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
    if (isBrowsableFile(name)) nodes.push(fileNode(parentPath, name))
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
    if (isBrowsableFile(name)) nodes.push(fileNode(parentPath, name))
  }
  return sortNodes(nodes)
}

export function createBrowserFs(): WorkspaceFs {
  return {
    kind: "browser",
    canRestore: true,
    hint: "浏览器端 · 自动回到上次的目录，必要时再授权一次",

    async pickRoot() {
      try {
        // mode: "readwrite" 让选择动作本身就带上写权限，省掉一次额外的 requestPermission。
        const handle = await window.showDirectoryPicker({ id: PICKER_ID, mode: "readwrite" })
        try {
          await storeRoot(handle)
        } catch {
          // 存不进去只影响「下次自动恢复」，不该挡住这次打开目录。
        }
        return { kind: "handle", handle }
      } catch (error) {
        if (isAbort(error)) return null
        throw error
      }
    },

    /**
     * 权限仍是 `granted` 就能无感恢复；否则留给 `pendingRestore` 交给用户手势。
     *
     * 目录被删 / 移走要在这里就查出来并清掉记录 —— 否则会先把一个死句柄当工作区
     * 接上，随后扫树失败，停在「有根但空」的半截状态。
     */
    async restoreRoot() {
      let handle: FileSystemDirectoryHandle | null
      try {
        handle = await readStoredRoot()
      } catch {
        // 读 IndexedDB 失败等同于「没存过」：恢复是锦上添花，不该拦住启动。
        return null
      }
      if (handle === null) return null
      if (!hasPermissionApi(handle)) return null
      if ((await handle.queryPermission({ mode: "readwrite" })) !== "granted") return null
      if (!(await isReachable(handle))) {
        await forgetRoot()
        lostRootName = handle.name
        return null
      }
      return { kind: "handle", handle }
    },

    /** 权限掉回 `prompt` 时给出「一键恢复」所需的一切；`denied` 不再给入口。 */
    async pendingRestore(): Promise<RestoreOffer | null> {
      if (lostRootName !== null) {
        const name = lostRootName
        lostRootName = null
        return { kind: "invalid", name }
      }
      let handle: FileSystemDirectoryHandle | null
      try {
        handle = await readStoredRoot()
      } catch {
        return null
      }
      if (handle === null) return null
      if (!hasPermissionApi(handle)) return null
      if ((await handle.queryPermission({ mode: "readwrite" })) !== "prompt") return null
      const stored = handle
      return {
        kind: "grant",
        name: stored.name,
        grant: async () => {
          // 这一下必须由点击手势触发：启动阶段静默调用会被浏览器直接拒绝。
          if ((await stored.requestPermission({ mode: "readwrite" })) !== "granted") return null
          if (!(await isReachable(stored))) {
            await forgetRoot()
            lostRootName = stored.name
            return null
          }
          return { kind: "handle", handle: stored }
        },
      }
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

    async readBinary(root, path) {
      const handle = await fileHandleAt(rootOf(root), path, false)
      return new Uint8Array(await (await handle.getFile()).arrayBuffer())
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

    /**
     * 改名与 `move` 同构：文件走读→写→删；目录没有原生改名，先整棵复制再删源。
     * 删源放在最后 —— 失败模式是重复而非丢失，与 `move` 同一条底线。
     */
    async rename(root, from, to) {
      const directory = rootOf(root)
      if (await existsAt(directory, to)) throw new Error(`已存在同名文件：${to}`)
      if (await isDirectoryAt(directory, from)) {
        const source = await descend(directory, toSegments(from))
        await ensureDir(directory, toSegments(to))
        await copyTree(source, await descend(directory, toSegments(to)))
      } else {
        await writeFileAt(directory, to, await readFileAt(directory, from))
      }
      await removeAt(directory, from)
    },

    async remove(root, path) {
      await removeAt(rootOf(root), path)
    },

    /** 句柄背后没有磁盘路径，「复制路径」类入口按 `null` 隐藏。 */
    absolutePath() {
      return null
    },

    /** 没有「系统文件管理器」可去，如实报告做不到。 */
    async revealInFileManager() {
      return false
    },

    /** 浏览器端没有磁盘路径可转 `file://`，如实报告做不到。 */
    async openInBrowser() {
      return false
    },
  }
}

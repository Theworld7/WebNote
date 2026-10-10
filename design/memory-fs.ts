/**
 * 内存版 `WorkspaceFs`，给 `design/create-check.html` 与 `design/move-check.html` 共用。
 *
 * 存在的理由：浏览器端 `pickRoot()` 依赖用户手势与真实目录选择器，探针里拿不到目录句柄；
 * 而创建逻辑要验证的是「先写盘 → 再单层重扫 → 替换树里那一层」这套编排，与 driver 无关。
 * 这个 stub 把磁盘换成一张 `Map<路径, 内容>`（文件）与一个 `Set<路径>`（目录），
 * 行为按 `WorkspaceFs` 的契约实现 —— 冲突要抛、缺文件要抛，不替被测代码兜底。
 */
import type { FileNode } from "@/types/workspace"
import type { FsRoot, WorkspaceFs } from "@/lib/fs/types"
import { joinPath, toSegments } from "@/lib/paths"
import { fileNode, folderNode, sortNodes } from "@/lib/fs/policy"

interface Disk {
  files: Map<string, string>
  dirs: Set<string>
  ensureDir(path: string): void
  directChildren(path: string): string[]
}

/** 磁盘替身。目录表显式维护（真实文件系统的目录是独立实体，空目录也存在）。 */
function createDisk(): Disk {
  const files = new Map<string, string>()
  const dirs = new Set<string>([""])

  function ensureDir(path: string): void {
    const segments = toSegments(path)
    for (let i = 1; i <= segments.length; i += 1) dirs.add(segments.slice(0, i).join(" / "))
  }

  /** 直接子项，编码成 `d:名字` / `f:名字` 以便一次遍历里区分两类。 */
  function directChildren(path: string): string[] {
    const prefix = path === "" ? "" : `${path} / `
    const names: string[] = []
    for (const dir of dirs) {
      if (dir === path || !dir.startsWith(prefix)) continue
      const rest = dir.slice(prefix.length)
      if (rest !== "" && !rest.includes(" / ")) names.push(`d:${rest}`)
    }
    for (const file of files.keys()) {
      if (!file.startsWith(prefix)) continue
      const rest = file.slice(prefix.length)
      if (rest !== "" && !rest.includes(" / ")) names.push(`f:${rest}`)
    }
    return names
  }

  return { files, dirs, ensureDir, directChildren }
}

/**
 * 工作区路径的段分隔符，与 `lib/paths` 同源。
 *
 * 逐个字符校验而不是 `includes("/")`：段名里本来就不可能有 `/`（`checkName` 挡掉了），
 * 所以「出现 `/` 但两侧没有空格」必然是把 `日记/第二天.html` 这种**磁盘式写法**误当成了
 * 工作区路径 —— 那种写法会被 `toSegments` 整条当成一个段名，静默建出一个名叫
 * `日记/第二天.html` 的单层文件。探针里这个错误极难发现，所以这里直接抛。
 */
function assertWorkspacePath(path: string): void {
  for (let i = 0; i < path.length; i += 1) {
    if (path[i] !== "/") continue
    const before = path[i - 1]
    const after = path[i + 1]
    const ok = before === " " && after === " "
    if (!ok) {
      throw new Error(
        `不是工作区路径（段分隔符必须是「空格斜杠空格」）：${JSON.stringify(path)}——` +
          `写成了磁盘式路径？正确写法形如 "日记 / 第二天.html"`,
      )
    }
  }
}

export interface MemoryFs {
  fs: WorkspaceFs
  /** 播种一个已存在的笔记。 */
  seedFile(path: string, html: string): void
  /** 播种一个已存在的空目录。 */
  seedDir(path: string): void
  /** 读回 stub 里的文件内容，用来断言新建的笔记真的写成了空 Note。 */
  read(path: string): string | undefined
}

export function createMemoryFs(): MemoryFs {
  const disk = createDisk()

  function scan(parentPath: string, recursive: boolean): FileNode[] {
    const nodes: FileNode[] = []
    for (const entry of disk.directChildren(parentPath)) {
      const kind = entry.slice(0, 1)
      const name = entry.slice(2)
      if (kind === "d") {
        const childPath = joinPath(parentPath, name)
        nodes.push(folderNode(parentPath, name, recursive ? scan(childPath, true) : []))
        continue
      }
      nodes.push(fileNode(parentPath, name))
    }
    return sortNodes(nodes)
  }

  const fs: WorkspaceFs = {
    kind: "browser",
    canRestore: false,
    hint: "内存 stub · 仅自检页使用",

    async pickRoot(): Promise<FsRoot | null> {
      return null
    },

    async restoreRoot(): Promise<FsRoot | null> {
      return null
    },

    rootName(): string {
      return "stub"
    },

    async scanTree(): Promise<FileNode[]> {
      return scan("", true)
    },

    async scanDir(_root: FsRoot, path: string): Promise<FileNode[]> {
      return scan(path, false)
    },

    async exists(_root: FsRoot, path: string): Promise<boolean> {
      return disk.files.has(path) || disk.dirs.has(path)
    },

    async readNote(_root: FsRoot, path: string): Promise<string> {
      const html = disk.files.get(path)
      if (html === undefined) throw new Error(`没有这个文件：${path}`)
      return html
    },

    async writeNote(_root: FsRoot, path: string, html: string): Promise<void> {
      disk.ensureDir(toSegments(path).slice(0, -1).join(" / "))
      disk.files.set(path, html)
    },

    async createNote(_root: FsRoot, path: string, html: string): Promise<void> {
      if (await fs.exists({ kind: "path", path: "/stub" }, path)) throw new Error(`已存在：${path}`)
      disk.files.set(path, html)
    },

    async createFolder(_root: FsRoot, path: string): Promise<void> {
      if (disk.files.has(path)) throw new Error(`已存在同名文件：${path}`)
      disk.ensureDir(path)
    },

    /**
     * 移动：先查冲突，再「建目标父目录 → 搬内容 → 清源」。
     *
     * 目录要连整棵子树一起搬 —— 只改一个键的话，子文件还挂在旧前缀下，
     * 下一次 `scanDir` 就会凭空多出一份。文件系统里 `rename` 语义就是整体搬，
     * stub 必须跟上，不然探针会漏掉「移动目录」这一类。
     */
    async move(_root: FsRoot, from: string, to: string): Promise<void> {
      assertWorkspacePath(from)
      assertWorkspacePath(to)
      if (from === to) return
      if (await fs.exists({ kind: "path", path: "/stub" }, to)) throw new Error(`已存在同名文件：${to}`)
      const movingDir = disk.dirs.has(from) && !disk.files.has(from)
      if (!movingDir && !disk.files.has(from)) throw new Error(`没有这个文件：${from}`)

      const nextParent = toSegments(to).slice(0, -1).join(" / ")
      if (nextParent !== "") disk.ensureDir(nextParent)

      if (movingDir) {
        const prefix = `${from} / `
        for (const dir of [...disk.dirs]) {
          if (dir === from || dir.startsWith(prefix)) {
            disk.dirs.delete(dir)
            disk.dirs.add(to + dir.slice(from.length))
          }
        }
        for (const [file, html] of [...disk.files]) {
          if (file === from || file.startsWith(prefix)) {
            disk.files.delete(file)
            disk.files.set(to + file.slice(from.length), html)
          }
        }
        return
      }

      const html = disk.files.get(from) as string
      disk.files.delete(from)
      disk.files.set(to, html)
    },
  }

  return {
    fs,
    seedFile(path, html) {
      assertWorkspacePath(path)
      disk.ensureDir(toSegments(path).slice(0, -1).join(" / "))
      disk.files.set(path, html)
    },
    seedDir(path) {
      assertWorkspacePath(path)
      disk.ensureDir(path)
    },
    read: (path) => disk.files.get(path),
  }
}

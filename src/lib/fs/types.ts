import type { FileNode } from "@/types/workspace"

/**
 * 工作区文件系统的抽象。
 *
 * 两个运行时拿到的「根」是不同的东西 —— Tauri 是磁盘绝对路径，浏览器是
 * `FileSystemDirectoryHandle` —— 但上层（`useWorkspace` 及其所有组件）不该知道区别。
 * 于是把根包成不透明句柄 `FsRoot`，由各自的实现去解释，上层只依赖 `WorkspaceFs`。
 */

/**
 * 工作区根句柄。可辨识联合，`kind` 是判别式。
 *
 * 之所以不统一成「一段标识字符串」：浏览器句柄是活对象，序列化不了；
 * 而 Tauri 侧真有个路径字符串。硬统一只会逼出一处类型断言。
 */
export type FsRoot =
  | { kind: "path"; path: string }
  | { kind: "handle"; handle: FileSystemDirectoryHandle }

export type FsKind = "tauri" | "browser"

/** 读写一个笔记库所需的全部能力。两份实现必须给出**逐字节相同**的树与路径键。 */
export interface WorkspaceFs {
  readonly kind: FsKind
  /**
   * 能否在重启后自动回到上次的目录。
   *
   * 这是两端唯一实质性的能力差异：Tauri 把路径存进 app config 就能恢复；浏览器端
   * 句柄无法跨会话复用（即便存进 IndexedDB 也仍需用户手势重新授权）。UI 据此决定
   * 要不要提示「每次都要重选」。
   */
  readonly canRestore: boolean
  /** 前端展示用的平台说明。 */
  readonly hint: string
  /** 让用户选一个目录当工作区。用户取消返回 `null`。 */
  pickRoot(): Promise<FsRoot | null>
  /** 取回上次的工作区。没有或已失效返回 `null`。 */
  restoreRoot(): Promise<FsRoot | null>
  /** 根的显示名（目录名本身，不是全路径）。 */
  rootName(root: FsRoot): string
  /** 扫描整棵树。隐藏目录与依赖目录由实现按 `policy` 过滤掉。 */
  scanTree(root: FsRoot): Promise<FileNode[]>
  /** 根下的路径是否存在。用于创建前的前置检查（见 ADR-0002）。 */
  exists(root: FsRoot, path: string): Promise<boolean>
  /** 扫描单个目录一层，返回它直接子项的节点（路径以 `parent` 为前缀）。 */
  scanDir(root: FsRoot, path: string): Promise<FileNode[]>
  /** 按工作区路径读一篇笔记的 HTML 原文。 */
  readNote(root: FsRoot, path: string): Promise<string>
  /** 把 HTML 写回工作区路径。已有的覆盖，浏览器端不存在的会被创建。 */
  writeNote(root: FsRoot, path: string, html: string): Promise<void>
  /**
   * 新建一个笔记文件。已存在时必须抛错而不是覆盖 —— 冲突由调用方前置拦截
   * （`exists`），这一层只是不让「写」被误当成「建」。
   */
  createNote(root: FsRoot, path: string, html: string): Promise<void>
  /** 新建一个目录。逐级建，中间层不存在也会被建出来。 */
  createFolder(root: FsRoot, path: string): Promise<void>
  /**
   * 把一个文件或目录从 `from` 移到 `to`。
   *
   * 只表达「换个父级」，不表达同级顺序 —— 磁盘目录没有顺序（见 ADR-0003）。
   * 目标已存在时必须抛错：冲突由调用方前置拦截（`exists`），与 `createNote` 同理。
   */
  move(root: FsRoot, from: string, to: string): Promise<void>
}

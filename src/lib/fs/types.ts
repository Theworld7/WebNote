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
 * 而 Tauri 侧真有个路径字符串，WebDAV 侧真有个 URL。硬统一只会逼出一处类型断言。
 *
 * `webdav` 只带远端目录的 URL —— 账号密码留在驱动闭包里，句柄本身不背凭据。
 * 这个 URL 同时是会话快照的键（`sessionKeyOf`），换服务器就是换语境。
 */
export type FsRoot =
  | { kind: "path"; path: string }
  | { kind: "handle"; handle: FileSystemDirectoryHandle }
  | { kind: "webdav"; url: string }

export type FsKind = "tauri" | "browser" | "webdav"

/**
 * 浏览器端「已记住、但还差一次用户手势」的工作区。
 *
 * 恢复被拆成两步，是因为 `requestPermission` 只能在用户手势内调用：启动时只能问出
 * 「要不要问」，真正的授权必须等空状态里那颗按钮被点下。`invalid` 表示记住的目录
 * 已被删除或移走 —— 实现那边已清掉记录，调用方给一句简短提示即可。
 */
export type RestoreOffer =
  | { readonly kind: "grant"; readonly name: string; grant(): Promise<FsRoot | null> }
  | { readonly kind: "invalid"; readonly name: string }

/** 读写一个笔记库所需的全部能力。两份实现必须给出**逐字节相同**的树与路径键。 */
export interface WorkspaceFs {
  readonly kind: FsKind
  /**
   * 能否自动回到上次的目录。
   *
   * Tauri 把路径存进 app config 就能恢复；浏览器端把句柄存进 IndexedDB，权限仍是
   * `granted` 时同样能直接恢复，只有权限掉回 `prompt` 才需要再来一次用户手势
   * （见 `pendingRestore`）。UI 据此决定要不要提示「每次都要重选」。
   */
  readonly canRestore: boolean
  /** 前端展示用的平台说明。 */
  readonly hint: string
  /** 让用户选一个目录当工作区。用户取消返回 `null`。 */
  pickRoot(): Promise<FsRoot | null>
  /** 取回上次的工作区。没有、已失效或还缺授权返回 `null`。 */
  restoreRoot(): Promise<FsRoot | null>
  /**
   * 浏览器端专属：`restoreRoot()` 没能恢复时还剩什么可做。
   *
   * 桌面端没有这一步（重启即恢复），因此不实现。
   */
  pendingRestore?(): Promise<RestoreOffer | null>
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
  /**
   * 按工作区路径读一个文件的原始字节。
   *
   * 文本通道（`readNote`）会把二进制当文本解，Markdown 预览里引用的本地图片需要的是
   * 原样字节 —— 前端再把它包成 object URL 交给 `<img>`。
   */
  readBinary(root: FsRoot, path: string): Promise<Uint8Array>
  /**
   * 能直接交给 `<video>` / `<img>` 取用的地址；拿不到返回 `null`。
   *
   * 桌面端返回 asset 协议的 `http://asset.localhost/…`：WebView 自己按 range 请求分片
   * 读盘，内存占用与文件大小无关，拖进度条也只拉需要的那一段。浏览器端没有这条通道
   * （`blob:` 必须先整段读进内存），返回 `null`，调用方退回 `readBinary`。
   *
   * 与 `absolutePath` 的分工：那个是给用户看的 / 交给系统外壳的路径，这个是给
   * 页面自己去取的地址，能不能取由 scope 决定。
   */
  streamUrl(root: FsRoot, path: string): string | null
  /** 把 HTML 写回工作区路径。已有的覆盖，浏览器端不存在的会被创建。 */
  writeNote(root: FsRoot, path: string, html: string): Promise<void>
  /**
   * 把一段裸字节写进工作区路径。已有的覆盖，父目录必须已经存在（`createFolder` 先建）。
   *
   * 视频这类大文件不能像图片那样内联进笔记，只能留在盘上、块里存相对路径 ——
   * 「把选中的片子搬进工作区」就是这条原语唯一的用处。不做流式写入：
   * 调用方手里已经是一个 `File`，整个写下去比切段拼起来省事，也不会写出半个文件。
   */
  writeBinary(root: FsRoot, path: string, bytes: Uint8Array): Promise<void>
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
  /**
   * 重命名一个文件或目录：只换名字，不换父级。目标已存在时必须抛错 ——
   * 冲突由调用方前置拦截（`exists`），与 `move` / `createNote` 同理。
   */
  rename(root: FsRoot, from: string, to: string): Promise<void>
  /**
   * 删除一个文件或目录，目录连同其下全部内容递归删除。
   * 不可逆是这条原语的本性 —— 确认框属于调用方，这一层不做任何拦截。
   */
  remove(root: FsRoot, path: string): Promise<void>
  /**
   * 工作区路径 → 磁盘绝对路径。分隔符的拼法只由实现解释。
   *
   * 浏览器端返回 `null`：句柄背后没有「路径」这个概念，UI 据此决定
   * 要不要露出「复制路径」这类只对磁盘有意义的入口。
   */
  absolutePath(root: FsRoot, path: string): string | null
  /**
   * 在系统文件管理器里显示该路径（文件或目录，定位选中而非打开内容）。
   * 浏览器端没有「系统文件管理器」可言，返回 `false`；桌面端成功返回 `true`。
   */
  revealInFileManager(root: FsRoot, path: string): Promise<boolean>
  /**
   * 用系统默认浏览器打开该路径下的 HTML 文件（显式走浏览器，而不是 `.html`
   * 注册的默认应用 —— 那可能是编辑器）。浏览器端返回 `false`；桌面端成功返回 `true`。
   */
  openInBrowser(root: FsRoot, path: string): Promise<boolean>
}

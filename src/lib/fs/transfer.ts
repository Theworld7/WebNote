/**
 * 与工作区之外交换 Markdown 文件 —— 单篇或整批。
 *
 * 导出走系统保存 / 选择文件夹对话框、导入走系统打开对话框 —— 与「文件树里新建文件」
 * 不同，这里搬的是一次性的交付物，不进入 `WorkspaceFs` 的相对路径体系。桌面端用
 * Tauri 的 dialog + fs 插件（对话框选中的路径会被自动纳入 fs scope）；浏览器
 * 调试时退回 File System Access API / 下载。
 */
import { isTauriRuntime } from "./index"

export interface MarkdownFile {
  name: string
  text: string
}

const FILTERS = [{ name: "Markdown", extensions: ["md", "markdown"] }]

/**
 * 让用户选一个位置并写入 Markdown 文本。
 *
 * 返回 `false` 表示用户取消 —— 取消不是错误，调用方不该弹错误条。
 */
export async function saveMarkdownFile(
  suggestedName: string,
  defaultPath: string | null,
  text: string,
): Promise<boolean> {
  if (isTauriRuntime()) {
    const { save } = await import("@tauri-apps/plugin-dialog")
    const { writeTextFile } = await import("@tauri-apps/plugin-fs")
    const path = await save({ defaultPath: defaultPath ?? suggestedName, filters: FILTERS })
    if (path === null) return false
    await writeTextFile(path, text)
    return true
  }

  return saveInBrowser(suggestedName, text)
}

/**
 * 让用户挑若干个 Markdown 文件；空数组表示取消。
 *
 * 批量导入与单篇导入共用这一条：一次选一个和一次选十个，对磁盘来说没有区别，
 * 分成两条路径只会让取消 / 报错 / 浏览器兜底各写两遍。
 */
export async function pickMarkdownFiles(): Promise<MarkdownFile[]> {
  if (isTauriRuntime()) {
    const { open } = await import("@tauri-apps/plugin-dialog")
    const { readTextFile } = await import("@tauri-apps/plugin-fs")
    const selected = await open({ multiple: true, directory: false, filters: FILTERS })
    if (selected === null) return []
    const paths = typeof selected === "string" ? [selected] : selected
    return await Promise.all(
      paths.map(async (path) => ({ name: baseName(path), text: await readTextFile(path) })),
    )
  }

  return pickManyInBrowser()
}

/** 一次批量导出的一个文件：`relativePath` 相对用户选定的目录，只用 `/`。 */
export interface MarkdownExportFile {
  relativePath: string
  text: string
}

/**
 * 批量导出的落点。
 *
 * 两种真落点（桌面端磁盘目录 / 浏览器目录句柄）加一种兜底（逐个下载）—— 拆成
 * 「先取落点、再写内容」两步，是因为取落点必须紧贴用户点击：浏览器要求当时还有
 * 用户手势，而读一批笔记（含引用表）可能要好几秒，读完再弹选择器就会被直接拒绝。
 */
export type ExportSink =
  | { kind: "path"; directory: string }
  | { kind: "handle"; directory: FileSystemDirectoryHandle }
  | { kind: "download" }

/** 一次写入的结果。`failed` 里是没写出去的那些 `relativePath`。 */
export interface WriteResult {
  written: number
  failed: string[]
}

/**
 * 让用户挑落点。`null` 表示取消。
 *
 * **桌面端必须带 `recursive: true`**。对话框插件把选中的目录加进 fs scope，而
 * `recursive` 缺省是 `false` —— 加进去的模式是 `<目录>\*`，配合 Tauri 的
 * `require_literal_separator`（`*` 不跨分隔符），只放行这一层。批量导出要按相对
 * 路径建子目录（`导出\日记\2026-10-08.md`），于是第一层之后就 `forbidden path`。
 * 症状很有欺骗性：导出一个「笔记都在顶层」的子文件夹能成，导它的父目录必挂。
 */
export async function pickExportSink(): Promise<ExportSink | null> {
  if (isTauriRuntime()) {
    const { open } = await import("@tauri-apps/plugin-dialog")
    const directory = await open({
      directory: true,
      multiple: false,
      recursive: true,
      title: "选择导出到哪个文件夹",
    })
    return typeof directory === "string" ? { kind: "path", directory } : null
  }

  if (typeof window.showDirectoryPicker === "function") {
    try {
      const directory = await window.showDirectoryPicker({ mode: "readwrite" })
      return { kind: "handle", directory }
    } catch (error) {
      if (isAbort(error)) return null
      // 缺手势、权限被拒、浏览器不支持目录写入：退回下载，与单篇导出同一立场。
    }
  }

  return { kind: "download" }
}

/**
 * 把若干篇 Markdown 按各自的相对路径写进落点。
 *
 * **逐篇收口**：一篇写不进去（父目录被占、磁盘满、路径过长）不该让整批停在中途，
 * 也不该把「已经写出去的那几篇」一起报成失败 —— 调用方要的是「哪几篇没成」。
 */
export async function writeMarkdownTree(
  sink: ExportSink,
  files: readonly MarkdownExportFile[],
): Promise<WriteResult> {
  const result: WriteResult = { written: 0, failed: [] }
  for (const file of files) {
    try {
      await writeOne(sink, file)
      result.written += 1
    } catch {
      result.failed.push(file.relativePath)
    }
  }
  return result
}

async function writeOne(sink: ExportSink, file: MarkdownExportFile): Promise<void> {
  if (sink.kind === "path") {
    const { mkdir, writeTextFile } = await import("@tauri-apps/plugin-fs")
    const target = joinDiskPath(sink.directory, file.relativePath)
    // 只在这篇需要子目录时建：落点目录本身是用户在对话框里选的，一定在；根层那篇
    // 再调一次 mkdir 只是空转一次 IPC。`recursive` 顺带把中间层一起建出来。
    if (file.relativePath.includes("/")) await mkdir(parentOfPath(target), { recursive: true })
    await writeTextFile(target, file.text)
    return
  }

  if (sink.kind === "handle") {
    const segments = file.relativePath.split("/")
    const name = segments.pop() ?? file.relativePath
    let parent = sink.directory
    for (const segment of segments) {
      parent = await parent.getDirectoryHandle(segment, { create: true })
    }
    const handle = await parent.getFileHandle(name, { create: true })
    const writable = await handle.createWritable()
    await writable.write(file.text)
    await writable.close()
    return
  }

  // 编不出目录树，只能把层级摊平成文件名 —— 总比什么都没发生强。
  downloadText(file.relativePath.replaceAll("/", "-"), file.text)
}

async function saveInBrowser(suggestedName: string, text: string): Promise<boolean> {
  if (typeof window.showSaveFilePicker === "function") {
    try {
      const handle = await window.showSaveFilePicker({
        suggestedName,
        types: [{ description: "Markdown", accept: { "text/markdown": [".md", ".markdown"] } }],
      })
      const writable = await handle.createWritable()
      await writable.write(text)
      await writable.close()
      return true
    } catch (error) {
      if (isAbort(error)) return false
      // 浏览器拒绝弹选择器（例如缺少用户手势）时退回下载，不让导出直接失败。
    }
  }

  downloadText(suggestedName, text)
  return true
}

/** 浏览器端的批量导入：一个隐藏 input，选几个算几个；`cancel` 事件在新内核里才有。 */
function pickManyInBrowser(): Promise<MarkdownFile[]> {
  return new Promise((resolve, reject) => {
    const input = document.createElement("input")
    input.type = "file"
    input.multiple = true
    input.accept = ".md,.markdown,text/markdown"
    input.addEventListener("cancel", () => {
      input.remove()
      resolve([])
    })
    input.addEventListener("change", () => {
      const files = [...(input.files ?? [])]
      input.remove()
      Promise.all(files.map(async (file) => ({ name: file.name, text: await file.text() }))).then(
        resolve,
        reject,
      )
    })
    input.click()
  })
}

function downloadText(name: string, text: string): void {
  const url = URL.createObjectURL(new Blob([text], { type: "text/markdown;charset=utf-8" }))
  const anchor = document.createElement("a")
  anchor.href = url
  anchor.download = name
  anchor.click()
  URL.revokeObjectURL(url)
}

function isAbort(error: unknown): boolean {
  return error instanceof DOMException && error.name === "AbortError"
}

/** 对话框返回的是平台路径（Windows 反斜杠），标题只取最后一段。 */
function baseName(path: string): string {
  return path.split(/[\\/]/).pop() ?? path
}

/** 拼磁盘路径前把目录末尾的分隔符收掉，免得拼出 `C:\笔记//a.md`。 */
function trimSlash(directory: string): string {
  return directory.replace(/[\\/]+$/, "")
}

/**
 * 把相对路径接到磁盘目录后面，分隔符跟着目录走。
 *
 * 相对路径是 `/`（工作区内部口径），磁盘是平台口径 —— Windows 上拼出
 * `D:\导出/日记/a.md` 虽然写得进去，但路径会一路带着两种分隔符进日志与报错，
 * 排错时特别容易看花眼。
 */
function joinDiskPath(directory: string, relativePath: string): string {
  const base = trimSlash(directory)
  const separator = base.includes("\\") ? "\\" : "/"
  return `${base}${separator}${relativePath.split("/").join(separator)}`
}

/** 磁盘路径的父目录。分隔符两种都认 —— 对话框给的是平台路径。 */
function parentOfPath(path: string): string {
  const cut = Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\"))
  return cut <= 0 ? path : path.slice(0, cut)
}

/**
 * 与工作区之外交换单个 Markdown 文件。
 *
 * 导出走系统保存对话框、导入走系统打开对话框 —— 与「文件树里新建文件」不同，
 * 这里搬的是一次性的交付物，不进入 `WorkspaceFs` 的相对路径体系。桌面端用
 * Tauri 的 dialog + fs 插件（对话框选中的文件会被自动纳入 fs scope）；浏览器
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

/** 让用户挑一个 Markdown 文件；返回 `null` 表示取消。 */
export async function pickMarkdownFile(): Promise<MarkdownFile | null> {
  if (isTauriRuntime()) {
    const { open } = await import("@tauri-apps/plugin-dialog")
    const { readTextFile } = await import("@tauri-apps/plugin-fs")
    const selected = await open({ multiple: false, directory: false, filters: FILTERS })
    if (typeof selected !== "string") return null
    return { name: baseName(selected), text: await readTextFile(selected) }
  }

  return pickInBrowser()
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

  const url = URL.createObjectURL(new Blob([text], { type: "text/markdown;charset=utf-8" }))
  const anchor = document.createElement("a")
  anchor.href = url
  anchor.download = suggestedName
  anchor.click()
  URL.revokeObjectURL(url)
  return true
}

function pickInBrowser(): Promise<MarkdownFile | null> {
  return new Promise((resolve, reject) => {
    const input = document.createElement("input")
    input.type = "file"
    input.accept = ".md,.markdown,text/markdown"
    input.addEventListener("cancel", () => {
      input.remove()
      resolve(null)
    })
    input.addEventListener("change", () => {
      const file = input.files?.[0]
      input.remove()
      if (file === undefined) {
        resolve(null)
        return
      }
      file.text().then((text) => resolve({ name: file.name, text }), reject)
    })
    input.click()
  })
}

function isAbort(error: unknown): boolean {
  return error instanceof DOMException && error.name === "AbortError"
}

/** 对话框返回的是平台路径（Windows 反斜杠），标题只取最后一段。 */
function baseName(path: string): string {
  return path.split(/[\\/]/).pop() ?? path
}

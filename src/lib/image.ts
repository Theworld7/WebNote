/**
 * 图片文件工具。
 *
 * 只管「文件 → 能嵌进 HTML 的地址」这一步，不碰块模型。
 *
 * 本地图内联成 data URI，是为了让笔记文件**自包含**：双击就能看，拷给别人不丢图，
 * 不依赖「图片和 html 的相对位置」这个约定。代价是 base64 让文件变大三分之一左右，
 * 所以接 Tauri fs 之后要改成写 `assets/*` 相对路径 + 引用 —— 到那时只有
 * `readImageFile` 这一处需要换掉。
 */

const IMAGE_PREFIX = "image/"

export function isImageFile(file: File): boolean {
  return file.type.startsWith(IMAGE_PREFIX)
}

/** 图片文件 → data URI。 */
export function readImageFile(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => {
      const result = reader.result
      if (typeof result === "string") resolve(result)
      else reject(new Error("图片读取失败"))
    }
    reader.onerror = () => reject(reader.error ?? new Error("图片读取失败"))
    reader.readAsDataURL(file)
  })
}

/**
 * 这次拖拽是不是「拖文件」。
 *
 * 判 `types` 而不是 `files`：dragover 阶段只有 `types` 一定可读，`files` 在部分
 * WebView 上要到 drop 才填。按它放行 drop，真正的图片判定留到 drop 里做
 * （单看 types 分不出图片和 txt）。
 */
export function isFileDrag(data: DataTransfer | null): boolean {
  return data !== null && data.types.includes("Files")
}

/**
 * 挑出数据里的全部图片文件。一次拖进来好几张时按顺序依次插块。
 *
 * 用 `files` 而不是 `items`：Tauri 的 WKWebView 在拖拽文件时只填 `files`，
 * `items` 常为空数组，只看 items 的话 mac 端拖图会静默无反应。
 */
export function pickImageFiles(data: DataTransfer | null): File[] {
  if (data === null) return []
  const files: File[] = []
  for (const file of data.files) {
    if (isImageFile(file)) files.push(file)
  }
  return files
}

/** 挑出第一个图片文件。图片块换图、粘贴单张都走这个。 */
export function pickImageFile(data: DataTransfer | null): File | null {
  return pickImageFiles(data)[0] ?? null
}

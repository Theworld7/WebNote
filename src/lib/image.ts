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

/**
 * 图片后缀 → MIME。
 *
 * 预览从盘上读出来的是裸字节，Blob 需要一个类型；缺省成空串交给浏览器嗅探 ——
 * 猜错类型比不说更糟（把 JPEG 声明成 PNG，有的内核会拒绝解码）。
 */
const IMAGE_MIME: Readonly<Record<string, string>> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  avif: "image/avif",
  svg: "image/svg+xml",
  bmp: "image/bmp",
  ico: "image/x-icon",
}

/** 按文件名判图片的 MIME。不认识的形态返回空串，让浏览器自己嗅。 */
export function imageMimeOf(name: string): string {
  const dot = name.lastIndexOf(".")
  if (dot === -1) return ""
  return IMAGE_MIME[name.slice(dot + 1).toLowerCase()] ?? ""
}

export function isImageFile(file: File): boolean {
  return file.type.startsWith(IMAGE_PREFIX)
}

/**
 * 字节 → Blob。
 *
 * 复制进一个新 `ArrayBuffer`：`Uint8Array<ArrayBufferLike>` 不是 `BlobPart`，
 * 而项目不允许用类型断言把这件事糊过去。
 */
export function bytesToBlob(bytes: Uint8Array, mime: string): Blob {
  const copy = new Uint8Array(bytes.byteLength)
  copy.set(bytes)
  return new Blob([copy.buffer], { type: mime })
}

/** 图片 → data URI。`File` 是 `Blob`，拖进来的文件和盘上读回来的字节都走这一条。 */
export function readImageFile(file: Blob): Promise<string> {
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

/** 图片字节 → data URI。转换 Markdown 时把本地图片内联进笔记用。 */
export function imageDataUriOf(bytes: Uint8Array, mime: string): Promise<string> {
  return readImageFile(bytesToBlob(bytes, mime))
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

/**
 * 视频块用到的纯规则：网络地址归一、本地文件判定、资源目录命名。
 *
 * 与 `lib/image` 的分工不同：那边把图片读成 data URI 内联进笔记，视频动辄几十上百 MB，
 * 内联等于把笔记文件撑成炸弹 —— 所以本地视频**留在盘上**，块里只存一条相对路径。
 * 这条差别决定了本模块没有「读成字符串」的角色，只有地址与名字的翻译。
 */

/** 视频后缀 → MIME。盘上读回来的裸字节要包成 Blob，浏览器需要一个类型。 */
const VIDEO_MIME: Readonly<Record<string, string>> = {
  mp4: "video/mp4",
  m4v: "video/mp4",
  webm: "video/webm",
  ogv: "video/ogg",
  ogg: "video/ogg",
  mov: "video/quicktime",
}

/** 按文件名判视频 MIME。不认识的形态返回空串，交给浏览器嗅探。 */
export function videoMimeOf(name: string): string {
  const dot = name.lastIndexOf(".")
  if (dot === -1) return ""
  return VIDEO_MIME[name.slice(dot + 1).toLowerCase()] ?? ""
}

export function isVideoFile(file: File): boolean {
  return file.type.startsWith("video/") || videoMimeOf(file.name) !== ""
}

/** 这次拖拽是不是「拖文件」。与 `lib/image` 同一条判据。 */
export function isFileDrag(data: DataTransfer | null): boolean {
  return data !== null && data.types.includes("Files")
}

/** 挑出第一个视频文件。拖进来的第一个视频就是这一块的片子。 */
export function pickVideoFile(data: DataTransfer | null): File | null {
  if (data === null) return null
  for (const file of data.files) {
    if (isVideoFile(file)) return file
  }
  return null
}

/** 视频块在 HTML 里的类名。序列化写出、解析认领，两边读同一个常量。 */
export const VIDEO_CLASS = "note-video"

/**
 * 地址是不是网络视频。
 *
 * 只有这一个判据：`http(s)://` 走 iframe，其余一律当「相对笔记的文件路径」。模型里
 * 因此不需要另一个 kind 字段 —— 见 `VideoBlock` 的注释。
 */
export function isRemoteVideo(src: string): boolean {
  return /^https?:\/\//i.test(src.trim())
}

/**
 * 这块视频该用哪种元素渲染。
 *
 * - `file`：`<video>` —— 相对笔记的文件路径，**以及带视频后缀的直链**（`…/a.mp4`）。
 *   直链能被浏览器原生播放，套一层 iframe 只是白搭一层壳。
 * - `embed`：`<iframe>` —— 站点播放器（B站 / YouTube 的 embed 地址）。
 *
 * 判据全在地址本身，模型里因此不存 kind 字段。
 */
export function videoModeOf(src: string): "file" | "embed" {
  if (!isRemoteVideo(src)) return "file"
  try {
    return videoMimeOf(new URL(src).pathname) === "" ? "embed" : "file"
  } catch {
    return "embed"
  }
}

/**
 * 资源目录后缀。
 *
 * 本地视频落在笔记旁边的 `<笔记名>.assets/`：与笔记同目录，导出的 HTML 里
 * `src="xxx.assets/a.mp4"` 才是对的相对路径（序列化拿不到笔记路径，见 `VideoBlock`）。
 * 这个后缀同时是「不进文件树」的判据（`isBrowsableDir`）—— 里面只有视频，
 * 摊进树里既打不开也没法用。
 */
export const ASSETS_SUFFIX = ".assets"

export function assetsFolderName(noteStem: string): string {
  return `${noteStem}${ASSETS_SUFFIX}`
}

/** 文件名是否属于资源目录（不看内容，只看后缀）。 */
export function isAssetsFolder(name: string): boolean {
  return name.toLowerCase().endsWith(ASSETS_SUFFIX)
}

/**
 * 把文件名里会让 URL 解析跑偏的字符换掉。
 *
 * `#` 之后是片段、`?` 之后是查询串、`%` 是百分号编码的入口 —— 这三个字符留在文件名里，
 * 导出的 `<video src>` 指向的就不是原来那个文件了（`录屏#1.mp4` 会去找 `录屏`）。
 * 应用内读盘不走 URL，所以只有导出后才会炸，正好是最难发现的那一类。
 * 换成 `-` 而不是删掉：名字还得认得出是哪一段。
 */
export function safeMediaName(name: string): string {
  return name.replace(/[#?%]/g, "-")
}

/**
 * 挑一个没被占用的文件名：原名可用就用原名，否则按 `名字-2.mp4`、`名字-3.mp4` 往下试。
 *
 * 不覆盖是有意的：同一篇笔记里的两块视频很可能来自同一个文件，覆盖等于把先前那块
 * 正在播的片子悄悄换掉。`taken` 由调用方查（只有它知道怎么问文件系统）。
 */
export async function availableName(
  name: string,
  taken: (candidate: string) => Promise<boolean>,
): Promise<string> {
  const safe = safeMediaName(name)
  if (!(await taken(safe))) return safe
  const dot = safe.lastIndexOf(".")
  const stem = dot <= 0 ? safe : safe.slice(0, dot)
  const extension = dot <= 0 ? "" : safe.slice(dot)
  for (let index = 2; index < 1000; index += 1) {
    const candidate = `${stem}-${index}${extension}`
    if (!(await taken(candidate))) return candidate
  }
  throw new Error(`同名视频太多了：${name}`)
}

/**
 * 用户可能整段粘过来的 `<iframe …>` 代码。取其中的 `src`，取不到就当普通文本。
 *
 * 很多站点的「分享 → 嵌入代码」给的就是这一段，让用户自己挑出 URL 是没有必要的门槛。
 */
function iframeSrcOf(raw: string): string | null {
  if (!raw.startsWith("<")) return null
  const doc = new DOMParser().parseFromString(raw, "text/html")
  const frame = doc.querySelector("iframe")
  const src = frame?.getAttribute("src")?.trim() ?? ""
  return src === "" ? null : src
}

/** `/video/BV1xx…` 或 `/video/av12345` 里的 id 与分 P。认不出返回 null。 */
function bilibiliIdOf(url: URL): { bvid?: string; aid?: string; page: string } | null {
  const match = /^\/video\/(BV[0-9A-Za-z]+|av(\d+))/.exec(url.pathname)
  if (match === null) return null
  const id = match[1] ?? ""
  const page = url.searchParams.get("p") ?? "1"
  return id.startsWith("av") ? { aid: match[2] ?? "", page } : { bvid: id, page }
}

/** 把能认出的站点地址换成它的嵌入地址；认不出原样返回。 */
export function toEmbedUrl(raw: string): string {
  const input = raw.trim()
  if (input === "") return ""

  const snippet = iframeSrcOf(input)
  if (snippet !== null) return snippet

  let url: URL
  try {
    url = new URL(input)
  } catch {
    // 既不是 URL 也不是 iframe 代码：原样交回视图，由它按「地址无效」处理。
    return input
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return input

  const host = url.hostname.replace(/^www\./, "").replace(/^m\./, "")

  // B站：播放器地址本身就带 player.bilibili.com，不再二次转换。
  if (host === "bilibili.com") {
    const id = bilibiliIdOf(url)
    if (id === null) return input
    const query = id.bvid !== undefined ? `bvid=${id.bvid}` : `aid=${id.aid ?? ""}`
    return `https://player.bilibili.com/player.html?${query}&page=${id.page}&autoplay=0`
  }

  if (host === "youtu.be") {
    const id = url.pathname.replace(/^\//, "").split("/")[0] ?? ""
    return id === "" ? input : `https://www.youtube.com/embed/${id}`
  }

  if (host === "youtube.com" || host === "youtube-nocookie.com") {
    if (url.pathname.startsWith("/embed/")) return input
    const fromQuery = url.searchParams.get("v") ?? ""
    const fromPath = /^\/(?:shorts|live)\/([^/]+)/.exec(url.pathname)?.[1] ?? ""
    const id = fromQuery !== "" ? fromQuery : fromPath
    return id === "" ? input : `https://www.youtube.com/embed/${id}`
  }

  if (host === "vimeo.com") {
    const id = /^\/(\d+)/.exec(url.pathname)?.[1] ?? ""
    return id === "" ? input : `https://player.vimeo.com/video/${id}`
  }

  // 其它站点：iframe 能不能开取决于对方的 X-Frame-Options，我们无从预判，
  // 原样塞进去试 —— 打不开时视图给「在浏览器打开」的出口。
  return input
}

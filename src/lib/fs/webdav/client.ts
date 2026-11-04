import { isTauriRuntime } from "../runtime"

/**
 * WebDAV 客户端。
 *
 * 只做「把请求发出去、把 XML 解析成条目」这两件事，工作区语义（哪些文件进树、
 * 路径怎么拼）留在 `./index`。传输通道按运行时切换：桌面端交给 Rust（WebView 发
 * `PROPFIND` 会卡在跨域预检），浏览器端直接 `fetch`。
 */

/** 一次 DAV 请求的最低限度信息。响应体统一当字节看，文本由调用方解码。 */
interface DavRawResponse {
  status: number
  bytes: Uint8Array
}

export class DavError extends Error {
  /** HTTP 状态码。网络层失败（跨域、DNS、超时）记 0 —— 上层据此区分「地址不通」与「服务器说不」。 */
  readonly status: number

  constructor(status: number, message: string) {
    super(message)
    this.name = "DavError"
    this.status = status
  }
}

export interface DavDirectoryEntry {
  name: string
  isFolder: boolean
}

export interface DavWriteOptions {
  /** `If-None-Match: *`：目标已存在时让服务器拒绝，而不是悄悄覆盖。 */
  readonly createOnly?: boolean
}

/** PROPFIND 只要 `resourcetype` —— 判断是集合还是文件只需要那一项。 */
const PROPFIND_BODY = `<?xml version="1.0" encoding="utf-8"?>
<d:propfind xmlns:d="DAV:"><d:prop><d:resourcetype/></d:prop></d:propfind>`

const XML_CONTENT_TYPE = "application/xml; charset=utf-8"

/**
 * 服务器地址归一：补协议、补结尾斜杠、丢掉查询串。
 *
 * 结尾斜杠是硬要求 —— DAV 的集合 URL 以 `/` 结尾，少了它，拼出来的子路径会把
 * 最后一段当成文件名（`/dav` + `笔记` → `/dav笔记`），而 PROPFIND 又恰好不报错，
 * 表现成「目录是空的」。
 */
export function normalizeDavUrl(raw: string): string {
  const trimmed = raw.trim()
  if (trimmed === "") throw new DavError(0, "先填服务器地址")
  const withScheme = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`
  let url: URL
  try {
    url = new URL(withScheme)
  } catch {
    throw new DavError(0, `地址写得不对：${trimmed}`)
  }
  url.search = ""
  url.hash = ""
  if (!url.pathname.endsWith("/")) url.pathname = `${url.pathname}/`
  return url.toString()
}

/** 服务器说「不行」时给用户看的话。401 单独写，是因为坚果云这里最常踩。 */
export function describeDavStatus(status: number): string {
  switch (status) {
    case 401:
      return "用户名或密码不对（坚果云要用「应用密码」，不是登录密码）"
    case 403:
      return "服务器拒绝访问这个位置"
    case 404:
      return "服务器上找不到这个位置"
    case 405:
      return "服务器不支持这个操作"
    case 409:
      return "上一级目录不存在"
    case 412:
      return "已经存在同名文件"
    case 423:
      return "文件被服务器锁住了，稍后再试"
    case 507:
      return "服务器空间不足"
    default:
      return status >= 500 ? `服务器出错（${status}）` : `请求失败（${status}）`
  }
}

function toBase64(bytes: Uint8Array): string {
  let binary = ""
  const chunk = 0x8000
  for (let index = 0; index < bytes.length; index += chunk) {
    binary += String.fromCharCode(...bytes.subarray(index, index + chunk))
  }
  return btoa(binary)
}

function fromBase64(text: string): Uint8Array {
  const binary = atob(text)
  const bytes = new Uint8Array(binary.length)
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index)
  return bytes
}

function basicAuth(username: string, password: string): string {
  return `Basic ${toBase64(new TextEncoder().encode(`${username}:${password}`))}`
}

/** 路径段解码。`decodeURIComponent` 单段调用，含 `%2F` 的名字不会被拆成两层。 */
function pathSegments(pathname: string): string[] {
  return pathname
    .split("/")
    .filter((part) => part !== "")
    .map((part) => {
      try {
        return decodeURIComponent(part)
      } catch {
        return part
      }
    })
}

function sameSegments(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((segment, index) => segment === right[index])
}

export interface DavClient {
  /** 归一后的服务器地址，结尾带斜杠。 */
  readonly baseUrl: string
  /** 把路径段拼成完整 URL。工作区根就是 `urlOf([])` 或 `urlOf(子目录)`。 */
  urlOf(segments: readonly string[]): string
  /**
   * 目录 URL，结尾一定带 `/`。
   *
   * 集合的 URL 少了结尾斜杠，多数服务器会先回 301 再让你重发 —— 而重定向对
   * `PROPFIND` 这种非 GET 方法并不可靠（浏览器会把它降成 GET），表现是「目录永远是空的」。
   */
  folderUrlOf(segments: readonly string[]): string
  list(segments: readonly string[]): Promise<DavDirectoryEntry[]>
  /** 存在与否。404 记 `false`，其它异常照常抛。 */
  stat(segments: readonly string[]): Promise<boolean>
  readText(segments: readonly string[]): Promise<string>
  readBytes(segments: readonly string[]): Promise<Uint8Array>
  writeText(segments: readonly string[], text: string, options?: DavWriteOptions): Promise<void>
  writeBytes(segments: readonly string[], bytes: Uint8Array): Promise<void>
  /** 建目录。已存在算成功 —— 调用方常按整条路径逐级建，不关心哪一级本来就有。 */
  makeFolder(segments: readonly string[]): Promise<void>
  move(from: readonly string[], to: readonly string[]): Promise<void>
  remove(segments: readonly string[]): Promise<void>
}

export function createDavClient(options: {
  url: string
  username: string
  password: string
}): DavClient {
  const baseUrl = normalizeDavUrl(options.url)
  const authorization = basicAuth(options.username, options.password)

  function urlOf(segments: readonly string[]): string {
    const encoded = segments.map((segment) => encodeURIComponent(segment)).join("/")
    return encoded === "" ? baseUrl : `${baseUrl}${encoded}`
  }

  function folderUrlOf(segments: readonly string[]): string {
    return `${urlOf(segments)}/`
  }

  async function send(
    method: string,
    url: string,
    headers: Record<string, string>,
    body?: Uint8Array,
  ): Promise<DavRawResponse> {
    const merged = { Authorization: authorization, ...headers }
    if (isTauriRuntime()) {
      const response = await invokeDav({
        method,
        url,
        headers: merged,
        bodyBase64: body === undefined ? null : toBase64(body),
      })
      return { status: response.status, bytes: fromBase64(response.bodyBase64) }
    }

    let response: Response
    // 复制一份拿到底层的 `ArrayBuffer`：`fetch` 的 body 只认 `BodyInit`，而 TypedArray
    // 的泛型参数可能是 `SharedArrayBuffer`，直接传会被类型系统挡下来。
    const payload = body === undefined ? undefined : new Uint8Array(body).buffer
    try {
      response = await fetch(url, { method, headers: merged, body: payload })
    } catch {
      // fetch 在这里抛的只有网络层失败（CORS、DNS、证书、离线），服务器回过什么状态码
      // 都走不到这个分支。跨域是最常见的一种，直接把话说清楚，省得用户对着
      // 「Failed to fetch」猜。
      throw new DavError(
        0,
        `连不上这个地址：${url}。若在浏览器里使用，多半是服务器没有开放跨域访问，改用桌面版即可。`,
      )
    }
    return { status: response.status, bytes: new Uint8Array(await response.arrayBuffer()) }
  }

  async function expectOk(
    method: string,
    url: string,
    headers: Record<string, string>,
    body?: Uint8Array,
    accept: readonly number[] = [],
  ): Promise<Uint8Array> {
    const response = await send(method, url, headers, body)
    if (response.status >= 200 && response.status < 300) return response.bytes
    if (accept.includes(response.status)) return response.bytes
    throw new DavError(response.status, describeDavStatus(response.status))
  }

  async function propfind(segments: readonly string[], depth: string): Promise<string> {
    const bytes = await expectOk(
      "PROPFIND",
      folderUrlOf(segments),
      { Depth: depth, "Content-Type": XML_CONTENT_TYPE },
      new TextEncoder().encode(PROPFIND_BODY),
    )
    return new TextDecoder().decode(bytes)
  }

  return {
    baseUrl,
    urlOf,
    folderUrlOf,

    async list(segments) {
      const xml = await propfind(segments, "1")
      const base = pathSegments(new URL(baseUrl).pathname)
      const document = new DOMParser().parseFromString(xml, "application/xml")
      // 地址指向普通网页（把分享链接当服务器地址填）时，拿到的是 HTML，DOM 解析器会
      // 给出一个 `parsererror` 节点 —— 这时说「不是 WebDAV」比说「没找到条目」有用。
      if (document.getElementsByTagName("parsererror").length > 0) {
        throw new DavError(0, "这个地址返回的不是 WebDAV 响应，确认地址填的是 WebDAV 服务而不是网页")
      }

      const entries: DavDirectoryEntry[] = []
      for (const node of Array.from(document.getElementsByTagNameNS("*", "response"))) {
        const href = node.getElementsByTagNameNS("*", "href")[0]?.textContent?.trim()
        if (href === undefined || href === "") continue

        // href 可能是绝对 URL，也可能是以 `/` 开头的绝对路径，统一按服务器地址解析。
        const target = pathSegments(new URL(href, baseUrl).pathname)
        if (!sameSegments(target.slice(0, base.length), base)) continue
        const relative = target.slice(base.length)
        // 只留直接子项：PROPFIND 带 Depth: 1 时第一行是目录自己。
        if (relative.length !== segments.length + 1) continue
        if (!sameSegments(relative.slice(0, -1), segments)) continue

        entries.push({
          name: relative[relative.length - 1]!,
          isFolder: node.getElementsByTagNameNS("*", "collection").length > 0,
        })
      }
      return entries
    },

    async stat(segments) {
      const response = await send("PROPFIND", urlOf(segments), {
        Depth: "0",
        "Content-Type": XML_CONTENT_TYPE,
      }, new TextEncoder().encode(PROPFIND_BODY))
      if (response.status === 404) return false
      if (response.status >= 200 && response.status < 300) return true
      throw new DavError(response.status, describeDavStatus(response.status))
    },

    async readText(segments) {
      const bytes = await expectOk("GET", urlOf(segments), {})
      return new TextDecoder().decode(bytes)
    },

    async readBytes(segments) {
      return expectOk("GET", urlOf(segments), {})
    },

    async writeText(segments, text, writeOptions) {
      const headers: Record<string, string> = { "Content-Type": "text/html; charset=utf-8" }
      if (writeOptions?.createOnly === true) headers["If-None-Match"] = "*"
      await expectOk("PUT", urlOf(segments), headers, new TextEncoder().encode(text))
    },

    async writeBytes(segments, bytes) {
      await expectOk("PUT", urlOf(segments), {
        "Content-Type": "application/octet-stream",
      }, bytes)
    },

    async makeFolder(segments) {
      // 405 = 已经存在。逐级建的时候中间层常常本来就有，不该当失败。
      await expectOk("MKCOL", folderUrlOf(segments), {}, undefined, [405])
    },

    async move(from, to) {
      // 412 = 目标已存在（`Overwrite: F` 的拒绝）。调用方应已用 `exists` 拦过，
      // 到这里还撞上就是竞态，按普通失败报出来即可。
      await expectOk("MOVE", urlOf(from), { Destination: urlOf(to), Overwrite: "F" })
    },

    async remove(segments) {
      // 404 当成功：删除是幂等的，重试一次不该报「文件不存在」。
      await expectOk("DELETE", urlOf(segments), {}, undefined, [404])
    },
  }
}

/** Rust 侧的请求通道。抽出来单独放，是为了让上面那段流程看起来只有两条分支。 */
async function invokeDav(request: {
  method: string
  url: string
  headers: Record<string, string>
  bodyBase64: string | null
}): Promise<{ status: number; bodyBase64: string }> {
  const { invoke } = await import("@tauri-apps/api/core")
  return invoke<{ status: number; bodyBase64: string }>("webdav_request", { request })
}

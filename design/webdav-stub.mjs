// 内存版 WebDAV 服务，只为本仓库的自检页服务（`design/webdav-check.html`）。
//
// 不去实现完整协议，只覆盖客户端用到的那几个方法：PROPFIND(depth 0/1)、GET、PUT、
// MKCOL、MOVE、DELETE。响应形状按 RFC 4918 的最小合法子集来 —— 客户端解析的是
// 真实服务器的输出，这里如果自造一套「好解析」的格式，测出来的只是自家格式。
//
// 启动：node design/webdav-stub.mjs [port]
import http from "node:http"

const PORT = Number(process.argv[2] ?? 8099)
const PREFIX = "/dav"

/** path（不含前缀、不以 / 结尾、根为 ""）→ { type: "dir" } | { type: "file", data: Buffer } */
const entries = new Map()

function normalize(path) {
  // 统一成「不带开头与结尾斜杠」的形式（根是 ""），后面的拼接与比较全靠它。
  const leading = path.startsWith("/") ? path : `/${path}`
  const trimmed = leading.length > 1 && leading.endsWith("/") ? leading.slice(0, -1) : leading
  return trimmed === "/" ? "" : trimmed.slice(1)
}

function parentOf(path) {
  const index = path.lastIndexOf("/")
  return index <= 0 ? "" : path.slice(0, index)
}

function put(path, entry) {
  entries.set(path, entry)
}

function childrenOf(path) {
  // 键不带开头的斜杠（根是 ""），所以根层要按「不含 /」判，不能按前缀 "/" 判。
  const prefix = path === "" ? "" : `${path}/`
  const result = []
  for (const key of entries.keys()) {
    if (key === "" || key === path) continue
    if (path === "") {
      if (key.includes("/")) continue
    } else {
      if (!key.startsWith(prefix)) continue
      if (key.slice(prefix.length).includes("/")) continue
    }
    result.push(key)
  }
  return result
}

function hrefOf(path, isDir) {
  const encoded = path
    .split("/")
    .filter((part) => part !== "")
    .map((part) => encodeURIComponent(part))
    .join("/")
  return `${PREFIX}/${encoded}${isDir && encoded !== "" ? "/" : ""}`
}

function xmlEscape(text) {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
}

function multistatus(res, paths) {
  const body = paths
    .map((path) => {
      const entry = entries.get(path)
      const isDir = entry?.type === "dir"
      const resourceType = isDir ? "<D:collection/>" : ""
      return `<D:response><D:href>${xmlEscape(hrefOf(path, isDir))}</D:href>` +
        `<D:propstat><D:prop><D:resourcetype>${resourceType}</D:resourcetype></D:prop>` +
        `<D:status>HTTP/1.1 200 OK</D:status></D:propstat></D:response>`
    })
    .join("")
  res.writeHead(207, { "Content-Type": "application/xml; charset=utf-8", ...cors })
  res.end(`<?xml version="1.0" encoding="utf-8"?><D:multistatus xmlns:D="DAV:">${body}</D:multistatus>`)
}

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, content-type, depth, destination, overwrite, if-none-match, x-test",
  "Access-Control-Allow-Methods": "GET, PUT, DELETE, PROPFIND, MKCOL, MOVE, OPTIONS",
  "Access-Control-Max-Age": "600",
}

function readBody(req) {
  return new Promise((resolve) => {
    const chunks = []
    req.on("data", (chunk) => chunks.push(chunk))
    req.on("end", () => resolve(Buffer.concat(chunks)))
  })
}

/** 种一份小库：一个文件夹、一篇笔记、一个资源目录、一个不该进树的文本文件。 */
put("", { type: "dir" })
put("笔记", { type: "dir" })
put("笔记/子目录", { type: "dir" })
put("笔记/a.html", { type: "file", data: Buffer.from("<p>甲</p>") })
put("笔记/说明.txt", { type: "file", data: Buffer.from("not a note") })
put("笔记/a.assets", { type: "dir" })
put("笔记/a.assets/clip.mp4", { type: "file", data: Buffer.from([0, 1, 2, 3]) })

const server = http.createServer(async (req, res) => {
  if (req.method === "OPTIONS") {
    res.writeHead(204, cors)
    res.end()
    return
  }

  const url = new URL(req.url ?? "/", `http://127.0.0.1:${PORT}`)
  const raw = decodeURIComponent(url.pathname)
  if (!raw.startsWith(PREFIX)) {
    res.writeHead(404, cors)
    res.end("outside dav root")
    return
  }
  const path = normalize(raw.slice(PREFIX.length))
  const entry = entries.get(path)

  if (req.method === "PROPFIND") {
    if (entry === undefined) {
      res.writeHead(404, cors)
      res.end()
      return
    }
    const depth = req.headers.depth ?? "1"
    multistatus(res, depth === "0" ? [path] : [path, ...childrenOf(path)])
    return
  }

  if (req.method === "GET") {
    if (entry === undefined || entry.type !== "file") {
      res.writeHead(404, cors)
      res.end()
      return
    }
    res.writeHead(200, { "Content-Type": "application/octet-stream", ...cors })
    res.end(entry.data)
    return
  }

  if (req.method === "PUT") {
    const body = await readBody(req)
    const exists = entry !== undefined
    if (exists && req.headers["if-none-match"] === "*") {
      res.writeHead(412, cors)
      res.end()
      return
    }
    if (!exists && entries.get(parentOf(path))?.type !== "dir") {
      res.writeHead(409, cors)
      res.end()
      return
    }
    put(path, { type: "file", data: body })
    res.writeHead(exists ? 200 : 201, cors)
    res.end()
    return
  }

  if (req.method === "MKCOL") {
    if (entry !== undefined) {
      res.writeHead(405, cors)
      res.end()
      return
    }
    if (entries.get(parentOf(path))?.type !== "dir") {
      res.writeHead(409, cors)
      res.end()
      return
    }
    put(path, { type: "dir" })
    res.writeHead(201, cors)
    res.end()
    return
  }

  if (req.method === "DELETE") {
    if (entry === undefined) {
      res.writeHead(404, cors)
      res.end()
      return
    }
    for (const key of [...entries.keys()]) {
      if (key === path || key.startsWith(`${path}/`)) entries.delete(key)
    }
    res.writeHead(204, cors)
    res.end()
    return
  }

  if (req.method === "MOVE") {
    if (entry === undefined) {
      res.writeHead(404, cors)
      res.end()
      return
    }
    const destination = req.headers.destination ?? ""
    const destinationUrl = new URL(destination, `http://127.0.0.1:${PORT}`)
    const destinationPath = normalize(decodeURIComponent(destinationUrl.pathname).slice(PREFIX.length))
    if (entries.has(destinationPath) || entries.get(parentOf(destinationPath))?.type !== "dir") {
      res.writeHead(412, cors)
      res.end()
      return
    }
    // 先摘下来再落到新位置：边遍历边改 Map 会漏掉后代。
    const moved = []
    for (const [key, value] of entries) {
      if (key === path || key.startsWith(`${path}/`)) {
        moved.push([key, destinationPath + key.slice(path.length), value])
      }
    }
    for (const [key] of moved) entries.delete(key)
    for (const [, key, value] of moved) entries.set(key, value)
    res.writeHead(201, cors)
    res.end()
    return
  }

  res.writeHead(405, cors)
  res.end()
})

server.listen(PORT, "127.0.0.1", () => {
  console.log(`webdav stub on http://127.0.0.1:${PORT}${PREFIX}/`)
})

// 用 CDP 等页面里的探针跑完（顶层 await 的脚本 --dump-dom 抓不到）。
// 用法: node cdp-dump.mjs <url> [selector] [bailPrefix]
// 想顺便截图（看排版观感）: SHOT=/tmp/x.png node cdp-dump.mjs <url>
// 内核路径可用 CHROME 环境变量覆盖；否则按平台在 ms-playwright 缓存里探测。
import { spawn } from "node:child_process"
import { existsSync, readdirSync, writeFileSync } from "node:fs"
import { homedir } from "node:os"
import { join } from "node:path"

const HEADLESS = "chrome-headless-shell"

/**
 * 探测 ms-playwright 缓存里的 headless shell。
 *
 * 缓存目录带版本号（chromium_headless_shell-1247），每次 playwright 升级都会变，
 * 所以按前缀列目录、从新到旧挑第一个存在的 —— 写死版本号会在升级后失效。
 */
function detectChrome() {
  if (process.env.CHROME) return process.env.CHROME

  const roots =
    process.platform === "darwin"
      ? [join(homedir(), "Library/Caches/ms-playwright")]
      : process.platform === "win32"
        ? [join(homedir(), "AppData/Local/ms-playwright")]
        : [join(homedir(), ".cache/ms-playwright")]

  const relative = {
    darwin: ["chrome-headless-shell-mac-arm64", HEADLESS],
    win32: ["chrome-headless-shell-win64", `${HEADLESS}.exe`],
    linux: ["chrome-headless-shell-linux64", HEADLESS],
  }[process.platform]

  if (relative === undefined) return null

  for (const root of roots) {
    if (!existsSync(root)) continue
    const candidates = readdirSync(root)
      .filter((name) => name.startsWith("chromium_headless_shell-"))
      .sort()
      .reverse()
    for (const name of candidates) {
      const path = join(root, name, ...relative)
      if (existsSync(path)) return path
    }
  }

  return null
}

const CHROME = detectChrome()
if (CHROME === null) {
  console.error("找不到 chrome-headless-shell，请设 CHROME 环境变量指向可执行文件")
  process.exit(1)
}

const url = process.argv[2]
const selector = process.argv[3] ?? "#out"
const bail = process.argv[4] ?? "running"
const shot = process.env.SHOT ?? ""

const chrome = spawn(
  CHROME,
  ["--headless", "--disable-gpu", "--no-first-run", "--remote-debugging-port=9333", url],
  { stdio: "ignore" },
)

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function pageTarget() {
  for (let i = 0; i < 100; i += 1) {
    try {
      const list = await (await fetch("http://127.0.0.1:9333/json/list")).json()
      const page = list.find((t) => t.type === "page" && t.webSocketDebuggerUrl)
      if (page) return page
    } catch {}
    await sleep(100)
  }
  throw new Error("CDP 没起来")
}

const target = await pageTarget()
const ws = new WebSocket(target.webSocketDebuggerUrl)
await new Promise((r) => (ws.onopen = r))

let id = 0
const pending = new Map()
ws.onmessage = (ev) => {
  const msg = JSON.parse(ev.data)
  const resolve = pending.get(msg.id)
  if (resolve) {
    pending.delete(msg.id)
    resolve(msg)
  }
}

function send(method, params) {
  const messageId = ++id
  ws.send(JSON.stringify({ id: messageId, method, params }))
  return new Promise((resolve) => pending.set(messageId, resolve))
}

async function readOut() {
  const res = await send("Runtime.evaluate", {
    expression: `document.querySelector(${JSON.stringify(selector)})?.textContent ?? ""`,
    returnByValue: true,
  })
  return res.result?.result?.value ?? ""
}

let text = ""
for (let i = 0; i < 150; i += 1) {
  text = await readOut()
  if (text && !text.startsWith(bail) && !text.startsWith("REJECT") && !text.startsWith("ERROR")) break
  if (text.startsWith("REJECT") || text.startsWith("ERROR")) break
  await sleep(100)
}

console.log(text)

// 探针跑完再截图：整页高度可能超出窗口，按 layout metrics 抓全。
if (shot !== "") {
  const metrics = await send("Page.getLayoutMetrics", {})
  const size = metrics.result?.cssContentSize ?? {}
  const width = Math.ceil(size.width ?? 0)
  const height = Math.ceil(size.height ?? 0)
  const res = await send("Page.captureScreenshot", {
    format: "png",
    captureBeyondViewport: true,
    clip: { x: 0, y: 0, width, height, scale: 1 },
  })
  const data = res.result?.data
  if (typeof data === "string") {
    writeFileSync(shot, Buffer.from(data, "base64"))
    console.log(`screenshot ${width}x${height} → ${shot}`)
  } else {
    console.log("screenshot 失败：CDP 没返回数据")
  }
}

ws.close()
chrome.kill()
process.exit(0)

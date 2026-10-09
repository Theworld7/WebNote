// 用 CDP 等页面里的探针跑完（顶层 await 的脚本 --dump-dom 抓不到）。
// 用法: node cdp-dump.mjs <url> [selector] [bailPrefix]
// 想顺便截图（看排版观感）: SHOT=/tmp/x.png node cdp-dump.mjs <url>
import { spawn } from "node:child_process"
import { writeFileSync } from "node:fs"

const CHROME =
  process.env.HOME +
  "/Library/Caches/ms-playwright/chromium_headless_shell-1244/chrome-headless-shell-mac-arm64/chrome-headless-shell"

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

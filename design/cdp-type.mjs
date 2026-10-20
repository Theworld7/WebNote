// 给自检页打字：CDP Input.insertText 是唯一能让 Monaco 走完整输入管线的路径。
// 用法: node design/cdp-type.mjs <url> "<要输入的文本>" [selector]
// 约定：页面把 `READY` 写进输出区 → 这里打字 → 页面自己置 window.__typed。
import { spawn } from "node:child_process"
import { existsSync, readdirSync, writeFileSync } from "node:fs"
import { homedir } from "node:os"
import { join } from "node:path"

const HEADLESS = "chrome-headless-shell"
const PORT = 9334
const WINDOW = process.env.WINDOW ?? "1200"

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
  for (const root of roots) {
    if (!existsSync(root)) continue
    for (const dir of readdirSync(root).filter((name) => name.startsWith("chromium_headless_shell")).reverse()) {
      const candidate = join(root, dir, ...relative)
      if (existsSync(candidate)) return candidate
    }
  }
  console.error("找不到 chrome-headless-shell，请设 CHROME 环境变量")
  process.exit(1)
}

const url = process.argv[2]
const text = process.argv[3] ?? ""
const selector = process.argv[4] ?? "#out"
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const chrome = spawn(
  detectChrome(),
  ["--headless", "--disable-gpu", "--no-first-run", `--window-size=${WINDOW},900`, `--remote-debugging-port=${PORT}`, url],
  { stdio: "ignore" },
)

async function pageTarget() {
  for (let i = 0; i < 100; i += 1) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json()
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
async function evaluate(expression) {
  const res = await send("Runtime.evaluate", { expression, returnByValue: true })
  return res.result?.result?.value
}

// 等页面把 READY 写进输出区。
let ready = false
for (let i = 0; i < 400; i += 1) {
  if ((await evaluate(`document.querySelector(${JSON.stringify(selector)})?.textContent ?? ""`)) === "READY") {
    ready = true
    break
  }
  await sleep(100)
}
if (ready) {
  // headless 里没有真实的 IME / 键盘通道（Monaco 0.5x 走 EditContext，连 textarea 都没有），
  // 输入由页面用编辑器 API 写；这里只负责「点页面空白处」—— 那是浏览器层面的失焦，
  // Monaco 的 onDidBlurEditorText 认。
  await send("Emulation.setFocusEmulationEnabled", { enabled: true })
  const box = await evaluate(
    `(() => { const el = document.querySelector("${selector}"); if (!el) return null; const r = el.getBoundingClientRect(); return { x: r.x + 10, y: r.y + 10 }; })()`,
  )
  if (box) {
    // 截图在点击之前：点下去就触发失焦提交，编辑态就没了。
    if (process.env.SHOT) {
      const metrics = await send("Page.getLayoutMetrics", {})
      const size = metrics.result?.cssContentSize ?? {}
      const res = await send("Page.captureScreenshot", {
        format: "png",
        captureBeyondViewport: true,
        clip: { x: 0, y: 0, width: Math.ceil(size.width ?? 0), height: Math.ceil(size.height ?? 0), scale: 1 },
      })
      if (typeof res.result?.data === "string") writeFileSync(process.env.SHOT, Buffer.from(res.result.data, "base64"))
    }
    await send("Input.dispatchMouseEvent", { type: "mousePressed", x: box.x, y: box.y, button: "left", clickCount: 1 })
    await send("Input.dispatchMouseEvent", { type: "mouseReleased", x: box.x, y: box.y, button: "left", clickCount: 1 })
    await sleep(200)
  }
  await evaluate("window.__typed = true")
} else {
  console.error("never saw READY")
}

// 等收尾行。
const DONE = /(\d+\s*\/\s*\d+)|(\d+\s+passed)|(^ERROR)|(^REJECT)/m
let output = ""
for (let i = 0; i < 400; i += 1) {
  output = await evaluate(`document.querySelector(${JSON.stringify(selector)})?.textContent ?? ""`)
  if (DONE.test(output)) break
  await sleep(100)
}
console.log(output)

ws.close()
chrome.kill()
process.exit(0)

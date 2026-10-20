import type { Theme } from "@/types/workspace"

/**
 * 读 token 在**指定外观**下的实际颜色。
 *
 * 有两处需要拿「token 的最终值」而不是类名：Monaco 的主题是一份 JS 对象
 * （`lib/monaco-theme.ts`），沙箱 iframe 是另一个文档、拿不到父页面的 CSS 变量
 * （`lib/html-frame.ts`）。两处都得把颜色当字符串带过去。
 *
 * 三个约束：
 *
 * 1. **不能读 `document.documentElement`**：那读的是「此刻界面上是什么外观」，
 *    于是「当时是深色，却被要求取浅色」就会把深色的值写进浅色的地方。探针自带
 *    `.dark`，读哪一套与文档当前状态无关 —— 顺序、时序都不必再操心。
 * 2. **必须挂在文档里**：游离节点的 `getComputedStyle` 拿不到继承下来的自定义属性。
 * 3. **不能正则抠数字**：`getComputedStyle` 对 `oklch()` 原样返回 `oklch(0.145 0 0)`，
 *    抠出来的 (0.145, 0, 0) 是另一支颜色。交给 canvas 解析并投到 sRGB 字节。
 */
let probeElement: HTMLDivElement | null = null

/** 惰性创建：这些模块会被静态 import，别在导入期就碰 DOM。 */
function probe(): HTMLDivElement {
  if (probeElement !== null) return probeElement
  const element = document.createElement("div")
  element.setAttribute("aria-hidden", "true")
  element.style.cssText = "position:absolute;width:0;height:0;overflow:hidden;pointer-events:none"
  // body 还没到位（极早的调用）就挂到根上：`getComputedStyle` 只认文档里的元素。
  const host = document.body ?? document.documentElement
  host.append(element)
  probeElement = element
  return element
}

/** 2D 上下文只建一次（1×1 像素就够）。拿不到就返回 null，调用方退回自己的兜底色。 */
let cachedContext: CanvasRenderingContext2D | null | undefined

function canvasContext(): CanvasRenderingContext2D | null {
  if (cachedContext !== undefined) return cachedContext
  const canvas = document.createElement("canvas")
  canvas.width = 1
  canvas.height = 1
  cachedContext = canvas.getContext("2d", { willReadFrequently: true })
  return cachedContext
}

/**
 * 一个 token → `#rrggbb` / `#rrggbbaa`。
 *
 * `alpha` 传了就覆盖 token 自带的透明度（`--border` 在深色下本来就是 10%），
 * 不传就沿用。token 读不到（未定义、浏览器不认这个颜色）时返回 `null`。
 */
export function readThemeColor(theme: Theme, variable: string, alpha?: number): string | null {
  const element = probe()
  element.className = theme === "dark" ? "dark" : ""
  const value = window.getComputedStyle(element).getPropertyValue(variable).trim()
  if (value === "") return null
  const context = canvasContext()
  if (context === null) return null
  // 哨兵：#010203 不在调色板里。浏览器不认这个颜色时 fillStyle 会原样停在这里 ——
  // 这比「读回 rgb(0,0,0) 再判断」可靠：合法但恰好是纯黑的值不会被误判。
  context.fillStyle = "#010203"
  context.fillStyle = value
  if (context.fillStyle === "#010203") return null
  context.clearRect(0, 0, 1, 1)
  context.fillRect(0, 0, 1, 1)
  const [red, green, blue, rawAlpha] = context.getImageData(0, 0, 1, 1).data
  const hex = (channel: number) => channel.toString(16).padStart(2, "0")
  const rgb = `#${hex(red)}${hex(green)}${hex(blue)}`
  const opacity = alpha ?? rawAlpha / 255
  return opacity >= 1 ? rgb : rgb + hex(Math.round(opacity * 255))
}

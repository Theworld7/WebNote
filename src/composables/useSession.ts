/**
 * 会话快照：关掉应用时「正看着什么」，下次打开原样接上。
 *
 * 记的是**看着什么**（开着哪些标签、看的是哪篇、树展开到哪层、每篇停在哪一行），
 * 不记**改了什么** —— 后者是自动保存的事（ADR-0036）。两者不重叠：会话是这台机器上
 * 的临场状态，脏内容是盘上的真事。
 *
 * 存 `localStorage` 而不是 `webnote.json`：这份状态跟着这台机器走，不跟着笔记库走。
 * 换台电脑打开同一个库，不该被上一台机器停在半路的标签排布接管 —— 同理也不该
 * 因为换了工作区就互相覆盖，所以按工作区根路径分键。
 */

const SESSION_PREFIX = "webnote:session:"

/**
 * 浏览器端的键。
 *
 * `WorkspaceFs.absolutePath` 在浏览器端返回 `null`（句柄背后没有路径），那里是
 * `pnpm dev` 的调试运行时，一个键够用。桌面端一律走真实根路径。
 */
const BROWSER_KEY = "browser"

export interface SessionSnapshot {
  tabs: string[]
  activePath: string
  expandedIds: string[]
  scrollTops: Record<string, number>
}

/** 工作区 → 存储键。`absolutePath` 为 `null`（浏览器端）时退回固定键。 */
export function sessionKeyOf(absolutePath: string | null): string {
  return SESSION_PREFIX + (absolutePath ?? BROWSER_KEY)
}

function readStrings(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  const result: string[] = []
  for (const item of value) {
    if (typeof item === "string" && item !== "") result.push(item)
  }
  return result
}

/** 坏坐标（`NaN`、负值、字符串）整条丢掉，不拖累别的路径的位置。 */
function readScrollTops(value: unknown): Record<string, number> {
  const result: Record<string, number> = {}
  if (typeof value !== "object" || value === null) return result
  for (const [path, top] of Object.entries(value)) {
    if (path !== "" && typeof top === "number" && Number.isFinite(top) && top >= 0) result[path] = top
  }
  return result
}

/**
 * 读一份快照。没有、JSON 坏了、顶层不是对象、或者 `tabs` / `expandedIds` 根本不是
 * 数组，一律返回 `null` 让调用方回到「第一次打开」的默认行为。
 *
 * 这两个字段比别的严一档：一份「标签读不出来、展开集读得出来」的快照会让应用回到
 * 「树按上次展开、标签一个没有」的半截状态 —— 比干脆当成没存过更莫名其妙。它们是
 * 空数组是合法的（用户把标签关光了、把树全折叠了），**空**和**坏**要分开。
 */
export function readSession(key: string): SessionSnapshot | null {
  let raw: string | null
  try {
    raw = window.localStorage.getItem(key)
  } catch {
    // 无痕 / 关掉本地存储的浏览器里 `getItem` 本身就会抛。读不到就当没存过 ——
    // 这一层抛出去会连带 `adoptRoot` 判成「读取目录失败」并把刚扫好的树清空。
    return null
  }
  if (raw === null) return null
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return null
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return null
  const record: Record<string, unknown> = {}
  for (const [field, value] of Object.entries(parsed)) record[field] = value
  if (!Array.isArray(record["tabs"]) || !Array.isArray(record["expandedIds"])) return null
  return {
    tabs: readStrings(record["tabs"]),
    activePath: typeof record["activePath"] === "string" ? record["activePath"] : "",
    expandedIds: readStrings(record["expandedIds"]),
    scrollTops: readScrollTops(record["scrollTops"]),
  }
}

export function writeSession(key: string, snapshot: SessionSnapshot): void {
  try {
    window.localStorage.setItem(key, JSON.stringify(snapshot))
  } catch {
    // 存不下（配额满 / 隐私模式）不是用户的动作失败：标签、展开、滚动位置都已经在
    // 内存里生效了，丢的是「下次还记得」，不值得拿一条错误条打断他。
  }
}

// ---- 滚动位置的常驻记忆 ----

/**
 * 每篇笔记停在哪儿。
 *
 * 放模块层而不是组件里：`BlockEditor` 随标签切换整个卸下再挂回（`EditorSurface`
 * 的 `v-if`），`scrollTop` 跟着实例一起没了。这份记忆要活得比实例久 —— 而且关窗时
 * 会话快照要读的也正是这一份，不能让它藏在一个组件的闭包里。
 */
const scrollTops = new Map<string, number>()

export function rememberScrollTop(path: string, top: number): void {
  if (path !== "" && Number.isFinite(top)) scrollTops.set(path, top)
}

/** 没有记忆的路径落回顶部，与「从盘上重新打开」同一个起点。 */
export function scrollTopOf(path: string): number {
  return scrollTops.get(path) ?? 0
}

export function scrollTopsSnapshot(): Record<string, number> {
  const result: Record<string, number> = {}
  for (const [path, top] of scrollTops) result[path] = top
  return result
}

/**
 * 收下上一次会话的位置。整份替换：换工作区 = 换语境，旧库里那批路径对新树不成立
 * （同 `adoptRoot` 清空标签的理由）。
 */
export function adoptScrollTops(entries: Record<string, number>): void {
  scrollTops.clear()
  for (const [path, top] of Object.entries(entries)) scrollTops.set(path, top)
}

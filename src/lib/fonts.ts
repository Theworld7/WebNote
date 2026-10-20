import { isTauriRuntime } from "./fs"

/**
 * 系统字体：列表从哪儿读，以及用户选中的 family 怎么落成 CSS 栈。
 *
 * 列表三条路，按环境退化：桌面端问 Rust（`list_system_fonts`，fontdb 扫系统字体）；
 * 浏览器调试试 Local Font Access API；都不行就给一份内置候选 —— 调试页也要能选，
 * 不能空着。
 *
 * 栈只有一处真源：style.css 的 `@theme`。用户选了字体，拼出来的值是
 * `"Family", <系统栈>`，系统栈**从 CSS 变量的原值读一次**再缓存，
 * 不在 JS 里复制第二份 —— 否则哪天改 typography 的系统栈要改两个地方。
 */

/** 内容字体 / 代码字体对应的 CSS 变量名。设置面板与 useSettings 共用这两个常量。 */
export const CONTENT_FONT_VAR = "--font-sans"
export const CODE_FONT_VAR = "--font-mono"

export type FontFaceKind = "content" | "code"

/** 该往哪个变量写、读不到基线栈时用哪个通用族兜底。 */
const VARS: Readonly<Record<FontFaceKind, { variable: string; generic: string }>> = {
  content: { variable: CONTENT_FONT_VAR, generic: "sans-serif" },
  code: { variable: CODE_FONT_VAR, generic: "monospace" },
}

/**
 * 基线栈缓存。
 *
 * **必须在偏好生效之前读**：偏好写的就是同一个变量的内联覆盖，覆盖之后再读
 * computed 会把它当成基线拼进去（`"B", "A", <系统栈>`）。所以每个变量只读一次。
 */
const baseCache = new Map<string, string>()

function baseStack(kind: FontFaceKind): string {
  const { variable } = VARS[kind]
  const cached = baseCache.get(variable)
  if (cached !== undefined) return cached
  const value = window.getComputedStyle(document.documentElement).getPropertyValue(variable).trim()
  baseCache.set(variable, value)
  return value
}

/** 当前生效的栈（computed，可能已经是用户覆盖后的值）。预览与 Monaco 要的是它。 */
export function currentFontStack(kind: FontFaceKind): string {
  return window.getComputedStyle(document.documentElement).getPropertyValue(VARS[kind].variable).trim()
}

/**
 * `""` 表示「用系统默认」—— 返回空串，调用方据此移除内联变量。
 * 用户字体名后面接系统栈：字形缺失的中文仍由系统字体接手，不会掉到浏览器默认衬线。
 */
export function fontStack(family: string, kind: FontFaceKind): string {
  if (family === "") return ""
  const { generic } = VARS[kind]
  const quoted = `"${family.replaceAll('"', "")}"`
  const base = baseStack(kind)
  return base === "" ? `${quoted}, ${generic}` : `${quoted}, ${base}`
}

/** 只用于预览单个 family 的字形：不拼系统栈，缺字就交给通用族。 */
export function previewFontStack(family: string, kind: FontFaceKind): string {
  return family === "" ? "" : `"${family.replaceAll('"', "")}", ${VARS[kind].generic}`
}

/** 去空、忽略大小写去重、按字母序。三路来源共用这一套收尾。 */
function normalizeFontNames(names: readonly string[]): string[] {
  const seen = new Set<string>()
  const result: string[] = []
  for (const name of names) {
    const trimmed = name.trim()
    if (trimmed === "") continue
    const key = trimmed.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    result.push(trimmed)
  }
  return result.sort((left, right) => left.localeCompare(right, "en"))
}

/**
 * 浏览器调试用的候选表。桌面端不该走到这里 —— 走到了说明 Rust 命令不可用
 * （比如 `pnpm dev` 或老版本壳），给一批常见的即可，不是「系统字体全集」。
 */
const BUILTIN_FONTS: readonly string[] = [
  "Microsoft YaHei",
  "SimSun",
  "SimHei",
  "KaiTi",
  "FangSong",
  "Segoe UI",
  "Calibri",
  "Arial",
  "Helvetica",
  "Verdana",
  "Tahoma",
  "Georgia",
  "Times New Roman",
  "Courier New",
  "Consolas",
  "Cascadia Mono",
  "Cascadia Code",
  "PingFang SC",
  "Menlo",
  "Monaco",
  "SF Mono",
  "JetBrains Mono",
  "Fira Code",
  "Source Code Pro",
  "Noto Sans SC",
  "Noto Serif SC",
]

/**
 * 从 `window` 上取 `queryLocalFonts`。这个 API 不在 TS 的 DOM lib 里，
 * 直接调过不了类型门；项目禁断言，所以取成 unknown 再自己收窄。
 */
function readLocalFontQuery(): (() => Promise<unknown>) | null {
  const candidate: unknown = Reflect.get(window, "queryLocalFonts")
  if (typeof candidate !== "function") return null
  return () => Promise.resolve(Reflect.apply(candidate, window, []))
}

/** `queryLocalFonts()` 返回 FontData[]，只取 family 名。 */
function familiesOf(list: unknown): string[] {
  if (!Array.isArray(list)) return []
  const names: string[] = []
  for (const entry of list) {
    if (typeof entry !== "object" || entry === null) continue
    const family: unknown = Reflect.get(entry, "family")
    if (typeof family === "string") names.push(family)
  }
  return names
}

async function listFromTauri(): Promise<string[]> {
  const { invoke } = await import("@tauri-apps/api/core")
  const names: unknown = await invoke("list_system_fonts")
  if (!Array.isArray(names)) return []
  return names.filter((item): item is string => typeof item === "string")
}

async function listFromBrowser(): Promise<string[]> {
  const query = readLocalFontQuery()
  if (query === null) return [...BUILTIN_FONTS]
  try {
    return familiesOf(await query())
  } catch {
    // 用户拒了权限 / 内核不支持：退回候选表，调试点不必因为拿不到全集就卡住。
    return [...BUILTIN_FONTS]
  }
}

/**
 * 本机字体 family 列表（去重排序）。失败一律降级，不抛错 ——
 * 字体列表拿不到不该让设置面板开不出来。
 */
export async function listSystemFonts(): Promise<string[]> {
  if (!isTauriRuntime()) return normalizeFontNames(await listFromBrowser())
  try {
    return normalizeFontNames(await listFromTauri())
  } catch {
    return normalizeFontNames(BUILTIN_FONTS)
  }
}

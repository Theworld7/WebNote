import type { InjectionKey, Ref } from "vue"
import type { FsRoot, WorkspaceFs } from "@/lib/fs"
import type { FontFaceKind } from "@/lib/fonts"
import type { TableEffect, ThemeSettings } from "@/types/workspace"
import { inject, provide, ref, watch } from "vue"
import { CODE_FONT_VAR, CONTENT_FONT_VAR, fontStack } from "@/lib/fonts"
import { minutesOf, THEME_MODES } from "@/lib/theme-mode"

/**
 * 应用设置 —— 用户偏好，与工作区数据完全正交。
 *
 * 这里放的是**看法的开关**，不是笔记的内容：改一个设置不会让任何标签变脏、
 * 不写盘、不进序列化。导出文件必须自包含（能被单独拷走双击打开），读不到
 * `localStorage`，所以设置只驱动编辑器这一侧 —— 导出侧永远是规格里那份规范形态。
 * 这条边界是有意的：把偏好写进笔记文件，同一个文件在两台机器上就会长得不一样，
 * 「往返一致」这条不变量先碎。
 *
 * 与 `useResizableWidth` 同一套持久化口径：一个 `webnote:` 前缀的键、一个默认值
 * 常量、读取时防御性解析（值坏了就退回默认，不抛错）。
 *
 * 在 localStorage 之外，偏好还会随工作区落一份到根目录的 `webnote.json`
 * （`attachStore` 接上后生效）—— localStorage 跟浏览器走，配置文件跟目录走，
 * 两边由同一份内存值喂，永远说同一句话。配置文件只在「有工作区」时读写；
 * 文件的宽容解析走同一套候选表，不会把坏值灌进内存。
 *
 * `TableEffect` 本身定义在 `@/types/workspace`（与其它领域类型同处），这里只是消费它。
 */
export type { TableEffect }

const TABLE_EFFECT_KEY = "webnote:table-effect"
const DEFAULT_TABLE_EFFECT: TableEffect = "wrap"

/**
 * 读取时校验，而不是相信存进去的东西。
 *
 * `localStorage` 是用户可改的、也可能留着上一版的值：类型不是窄到合法值就退回默认。
 * 这里不用类型断言 —— 项目禁用断言，改成用 `includes` 在候选表上做运行期收窄。
 */
const TABLE_EFFECTS: readonly TableEffect[] = ["wrap", "scroll"]

function readTableEffect(): TableEffect {
  const raw = window.localStorage.getItem(TABLE_EFFECT_KEY)
  if (raw === null) return DEFAULT_TABLE_EFFECT
  const found = TABLE_EFFECTS.find((value) => value === raw)
  return found ?? DEFAULT_TABLE_EFFECT
}

/**
 * 内容宽度 —— 正文列（编辑器里那列块）的最大宽度，三档。
 * 档位存字符串 id 而不是像素值：像素只是各档的属性，落在下面的映射表里，
 * 改档位像素时不用动存储格式，旧值也永远合法。
 *
 * 类型放在这里而不是 `@/types/workspace`：与 `TableEffect` 的判据一致 —— 那边进
 * types 是因为 `lib/typography.ts` 要消费它；这里只有组件消费，没有 lib 依赖。
 */
export type ContentWidth = "narrow" | "standard" | "wide"

const CONTENT_WIDTH_KEY = "webnote:content-width"
const DEFAULT_CONTENT_WIDTH: ContentWidth = "standard"

/** 各档的正文列最大宽度（px）。`standard` 就是这个偏好出现之前写死的 800px。 */
export const CONTENT_WIDTH_PX: Readonly<Record<ContentWidth, number>> = {
  narrow: 640,
  standard: 800,
  wide: 1000,
}

const CONTENT_WIDTHS: readonly ContentWidth[] = ["narrow", "standard", "wide"]

function readContentWidth(): ContentWidth {
  const raw = window.localStorage.getItem(CONTENT_WIDTH_KEY)
  if (raw === null) return DEFAULT_CONTENT_WIDTH
  const found = CONTENT_WIDTHS.find((value) => value === raw)
  return found ?? DEFAULT_CONTENT_WIDTH
}

/**
 * 块菜单分组的排布方向。与 `ContentWidth` 同一判据：只有组件消费，没有 lib 依赖，
 * 类型就留在本文件。
 */
export type MenuGroupLayout = "vertical" | "horizontal"

const MENU_GROUP_LAYOUT_KEY = "webnote:menu-group-layout"
const DEFAULT_MENU_GROUP_LAYOUT: MenuGroupLayout = "vertical"

const MENU_GROUP_LAYOUTS: readonly MenuGroupLayout[] = ["vertical", "horizontal"]

function readMenuGroupLayout(): MenuGroupLayout {
  const raw = window.localStorage.getItem(MENU_GROUP_LAYOUT_KEY)
  if (raw === null) return DEFAULT_MENU_GROUP_LAYOUT
  const found = MENU_GROUP_LAYOUTS.find((value) => value === raw)
  return found ?? DEFAULT_MENU_GROUP_LAYOUT
}

/**
 * 字体 —— 内容字体与代码字体各一项，值是一个 family 名，空串表示「系统默认」。
 *
 * 存 family 名而不是整条 CSS 栈：栈由 `lib/fonts.ts` 现拼（用户字体 + 系统栈兜底），
 * 系统栈改了旧值不用迁移。名字为空的语义是「没选」，比存一个哨兵字符串干净。
 */
const CONTENT_FONT_KEY = "webnote:content-font"
const CODE_FONT_KEY = "webnote:code-font"

/** family 名的长度上限：容得下任何真实字体名，也挡住把整份 CSS 塞进配置文件的坏值。 */
const FONT_NAME_MAX = 120

function readFontName(key: string): string {
  const raw = window.localStorage.getItem(key)
  if (raw === null) return ""
  return raw.length <= FONT_NAME_MAX ? raw : ""
}

/**
 * 主题 —— 界面配色，整组存成**一个值**（`ThemeSettings`）而不是五个独立偏好。
 *
 * 拆开存会出现「模式选了日出日落、经纬度却是空的」这种半截状态，而它们只在
 * 「现在该是什么配色」这一件事上有意义，没有独立存在的理由。所以这里没有
 * 五个 `webnote:*` 键，只有一条 `webnote:theme`，内容是 JSON。
 *
 * 默认跟随系统：应用本来没有深色，第一次装上时它应当与系统外观一致，而不是
 * 硬塞一套浅色（见 ADR-0014）。
 */
const THEME_KEY = "webnote:theme"

export const DEFAULT_THEME_SETTINGS: ThemeSettings = {
  mode: "system",
  lightAt: "07:00",
  darkAt: "19:00",
  latitude: null,
  longitude: null,
}

/** 单个坐标的收窄：非数字、越界一律归为「没设」，由调用方决定整组是否退回系统时区。 */
function readCoordinate(value: unknown, limit: number): number | null {
  if (typeof value !== "number" || !Number.isFinite(value) || Math.abs(value) > limit) return null
  return value
}

/**
 * 把任意来源（localStorage 的 JSON、`webnote.json` 的字段）收成一份合法的主题偏好。
 * 坏字段各自退回默认，不整组丢弃 —— 用户填错经纬度不该把「跟随系统」也一起弄丢。
 */
function readTheme(source: Record<string, unknown>): ThemeSettings {
  const mode = THEME_MODES.find((item) => item === source["mode"]) ?? DEFAULT_THEME_SETTINGS.mode
  const readTime = (value: unknown, fallback: string): string =>
    typeof value === "string" && minutesOf(value) !== null ? value : fallback

  const latitude = readCoordinate(source["latitude"], 90)
  const longitude = readCoordinate(source["longitude"], 180)
  // 经纬度要么都设、要么都不设：只有一个坐标的日出日落没有意义，退回系统时区。
  const manual = latitude !== null && longitude !== null

  return {
    mode,
    lightAt: readTime(source["lightAt"], DEFAULT_THEME_SETTINGS.lightAt),
    darkAt: readTime(source["darkAt"], DEFAULT_THEME_SETTINGS.darkAt),
    latitude: manual ? latitude : null,
    longitude: manual ? longitude : null,
  }
}

function readThemeSettings(): ThemeSettings {
  const raw = window.localStorage.getItem(THEME_KEY)
  if (raw === null) return { ...DEFAULT_THEME_SETTINGS }
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return { ...DEFAULT_THEME_SETTINGS }
  }
  return isRecord(parsed) ? readTheme(parsed) : { ...DEFAULT_THEME_SETTINGS }
}

/** 两组主题偏好是否逐字段相同。`applyPrefs` 用它决定要不要静默。 */
function sameTheme(left: ThemeSettings, right: ThemeSettings): boolean {
  return (
    left.mode === right.mode &&
    left.lightAt === right.lightAt &&
    left.darkAt === right.darkAt &&
    left.latitude === right.latitude &&
    left.longitude === right.longitude
  )
}

/**
 * 工作区根目录下的应用配置文件。
 *
 * localStorage 跟着浏览器走，换目录 / 换机器就丢了；这份文件让偏好**跟着工作区走**。
 * 文件树之所以看不见它：扫描只认 `.html / .htm / .tbl` 白名单（`lib/fs/policy.ts`），
 * 非笔记、非数据表的文件一律不进树 —— 「不可见」是白名单的既定结果，不靠点名过滤。
 */
export const PREFERENCE_FILE = "webnote.json"

/** 盘上配置文件的形状。字段全可选 —— 宽容读取，缺哪个字段哪个保持现状。 */
interface PreferenceFile {
  tableEffect?: TableEffect
  contentWidth?: ContentWidth
  menuGroupLayout?: MenuGroupLayout
  contentFont?: string
  codeFont?: string
  theme?: ThemeSettings
}

/** 从盘上文本解析偏好。文件坏了 / 字段非法都不抛错，非法字段退回「不覆盖」。 */
function parsePreferenceFile(text: string): PreferenceFile {
  let data: unknown
  try {
    data = JSON.parse(text)
  } catch {
    return {}
  }
  if (!isRecord(data)) return {}
  const source = data
  const pick = <T extends string>(candidates: readonly T[], value: unknown): T | undefined =>
    candidates.find((item) => item === value)
  // 字体名不做候选表收窄（本机字体集因人而异），只卡类型和长度；空串是合法值（系统默认）。
  const pickFont = (value: unknown): string | undefined =>
    typeof value === "string" && value.length <= FONT_NAME_MAX ? value : undefined
  return {
    tableEffect: pick(TABLE_EFFECTS, source["tableEffect"]),
    contentWidth: pick(CONTENT_WIDTHS, source["contentWidth"]),
    menuGroupLayout: pick(MENU_GROUP_LAYOUTS, source["menuGroupLayout"]),
    contentFont: pickFont(source["contentFont"]),
    codeFont: pickFont(source["codeFont"]),
    // 主题是一整个对象：整个字段缺失（旧版写的文件）就保持内存里的现状，
    // 不能拿默认值把用户当前的选择覆盖掉。
    theme: isRecord(source["theme"]) ? readTheme(source["theme"]) : undefined,
  }
}

/** `object` → `Record<string, unknown>` 的收窄守卫。项目禁断言，判型走守卫。 */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null
}

interface Settings {
  /** 表格效果。`ref` 而不是 `reactive`：设置项各自独立，且都会被整体读写。 */
  tableEffect: Ref<TableEffect>
  /** 改设置并落盘。唯一写入口，避免有人绕过持久化直接改 ref。 */
  setTableEffect: (value: TableEffect) => void
  /** 内容宽度（正文列最大宽度档位）。同上，`ref` 且只经 setter 写。 */
  contentWidth: Ref<ContentWidth>
  setContentWidth: (value: ContentWidth) => void
  /** 块菜单分组的排布方向。同上，`ref` 且只经 setter 写。 */
  menuGroupLayout: Ref<MenuGroupLayout>
  setMenuGroupLayout: (value: MenuGroupLayout) => void
  /** 内容字体（正文与界面）。空串 = 系统默认栈。 */
  contentFont: Ref<string>
  setContentFont: (value: string) => void
  /** 代码字体（代码块、行内 code、HTML 抽屉的 Monaco）。空串 = 系统默认栈。 */
  codeFont: Ref<string>
  setCodeFont: (value: string) => void
  /** 界面配色（模式 + 固定时刻 + 经纬度）。整组读写，见 `ThemeSettings`。 */
  theme: Ref<ThemeSettings>
  /** 改主题偏好：合并写，只动 patch 里给出的字段。 */
  setTheme: (patch: Partial<ThemeSettings>) => void
  /**
   * 接上工作区这对 driver / root。接上后工作区根的 `webnote.json`（见
   * `PREFERENCE_FILE`）成为第二份存储：启动 / 换目录时读取并应用，文件内容
   * 与内存全同时静默不动。不接（自检页、未打开目录）则只有 localStorage
   * 一份，行为与从前完全一致。
   */
  attachStore: (driver: Ref<WorkspaceFs | null>, root: Ref<FsRoot | null>) => void
}

function createSettings(): Settings {
  const tableEffect = ref<TableEffect>(readTableEffect())

  function setTableEffect(value: TableEffect) {
    tableEffect.value = value
    window.localStorage.setItem(TABLE_EFFECT_KEY, value)
    void persistToStore()
  }

  const contentWidth = ref<ContentWidth>(readContentWidth())

  function setContentWidth(value: ContentWidth) {
    contentWidth.value = value
    window.localStorage.setItem(CONTENT_WIDTH_KEY, value)
    void persistToStore()
  }

  const menuGroupLayout = ref<MenuGroupLayout>(readMenuGroupLayout())

  function setMenuGroupLayout(value: MenuGroupLayout) {
    menuGroupLayout.value = value
    window.localStorage.setItem(MENU_GROUP_LAYOUT_KEY, value)
    void persistToStore()
  }

  const contentFont = ref(readFontName(CONTENT_FONT_KEY))

  function setContentFont(value: string) {
    contentFont.value = value
    window.localStorage.setItem(CONTENT_FONT_KEY, value)
    void persistToStore()
  }

  const codeFont = ref(readFontName(CODE_FONT_KEY))

  function setCodeFont(value: string) {
    codeFont.value = value
    window.localStorage.setItem(CODE_FONT_KEY, value)
    void persistToStore()
  }

  const theme = ref<ThemeSettings>(readThemeSettings())

  function setTheme(patch: Partial<ThemeSettings>) {
    theme.value = { ...theme.value, ...patch }
    window.localStorage.setItem(THEME_KEY, JSON.stringify(theme.value))
    void persistToStore()
  }

  /**
   * 字体偏好 → CSS 变量。
   *
   * 写的是 `<html>` 的内联样式：优先级高过 `:root` 上的 `@theme` 定义，所以不用重建
   * 样式表；空串就撤掉内联覆盖，回落到系统栈。导出文件不跟随 —— 那边是
   * `lib/typography.ts` 自己的栈，Preference 只驱动编辑器这一侧。
   */
  function applyFontName(name: string, kind: FontFaceKind) {
    const variable = kind === "code" ? CODE_FONT_VAR : CONTENT_FONT_VAR
    const stack = fontStack(name, kind)
    if (stack === "") document.documentElement.style.removeProperty(variable)
    else document.documentElement.style.setProperty(variable, stack)
  }

  // immediate：存过的字体要在首帧就生效，不能等用户再动一次设置。
  watch(contentFont, (name) => applyFontName(name, "content"), { immediate: true })
  watch(codeFont, (name) => applyFontName(name, "code"), { immediate: true })

  /**
   * 工作区侧的读写。`attachStore` 接上前是 null —— 那时偏好只走 localStorage，
   * 这是「没打开目录也想能设置」的退化路径，不是缺功能。
   */
  let storeDriver: Ref<WorkspaceFs | null> | null = null
  let storeRoot: Ref<FsRoot | null> | null = null

  /** 把当前偏好序列化成配置文件文本。全量写，不做「只写非默认值」的省略。 */
  function serializePrefs(): string {
    const file: PreferenceFile = {
      tableEffect: tableEffect.value,
      contentWidth: contentWidth.value,
      menuGroupLayout: menuGroupLayout.value,
      contentFont: contentFont.value,
      codeFont: codeFont.value,
      theme: theme.value,
    }
    return `${JSON.stringify(file, null, 2)}\n`
  }

  /** 把偏好落到 `webnote.json`。写失败静默 —— 偏好不是文档，丢一次下次改动会再写。 */
  async function persistToStore(): Promise<void> {
    if (storeDriver === null || storeRoot === null) return
    const driver = storeDriver.value
    const root = storeRoot.value
    if (driver === null || root === null) return
    storeEpoch++ // 用户主动改设置：作废在途的配置读取，新选择优先于盘上旧值
    try {
      await driver.writeNote(root, PREFERENCE_FILE, serializePrefs())
    } catch {
      // 静默：设置写失败不该弹错误打扰阅读，localStorage 那份仍然生效。
    }
  }

  /** 应用盘上读回的偏好。逐项比对，只动有差异的字段；全同则什么都不碰（静默）。 */
  function applyPrefs(prefs: PreferenceFile): boolean {
    let changed = false
    if (prefs.tableEffect !== undefined && prefs.tableEffect !== tableEffect.value) {
      tableEffect.value = prefs.tableEffect
      window.localStorage.setItem(TABLE_EFFECT_KEY, prefs.tableEffect)
      changed = true
    }
    if (prefs.contentWidth !== undefined && prefs.contentWidth !== contentWidth.value) {
      contentWidth.value = prefs.contentWidth
      window.localStorage.setItem(CONTENT_WIDTH_KEY, prefs.contentWidth)
      changed = true
    }
    if (prefs.menuGroupLayout !== undefined && prefs.menuGroupLayout !== menuGroupLayout.value) {
      menuGroupLayout.value = prefs.menuGroupLayout
      window.localStorage.setItem(MENU_GROUP_LAYOUT_KEY, prefs.menuGroupLayout)
      changed = true
    }
    if (prefs.contentFont !== undefined && prefs.contentFont !== contentFont.value) {
      contentFont.value = prefs.contentFont
      window.localStorage.setItem(CONTENT_FONT_KEY, prefs.contentFont)
      changed = true
    }
    if (prefs.codeFont !== undefined && prefs.codeFont !== codeFont.value) {
      codeFont.value = prefs.codeFont
      window.localStorage.setItem(CODE_FONT_KEY, prefs.codeFont)
      changed = true
    }
    if (prefs.theme !== undefined && !sameTheme(prefs.theme, theme.value)) {
      theme.value = prefs.theme
      window.localStorage.setItem(THEME_KEY, JSON.stringify(prefs.theme))
      changed = true
    }
    return changed
  }

  /**
   * 读写竞争的代币：每次发起读取前 +1，用户主动改设置（落盘）时也 +1。
   * 读回时对不上号，说明读盘期间用户改了设置 —— 盘上那份是旧的，静默丢弃，
   * 用户的新选择赢。没有这个守卫，慢盘上的读取会在落盘后把旧值灌回来。
   */
  let storeEpoch = 0

  function attachStore(driver: Ref<WorkspaceFs | null>, root: Ref<FsRoot | null>): void {
    storeDriver = driver
    storeRoot = root
    // 启动即读取：attachStore 发生在根组件 setup、bootstrap 挑驱动之前，此刻 root
    // 还是 null，真正的首次读取由 bootstrap 恢复目录时触发；`immediate` 兜的是
    // 「root 先于接线就绪」的调用序，让「启动读取」不依赖接线顺序。文件不存在
    // （首次打开这个目录）是正常路径，保持 localStorage 里的现状即可。
    watch(
      root,
      (current) => {
        const workspaceDriver = driver.value
        if (workspaceDriver === null || current === null) return
        const epoch = ++storeEpoch
        void workspaceDriver
          .readNote(current, PREFERENCE_FILE)
          .then((text) => {
            if (epoch !== storeEpoch) return // 读期间用户改了设置，盘上这份作废
            // 文件与内存全同时 applyPrefs 内部静默 —— 不碰 ref、不写 localStorage、
            // 不触发任何订阅了设置的副作用。
            applyPrefs(parsePreferenceFile(text))
          })
          .catch(() => {})
      },
      { immediate: true },
    )
  }

  return {
    tableEffect,
    setTableEffect,
    contentWidth,
    setContentWidth,
    menuGroupLayout,
    setMenuGroupLayout,
    contentFont,
    setContentFont,
    codeFont,
    setCodeFont,
    theme,
    setTheme,
    attachStore,
  }
}

export type { Settings }

const SETTINGS_KEY: InjectionKey<Settings> = Symbol("webnote-settings")

/** 在 App.vue 调用一次；子树里用 `useSettings()` 取同一份状态。 */
export function provideSettings(): Settings {
  const settings = createSettings()
  provide(SETTINGS_KEY, settings)
  return settings
}

export function useSettings(): Settings {
  const settings = inject(SETTINGS_KEY)
  if (!settings) throw new Error("useSettings() 必须在 provideSettings() 的子树内调用")
  return settings
}

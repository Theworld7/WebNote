import type { InjectionKey, Ref } from "vue"
import type { TableEffect } from "@/types/workspace"
import { inject, provide, ref } from "vue"

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

interface Settings {
  /** 表格效果。`ref` 而不是 `reactive`：设置项各自独立，且都会被整体读写。 */
  tableEffect: Ref<TableEffect>
  /** 改设置并落盘。唯一写入口，避免有人绕过持久化直接改 ref。 */
  setTableEffect: (value: TableEffect) => void
  /** 内容宽度（正文列最大宽度档位）。同上，`ref` 且只经 setter 写。 */
  contentWidth: Ref<ContentWidth>
  setContentWidth: (value: ContentWidth) => void
}

function createSettings(): Settings {
  const tableEffect = ref<TableEffect>(readTableEffect())

  function setTableEffect(value: TableEffect) {
    tableEffect.value = value
    window.localStorage.setItem(TABLE_EFFECT_KEY, value)
  }

  const contentWidth = ref<ContentWidth>(readContentWidth())

  function setContentWidth(value: ContentWidth) {
    contentWidth.value = value
    window.localStorage.setItem(CONTENT_WIDTH_KEY, value)
  }

  return { tableEffect, setTableEffect, contentWidth, setContentWidth }
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

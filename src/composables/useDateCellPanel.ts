import type { Ref } from "vue"
import type { DataColumn, DataRow } from "@/types/data-table"
import { onBeforeUnmount, onMounted, ref, watch } from "vue"
import { placeBelow, watchScrollHosts } from "@/lib/floating"
import * as dt from "@/lib/data-table"
import { parseDateKey, shiftDays, shiftMonths, todayKey, weekEnd, weekStart } from "@/lib/date-key"

/**
 * 日期格的下拉月历 —— 账目行与看板卡共用的那一块浮层状态。
 *
 * 只管「面板挂着没有、钉在哪、键盘高亮停在哪天、点中的那天写成什么」，月历本身在
 * `DateCalendar`，落位与滚动订阅在 `lib/floating`。两处视图各写一遍的代价是同一套
 * 焦点陷阱要重新推演一次，所以收在这里。
 *
 * 不用 Popover 那套:它的 FocusScope 在关闭时会把焦点从输入框挪走(还给 trigger,
 * trigger 不存在就落回 body)—— 输入框的 blur 一触发就提交并退出编辑态,紧接着面板
 * 与被编辑的格一起消失,点中的那一天根本落不进表里。日期面板要的是「一个跟着输入框
 * 走的浮层」而不是「一个弹窗」,所以这里只记位置,焦点**始终留在输入框**:
 * 面板上所有 mousedown 都 prevent(见调用方模板),点日期不会让输入框失焦。
 *
 * 键盘也因此挂在输入框上(与 `OptionCell` 同一套模型):方向键移高亮、回车确认,
 * 焦点一次都不离开那一格 —— 一旦离开就是 blur,面板与编辑态会一起消失。
 */

/** 面板状态。`null` = 没展开。 */
interface DatePanel {
  rowId: string
  columnId: string
  top: number
  left: number
  /** 打开那一刻的值,给日历定初始月份与选中态。 */
  value: string
  /** 键盘高亮停在哪一天。打开时落在格里的值上(空格子落在今天)。 */
  focus: string
  /** 用户用方向键挪过高亮没有 —— 决定回车是「确认这一天」还是照旧提交输入框。 */
  moved: boolean
}

/** 面板用到的格子能力 —— `CellEditing` 的子集,取它是因为这里不碰 tab 跳格与勾选。 */
export interface DatePanelCells {
  /** 正在编辑的格:面板只在它的格退出编辑态时收起。 */
  editing: Ref<string>
  cellKey(row: DataRow, column: DataColumn): string
  commit(row: DataRow, column: DataColumn, raw: string): void
  commitOnBlur(row: DataRow, column: DataColumn, event: Event): void
}

/** 面板开着时表可能已经变过,所以要按 id 从**当前**表里重取行与列。 */
export interface DatePanelSource {
  rows(): readonly DataRow[]
  columns(): readonly DataColumn[]
}

export interface DateCellPanel {
  /** 展开中的面板,`null` = 没展开。模板里直接 `panel !== null`。 */
  panel: Ref<DatePanel | null>
  /** 输入框聚焦 / 点开时调 —— 位置钉在这个输入框下面。 */
  open(row: DataRow, column: DataColumn, event: Event): void
  close(): void
  /** 选中一天(`YYYY-MM-DD`)或清除(空串)。 */
  pick(value: string): void
  /** 失焦:先收面板(点表格别处 / 点正文都会走到这里),再提交这一格。 */
  blur(row: DataRow, column: DataColumn, event: Event): void
  /**
   * 面板开着时的按键。返回 true = 这个键归月历,调用方别再当普通输入处理。
   * 面板没开或按键与月历无关(打字、退格)一律 false,输入框照常工作。
   */
  keydown(event: KeyboardEvent): boolean
}

const PANEL_WIDTH = 232
const PANEL_HEIGHT = 272

export function useDateCellPanel(cells: DatePanelCells, source: DatePanelSource): DateCellPanel {
  const panel = ref<DatePanel | null>(null)

  /** 滚动订阅。同一时刻只有一个浮层开着,状态就挂在开它的这一处。 */
  let stopScroll: (() => void) | null = null

  /**
   * 把面板钉在输入框下面。
   *
   * 浮层 `fixed` 且挂在 body 上:调用方的表格 / 看板横排外面都是 `overflow-x-auto`,
   * 垂直方向同样被那个滚动容器截住,浮在格里的面板在靠下的几行会被裁掉。
   */
  function open(row: DataRow, column: DataColumn, event: Event): void {
    const target = event.target
    if (!(target instanceof HTMLInputElement)) return
    const { top, left } = placeBelow(target.getBoundingClientRect(), { height: PANEL_HEIGHT, width: PANEL_WIDTH })
    const value = dt.valueText(dt.cellValue(row, column), column)
    panel.value = {
      rowId: row.id,
      columnId: column.id,
      top,
      left,
      value,
      // 空格子从今天起跳:让方向键立刻有落点,而不是停在一个不存在的日子上。
      focus: parseDateKey(value) === null ? todayKey() : value,
      moved: false,
    }
    // 换格时上一个订阅先解除,否则旧的 close 会继续挂在滚动容器上。
    stopScroll?.()
    stopScroll = watchScrollHosts(target, close)
  }

  function close(): void {
    stopScroll?.()
    stopScroll = null
    panel.value = null
  }

  /**
   * 选中一天:写进格、收起面板,但**留在编辑态** —— 用户选完日期往往紧接着要改同一行的
   * 别的格,这时退出编辑会让焦点与滚动位置都跳一下。焦点一直在输入框里,所以这里什么都不用搬。
   */
  function pick(value: string): void {
    const current = panel.value
    if (current === null) return
    close()
    const row = source.rows().find((item) => item.id === current.rowId)
    const column = source.columns().find((item) => item.id === current.columnId)
    if (row === undefined || column === undefined) return
    cells.commit(row, column, value)
  }

  function blur(row: DataRow, column: DataColumn, event: Event): void {
    close()
    cells.commitOnBlur(row, column, event)
  }

  /**
   * 方向键在月历上挪一格 / 一周 / 一月 —— 与日历的排布对齐:左右一天、上下七天、
   * `PageUp/Down` 翻月、`Home/End` 到本周首尾。越界不用拦,`shiftDays` 自己跨月跨年。
   */
  function stepKey(focus: string, key: string): string | null {
    switch (key) {
      case "ArrowLeft":
        return shiftDays(focus, -1)
      case "ArrowRight":
        return shiftDays(focus, 1)
      case "ArrowUp":
        return shiftDays(focus, -7)
      case "ArrowDown":
        return shiftDays(focus, 7)
      case "PageUp":
        return shiftMonths(focus, -1)
      case "PageDown":
        return shiftMonths(focus, 1)
      case "Home":
        return weekStart(focus)
      case "End":
        return weekEnd(focus)
      default:
        return null
    }
  }

  function keydown(event: KeyboardEvent): boolean {
    const current = panel.value
    if (current === null) return false

    const next = stepKey(current.focus, event.key)
    if (next !== null) {
      // 不拦的话方向键会在输入框里挪光标,高亮却动了 —— 两种「移动」同时发生。
      event.preventDefault()
      panel.value = { ...current, focus: next, moved: true }
      return true
    }

    if (event.key !== "Enter") return false

    // 没挪过高亮时回车保持原意(账目里是「提交 + 跳下一行同列」,录一列账靠它)。
    if (!current.moved) return false

    // 手敲了别的日期时同理:回车提交输入框里的字,别换成高亮那一天。
    const target = event.target
    if (target instanceof HTMLInputElement && target.value !== current.value) return false

    event.preventDefault()
    pick(current.focus)
    return true
  }

  // 回车跳格时不会走 blur —— 面板若还挂着,就是悬在旧格下面的一块浮层。
  watch(cells.editing, (key) => {
    const current = panel.value
    if (current === null) return
    if (`${current.rowId}:${current.columnId}` !== key) close()
  })

  // 窗口一改大小,面板就跟格子的位置对不上了 —— 与其漂着,不如收起来,再点一下就回来。
  function onResize(): void {
    close()
  }

  onMounted(() => {
    window.addEventListener("resize", onResize)
  })

  onBeforeUnmount(() => {
    stopScroll?.()
    window.removeEventListener("resize", onResize)
  })

  return { panel, open, close, pick, blur, keydown }
}

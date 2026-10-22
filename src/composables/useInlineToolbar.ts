import type { InlineMark, InlineRun, LinkShape } from "@/types/workspace"
import type { OffsetRange } from "@/lib/marks"
import { onBeforeUnmount, onMounted, ref } from "vue"
import { isCrossSelecting } from "@/lib/crossselect"
import { applyColorAt, applyLinkAt, colorAt, linkAt, linkSpanAt, marksAt, offsetRangeIn, paintRuns, rangeForOffsets, textIn, toggleMarkAt } from "@/lib/marks"

/** 浮条显示状态。坐标是视口坐标，浮条以此为底部中心点。 */
export interface ToolbarState {
  marks: InlineMark[]
  link: boolean
  /** 选区起点处的文本颜色；默认色为 null。 */
  color: string | null
  top: number
  left: number
}

/**
 * 链接浮层的编辑状态。range 是打开那一刻的选区快照 —— 浮层里的输入框会拿走
 * 焦点，真正的选区早没了，确认时按这份快照改 runs。
 *
 * 落在已有链接上时 range 已被扩到整条链接（见 `linkSpanAt`），`text` 是它的
 * 显示内容；新建链接时两者都只覆盖选中的那一段。
 */
export interface LinkEditState {
  range: OffsetRange
  href: string
  text: string
  shape: LinkShape
  top: number
  left: number
}

/**
 * 行内格式浮条的编排：选区监听、显隐、标记切换与链接编辑。
 *
 * 正文块（BlockItem）与表格单元格（TableCellEditor）共用这一套 —— 两者的正文
 * 同为 runs，差别只在「元素是谁、runs 从哪读、写回哪儿」，参数化即可，不复制。
 *
 * 监听是 document 级的，每个使用方常驻两个（selectionchange + 捕获阶段 scroll）；
 * 一张表格几十个格子也就是几十份，回调首行 `activeElement` 比较早退，开销 O(1)。
 * 滚动即收起的原因：浮条是 fixed 定位，文字跟着内容走，与其追着重算位置，不如
 * 等下一次选区变化（用户松手、再选）自然回来。
 */
export function useInlineToolbar(options: {
  /** 承载选区的可编辑元素。 */
  target: () => HTMLElement | null
  /** 当前生效的 runs。事件回调里现取，天然拿到最新值。 */
  getRuns: () => readonly InlineRun[]
  /** 把新 runs 写回数据。 */
  commit: (runs: InlineRun[]) => void
}) {
  /** 浮条显示状态，null 表示不显示。 */
  const toolbar = ref<ToolbarState | null>(null)
  const linkEdit = ref<LinkEditState | null>(null)

  /** 收起格式条（滚动、选区消失等场景）。 */
  function hideToolbar() {
    toolbar.value = null
    linkEdit.value = null
  }

  /**
   * 选区变化时决定格式条露不露面。
   *
   * document 级的 selectionchange 每个使用方都会收到，开头几道判断要尽量便宜：
   * 焦点不在本元素就立刻返回。跨元素选区由 `offsetRangeIn` 里的 contains 挡掉 ——
   * 两端不可能同时落在同一个可编辑体里。
   */
  function refreshToolbar() {
    // 跨块选区进行中不浮出来：原生选区被钳在首块里，浮条在那儿出现是错的（见 crossselect.ts）。
    if (isCrossSelecting()) {
      toolbar.value = null
      return
    }

    const element = options.target()
    if (element === null || document.activeElement !== element) {
      toolbar.value = null
      return
    }

    const range = offsetRangeIn(element)
    const selection = window.getSelection()
    if (range === null || selection === null || selection.rangeCount === 0) {
      toolbar.value = null
      return
    }

    const rect = selection.getRangeAt(0).getBoundingClientRect()
    if (rect.width === 0 && rect.height === 0) {
      toolbar.value = null
      return
    }

    toolbar.value = {
      marks: marksAt(options.getRuns(), range.start),
      link: linkAt(options.getRuns(), range.start) !== null,
      color: colorAt(options.getRuns(), range.start),
      top: rect.top - 8,
      left: rect.left + rect.width / 2,
    }
  }

  /** 把新的 runs 画回 DOM、复原选区，再刷新格式条的激活态。 */
  function paint(runs: readonly InlineRun[], range: OffsetRange) {
    const element = options.target()
    if (element === null) return
    paintRuns(element, runs, range)
    refreshToolbar()
  }

  /** 对当前选区切换一个行内标记。浮条按钮与快捷键共用这一条路。 */
  function applyMark(mark: InlineMark) {
    const element = options.target()
    if (element === null) return

    const range = offsetRangeIn(element)
    if (range === null) return

    const runs = toggleMarkAt(options.getRuns(), range, mark)
    options.commit(runs)
    paint(runs, range)
  }

  /** 对当前选区设置文本颜色，null 回默认色。色板按钮共用这一条路。 */
  function applyColor(color: string | null) {
    const element = options.target()
    if (element === null) return

    const range = offsetRangeIn(element)
    if (range === null) return

    const runs = applyColorAt(options.getRuns(), range, color)
    options.commit(runs)
    paint(runs, range)
  }

  /** 打开链接浮层：记下选区快照与回显值。已有链接按整条链接取，不只是选中那半截。 */
  function openLink() {
    const element = options.target()
    const current = toolbar.value
    if (element === null || current === null) return

    const selection = offsetRangeIn(element)
    if (selection === null) return

    const runs = options.getRuns()
    const range = linkSpanAt(runs, selection)
    const link = linkAt(runs, range.start)
    linkEdit.value = {
      range,
      href: link?.href ?? "",
      text: textIn(runs, range),
      shape: link?.shape ?? "text",
      top: current.top,
      left: current.left,
    }
  }

  /**
   * 浮层确认：改显示内容、地址与形态。空地址表示移除链接（文字留着）。
   * 改完按新长度把选区还给正文 —— 文字可能变长变短，旧区间不再指同一段。
   */
  function applyLink(text: string, href: string, shape: LinkShape) {
    const edit = linkEdit.value
    if (edit === null || text.trim() === "") return

    const runs = applyLinkAt(options.getRuns(), edit.range, href === "" ? null : href, shape, text)
    options.commit(runs)
    linkEdit.value = null
    paint(runs, { start: edit.range.start, end: edit.range.start + text.length })
  }

  /**
   * 取消编辑：一个字都不改。
   *
   * `restoreFocus` 为真（Esc、取消按钮）时把焦点与选区还给正文，用户能接着打字；
   * 点到别处（浮层被外部点击收起）则为假 —— 那时焦点已经由那次点击决定了，再抢
   * 回来只会把光标从用户刚点的地方挪走。
   */
  function cancelLink(restoreFocus = true) {
    const edit = linkEdit.value
    linkEdit.value = null
    if (edit === null || !restoreFocus) return

    const element = options.target()
    if (element === null) return

    element.focus()
    const restored = rangeForOffsets(element, edit.range)
    const selection = window.getSelection()
    if (restored !== null && selection !== null) {
      selection.removeAllRanges()
      selection.addRange(restored)
    }
    refreshToolbar()
  }

  /**
   * 页面滚动时收起浮条与浮层。
   *
   * 捕获阶段的 scroll 能收到**任何**元素上的滚动，包括浮层里输入框自己的横向滚动：
   * 粘一个长地址进去，浏览器会把插入符滚进视野，输入框一滚就把浮层收掉 —— 正打着字
   * 面板突然没了。那是面板内部的位移，跟正文在视口里的位置无关，放它过去。
   */
  function onScroll(event: Event) {
    const target = event.target
    if (target instanceof Element && target.closest("[data-link-popover]") !== null) return
    hideToolbar()
  }

  onMounted(() => {
    document.addEventListener("selectionchange", refreshToolbar)
    // 捕获阶段：滚动发生在内层滚动容器里，不冒泡到 document。
    document.addEventListener("scroll", onScroll, true)
  })

  onBeforeUnmount(() => {
    document.removeEventListener("selectionchange", refreshToolbar)
    document.removeEventListener("scroll", onScroll, true)
  })

  return { toolbar, linkEdit, refreshToolbar, hideToolbar, applyMark, applyColor, openLink, applyLink, cancelLink }
}

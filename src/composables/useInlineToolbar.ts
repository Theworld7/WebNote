import type { InlineMark, InlineRun, LinkShape } from "@/types/workspace"
import type { OffsetRange } from "@/lib/marks"
import { onBeforeUnmount, onMounted, ref } from "vue"
import { applyLinkAt, linkAt, marksAt, offsetRangeIn, paintRuns, toggleMarkAt } from "@/lib/marks"

/** 浮条显示状态。坐标是视口坐标，浮条以此为底部中心点。 */
export interface ToolbarState {
  marks: InlineMark[]
  link: boolean
  top: number
  left: number
}

/**
 * 链接浮层的编辑状态。range 是打开那一刻的选区快照 —— 浮层里的输入框会拿走
 * 焦点，真正的选区早没了，确认时按这份快照改 runs。
 */
export interface LinkEditState {
  range: OffsetRange
  href: string
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

  /** 打开链接浮层：记下选区快照与回显值。 */
  function openLink() {
    const element = options.target()
    const current = toolbar.value
    if (element === null || current === null) return

    const range = offsetRangeIn(element)
    if (range === null) return

    const link = linkAt(options.getRuns(), range.start)
    linkEdit.value = {
      range,
      href: link?.href ?? "",
      shape: link?.shape ?? "text",
      top: current.top,
      left: current.left,
    }
  }

  /** 浮层确认。空地址表示移除链接；改完把焦点与选区还给正文。 */
  function applyLink(href: string, shape: LinkShape) {
    const edit = linkEdit.value
    if (edit === null) return

    const runs = applyLinkAt(options.getRuns(), edit.range, href === "" ? null : href, shape)
    options.commit(runs)
    linkEdit.value = null
    paint(runs, edit.range)
  }

  onMounted(() => {
    document.addEventListener("selectionchange", refreshToolbar)
    // 捕获阶段：滚动发生在内层滚动容器里，不冒泡到 document。
    document.addEventListener("scroll", hideToolbar, true)
  })

  onBeforeUnmount(() => {
    document.removeEventListener("selectionchange", refreshToolbar)
    document.removeEventListener("scroll", hideToolbar, true)
  })

  return { toolbar, linkEdit, refreshToolbar, hideToolbar, applyMark, openLink, applyLink }
}

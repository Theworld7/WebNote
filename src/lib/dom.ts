/**
 * contenteditable 的焦点与光标工具。
 *
 * 这里刻意用 `instanceof` 做类型收窄，而不是 `as HTMLElement` —— 项目禁用类型断言。
 */

/**
 * 跨组件约定的 DOM 属性名。
 *
 * 这几个属性是**组件之间的契约**：写入方（`BlockItem` / `BlockToolbar` /
 * `TableCellEditor` / `MermaidBlockView`）挂上它们，读取方（`BlockEditor` 的拖拽与粘贴
 * 落点、本模块的查找函数）靠选择器找到元素。属性名写错不会有编译错误，表现是
 * 「拖不动 / 聚焦没反应」—— 所以名字必须只有一处，读写双方都从这里取。
 */
export const DOM_ATTR = {
  /** 块根节点，值为块 id。 */
  blockId: "data-block-id",
  /** 拖拽手柄，值恒为 `"true"`（只要存在就够了）。 */
  dragHandle: "data-drag-handle",
  /** 可编辑体，值为块 id（表格格子是 `块id/行/列`）。 */
  editable: "data-editable",
} as const

/** 所有块根节点。遍历它算落点、量几何。 */
export const BLOCK_ROW_SELECTOR = `[${DOM_ATTR.blockId}]`

/** 拖拽手柄。只有手柄发起的 dragstart 才算块排序。 */
export const DRAG_HANDLE_SELECTOR = `[${DOM_ATTR.dragHandle}]`

/** 表格格子的可编辑体键：一个表格块里有多个可编辑体，只用块 id 定位不到具体格子。 */
export function tableCellKey(blockId: string, row: number, column: number): string {
  return `${blockId}/${row}/${column}`
}

/**
 * 从任意后代元素向上找它所属的块 id。
 *
 * `BlockEditor` 的拖拽起点与粘贴落点都要做同一件事（向上找块、取 id、再查下标），
 * 这里收成一处 —— 调用方只需处理「没找到」。
 */
export function closestBlockId(el: Element): string | null {
  const row = el.closest(BLOCK_ROW_SELECTOR)
  if (row === null) return null
  const id = row.getAttribute(DOM_ATTR.blockId)
  return id === null || id === "" ? null : id
}

/**
 * 把光标放到可编辑元素的首 / 尾。
 *
 * 表单元素单走一条：`textarea` / `input` 的光标由浏览器按 `selectionStart` 管，
 * 对它调 Range API 是另一套机制，会打断它自己的光标位置。
 */
export function focusEditable(el: HTMLElement, at: "start" | "end" = "end") {
  el.focus()
  if (el instanceof HTMLTextAreaElement || el instanceof HTMLInputElement) {
    const position = at === "start" ? 0 : el.value.length
    el.setSelectionRange(position, position)
    return
  }
  const range = document.createRange()
  range.selectNodeContents(el)
  range.collapse(at === "start")
  const selection = window.getSelection()
  if (selection === null) return
  selection.removeAllRanges()
  selection.addRange(range)
}

/**
 * 按块 id 找到块的可编辑体。
 *
 * 返回的不一定是 contenteditable 元素 —— mermaid 块的源码框是个 `textarea`。
 * 两种都由 `focusEditable` 统一接管。
 *
 * 块 id 由 `createBlockId()` 生成，只含字母数字，无需转义。
 */
export function findEditable(blockId: string): HTMLElement | null {
  const el = document.querySelector(editableSelector(blockId))
  return el instanceof HTMLElement ? el : null
}

/**
 * 按行列找到表格单元格。
 *
 * 单元格的 `data-editable` 写成 `块id/行/列`：一个表格块里有多个可编辑体，
 * 只用块 id 定位不到具体格子。三个值都只含字母数字，属性选择器不必转义。
 */
export function findTableCell(blockId: string, row: number, column: number): HTMLElement | null {
  const el = document.querySelector(editableSelector(tableCellKey(blockId, row, column)))
  return el instanceof HTMLElement ? el : null
}

/** 可编辑体的选择器。键由调用方给 —— 块 id，或表格格子的 `块id/行/列`。 */
function editableSelector(key: string): string {
  return `[${DOM_ATTR.editable}="${key}"]`
}

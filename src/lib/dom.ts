/**
 * contenteditable 的焦点与光标工具。
 *
 * 这里刻意用 `instanceof` 做类型收窄，而不是 `as HTMLElement` —— 项目禁用类型断言。
 */

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
  const el = document.querySelector(`[data-editable="${blockId}"]`)
  return el instanceof HTMLElement ? el : null
}

/**
 * 按行列找到表格单元格。
 *
 * 单元格的 `data-editable` 写成 `块id/行/列`：一个表格块里有多个可编辑体，
 * 只用块 id 定位不到具体格子。三个值都只含字母数字，属性选择器不必转义。
 */
export function findTableCell(blockId: string, row: number, column: number): HTMLElement | null {
  const el = document.querySelector(`[data-editable="${blockId}/${row}/${column}"]`)
  return el instanceof HTMLElement ? el : null
}

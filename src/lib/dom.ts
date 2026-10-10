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

/**
 * `data-*` 属性名的**两种写法**必须同时给出。
 *
 * `dataset` 侧是 camelCase（`dataset.treePath`），选择器侧必须是 kebab-case
 * （`[data-tree-path]`）—— 浏览器把属性名转小写，写 `[dataTreePath]` 永远选不中，
 * 而这种事**没有编译错误**，表现只是「拖拽没反应」。所以两处都从这里取，不手写。
 */
function dataAttr(name: string): { selector: string; dataset: string } {
  const kebab = `data-${name.replace(/[A-Z]/g, (ch) => `-${ch.toLowerCase()}`)}`
  return { selector: kebab, dataset: name }
}

const TREE_PATH = dataAttr("treePath")
const TREE_KIND = dataAttr("treeKind")

/**
 * 文件树的拖拽契约。与 `DOM_ATTR` 分开：那是块编辑器的私有属性，两组混用会让
 * 「树行的选择器」与「块的选择器」互相误命中（两者都靠 `closest` 向上找）。
 *
 * 值放 `data-*` 由 `dataset` 读，**不进 CSS 选择器** —— 工作区路径里含 ` / ` 与中文，
 * 属性选择器的转义规则（`CSS.escape`）在这种值上很容易写错，而这里只需要「找到行」，
 * 值本身用 JS 读出来即可。
 */
export const TREE_ATTR = {
  /** 树行（文件夹行与文件行都有），值是该节点的工作区路径。 */
  path: TREE_PATH,
  /** 树行的种类：`folder` 或 `file`。落点判定据此区分。 */
  kind: TREE_KIND,
} as const

/** 树行。拖拽时靠它向上找是哪一行。 */
export const TREE_ROW_SELECTOR = `[${TREE_KIND.selector}]`

/** 从任意后代元素向上找它所在的树行。找到返回路径与种类，否则 null。 */
export function closestTreeRow(el: Element): { path: string; kind: string } | null {
  const row = el.closest(TREE_ROW_SELECTOR)
  if (!(row instanceof HTMLElement)) return null
  const path = row.dataset[TREE_PATH.dataset]
  const kind = row.dataset[TREE_KIND.dataset]
  if (path === undefined || kind === undefined) return null
  return { path, kind }
}

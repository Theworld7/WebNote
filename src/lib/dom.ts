/**
 * contenteditable 的焦点与光标工具。
 *
 * 这里刻意用 `instanceof` 做类型收窄，而不是 `as HTMLElement` —— 项目禁用类型断言。
 */
import { nextTick } from "vue"

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
  /** 类型菜单里的「块类型选项」，值恒为 `"true"`。位置项、动作项不带它。 */
  typeOption: "data-type-option",
} as const

/** 所有块根节点。遍历它算落点、量几何。 */
export const BLOCK_ROW_SELECTOR = `[${DOM_ATTR.blockId}]`

/**
 * **顶层**块行：只匹配容器的直接子级。
 *
 * 布局块（ADR-0007）的格子里面也是块行，同样挂着 `data-block-id` —— 顶层拖拽
 * 用全量选择器遍历会把格子内的行也算进落点序列，下标对不上顶层文档。算落点
 * 一律用它，`closest`（向上找归属）继续用全量的 `BLOCK_ROW_SELECTOR`。
 */
export const TOP_BLOCK_ROW_SELECTOR = `:scope > [${DOM_ATTR.blockId}]`

/** 拖拽手柄。只有手柄发起的 dragstart 才算块排序。 */
export const DRAG_HANDLE_SELECTOR = `[${DOM_ATTR.dragHandle}]`

/**
 * 类型菜单里的块类型选项。
 *
 * 键盘检索要靠它把「焦点落在用户自己挑的块类型上」和「焦点落在插入位置项上」分开：
 * 前者 Enter 归菜单（点那一项），后者 Enter 得按检索结果落块。也用它找筛选后该聚焦的项。
 */
export const TYPE_OPTION_SELECTOR = `[${DOM_ATTR.typeOption}]`

/**
 * 块拖拽的自定义 dataTransfer 类型。
 *
 * 拖进布局格子（ADR-0007）的落点判定靠它：`text/plain` 与选中文字的拖拽撞车，
 * 自定义类型只在手柄发起的排序里出现 —— dragover 受保护模式读不到数据，但
 * `types` 列表可以查，足够区分「这是块在拖」；drop 时再 getData 取 id。
 */
export const BLOCK_DRAG_TYPE = "application/x-block-id"

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
 * 等新块/转换后的块落进 DOM，再把焦点交给它。
 *
 * `BlockEditor`（顶层）与 `LayoutBlockView`（格子内）都要做这同一件事 ——
 * 收成一处，调用方只管喊聚焦。
 */
export async function focusBlockById(blockId: string, at: "start" | "end" = "end"): Promise<void> {
  await nextTick()
  const el = findEditable(blockId)
  if (el !== null) requestEditableFocus(el, at)
}

/**
 * 菜单内容（含子菜单）。`data-slot` 是 shadcn 组件挂的，这里是唯一的读取方。
 *
 * 用它判断「菜单还开着吗」：菜单摘掉的那一刻，焦点会跟着菜单项一起掉回 body，
 * 在这之前设的焦点等于白设。
 */
export const MENU_CONTENT_SELECTOR =
  '[data-slot="dropdown-menu-content"], [data-slot="dropdown-menu-sub-content"]'

/**
 * 菜单开着时被压住的那一次聚焦。
 *
 * 类型菜单 / 动作菜单是弹层：点完一项以后菜单项要先卸载，焦点才轮到块。
 * 在卸载之前聚焦，菜单项一摘就把焦点甩回 body —— 表现是「点完菜单，光标没了，
 * 得再点一下正文才能打字」。所以菜单还开着时只记账，由菜单的关闭回调
 * （`close-auto-focus`，它跑在菜单摘干净之后）来落：见 `flushPendingEditableFocus`。
 */
let pendingFocus: { element: HTMLElement; at: "start" | "end" } | null = null

/** 把焦点交给可编辑体；菜单还开着就先记账。 */
export function requestEditableFocus(el: HTMLElement, at: "start" | "end" = "end"): void {
  if (document.querySelector(MENU_CONTENT_SELECTOR) !== null) {
    pendingFocus = { element: el, at }
    return
  }
  pendingFocus = null
  focusEditable(el, at)
}

/**
 * 菜单关掉时调用：把先前记下的那次聚焦落下去。
 *
 * 没有记账（用户只是按 Esc 关掉菜单）时什么也不做，焦点归菜单的调用方处理。
 */
export function flushPendingEditableFocus(): void {
  const request = pendingFocus
  pendingFocus = null
  // 记的块可能已经被删掉 / 被重渲染换掉，落在一个脱离文档的元素上等于没落。
  if (request === null || !request.element.isConnected) return
  focusEditable(request.element, request.at)
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

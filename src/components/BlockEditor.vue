<script lang="ts">
/**
 * 每篇笔记离开时的滚动位置。
 *
 * 切到未缓存的笔记时,加载态会把 BlockEditor 整个卸下再挂回(EditorSurface 的
 * `v-if`),scrollTop 随实例一起没了。按路径记住、挂回时送回去。Map 放模块层 ——
 * 组件实例随切换生灭,记忆要活得比实例久。
 */
const scrollTops = new Map<string, number>()
</script>

<script setup lang="ts">
import type { BlockDropEdge, BlockType, InlineRun } from "@/types/workspace"
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch, watchEffect } from "vue"
import { ScrollArea } from "@/components/ui/scroll-area"
import { useSettings, CONTENT_WIDTH_PX } from "@/composables/useSettings"
import { useTheme } from "@/composables/useTheme"
import { useWorkspace } from "@/composables/useWorkspace"
import { isTextualBlock, orderedIndexes as orderedIndexesOf } from "@/lib/blocks"
import { headingEntries } from "@/lib/headings"
import { DOM_ATTR, DRAG_HANDLE_SELECTOR, LAYOUT_CELL_SELECTOR, TOP_BLOCK_ROW_SELECTOR, closestBlockId, findEditable, focusBlockById } from "@/lib/dom"
import { dragOverCell, draggingBlockId } from "@/lib/block-drag"
import { isFileDrag, pickImageFiles, readImageFile } from "@/lib/image"
import { rangeForOffsets, sliceRuns } from "@/lib/marks"
import { scopeCss } from "@/lib/note-style"
import { runsText, runsToHtml } from "@/lib/inline"
import {
  copyPayload,
  isCrossSelecting,
  resolvePoint,
  selectionRects,
  setCrossSelecting,
} from "@/lib/crossselect"
import type { BlockSelectionPoint } from "@/lib/crossselect"
import BlockItem from "./BlockItem.vue"
import GalleryInsertDialog from "./GalleryInsertDialog.vue"
import HeadingNav from "./HeadingNav.vue"

const {
  activePath,
  activeDocument,
  activeStyle,
  insertBlockAfter,
  insertBlockBefore,
  insertBlockAt,
  insertReferenceBlock,
  convertBlockToFileType,
  appendBlock,
  changeBlockType,
  duplicateBlock,
  mergeBlockRange,
  moveBlockIntoCell,
  removeBlock,
  moveBlock,
  setImageSource,
  setBlockRuns,
  undo,
  redo,
  restoreTick,
} = useWorkspace()

/**
 * 画册 / 书签块的插入对话框状态:待插入的位置 + 落哪种块,null 表示关着。
 * 与数据表块一样「先有文件才能插」,但选表交给用户,确认后再落块。
 * 两种块共用一个对话框(同一套「挑表或新建」交互),用 kind 区分落块。
 */
const dialogKind = ref<"gallery" | "bookmark" | "kanban" | "ledger" | "stat" | "subscription" | "playlist">("gallery")
const fileInsertIndex = ref<number | null>(null)

/**
 * 画册 / 书签块**转换**模式:待转换的块 id,null 表示不是转换。
 * `/` 菜单与手柄的「转换为」不插新块,但同样要先挑表 —— 转换与插入共用一个对话框。
 */
const fileRetypeId = ref<string | null>(null)

/** 对话框关闭:两个模式的状态一起归零。 */
function closeFileInsert() {
  fileInsertIndex.value = null
  fileRetypeId.value = null
}

/** 打开选表对话框(插入模式),记下落点:相对当前块偏移 0(前)或 1(后)。 */
function openInsertDialog(kind: "gallery" | "bookmark" | "kanban" | "ledger" | "stat" | "subscription" | "playlist", id: string, offset: 0 | 1) {
  const blocks = activeDocument.value
  const index = blocks.findIndex((item) => item.id === id)
  dialogKind.value = kind
  fileInsertIndex.value = index === -1 ? blocks.length : index + offset
}

/**
 * 有序列表序号。
 *
 * 原型用 CSS counter 算（伪元素方案），换成真实 DOM 节点后必须显式计算 ——
 * 规则收在 `orderedIndexes()` 里，与序列化的分组共用一份判断：**不相邻的 ol 各自从 1 数**。
 */
const orderedIndexes = computed(() => orderedIndexesOf(activeDocument.value))

// 内容宽度（正文列最大宽度）来自用户偏好。走内联 style 而不是 `max-w-[Npx]` 类名：
// 档位是运行时值，Tailwind 扫不到拼出来的候选（与 typography.ts 里「类名必须是字面量」同一条立场）。
const { contentWidth, headingNav, headingNavMin } = useSettings()
// 页面样式里的「浅色 / 深色两套」按应用外观解析，不按系统 —— 见 `lib/note-style.ts`。
const { theme } = useTheme()

/**
 * 正文列的左右留白。左边那 96px 是块手柄与层级缩进的让位，右边 40px 只是呼吸 ——
 * 两者原先写死（`pl-24 pr-10`），窗口一窄就把正文挤成一行两三个词。
 *
 * 现在按**编辑区**宽度收缩（`cqw`，容器查询基准挂在 `data-editor-surface` 上）：
 * 侧栏展开与折叠差 244px，用 `vw` 量出来的是窗口、不是编辑区，正好会算错那一半。
 * 上界仍是原来的 96 / 40，所以宽窗口下观感一像素不变。
 */
const GUTTER_LEFT = "clamp(16px, 10.3cqw, 96px)"
const GUTTER_RIGHT = "clamp(12px, 4.3cqw, 40px)"

/**
 * `maxWidth` 是**内容列**的宽度，gutter 不在其中 —— 原先它写在 border-box 的
 * maxWidth 里，选「窄 640」实际拿到的是 640 − 136 = 504 个字宽，档位名对不上做法。
 * 用 calc 把两个 clamp 一起加回去，档位才真的是「正文多宽」。
 */
const docStyle = computed(() => ({
  maxWidth: `calc(${CONTENT_WIDTH_PX[contentWidth.value]}px + ${GUTTER_LEFT} + ${GUTTER_RIGHT})`,
  paddingLeft: GUTTER_LEFT,
  paddingRight: GUTTER_RIGHT,
}))

/**
 * 右侧标题导航（Preference）的数据与开关。
 *
 * 目录从块模型投影（`lib/headings`），不缓存 DOM 里的标题 —— 块是唯一真源，
 * 删块 / 改标题 / 转类型都会自然反映到菜单上。
 * 门槛是「标题数够不够多」：短笔记一眼看得完，一列刻度只是噪音。
 */
const headings = computed(() => headingEntries(activeDocument.value))
const showHeadingNav = computed(() => headingNav.value && headings.value.length >= headingNavMin.value)

/** 导航量「读到哪一节」要拿到滚动容器；它在挂载后才存在，见下方的滚动位置记忆。 */
const navViewport = ref<HTMLElement | null>(null)

/**
 * 页面级 CSS 在编辑器内的预览（ADR-0011）。
 *
 * 用户写的是整页语义（`body`、`:root`、`h1`），直接注进应用文档会连侧栏和对话框一起
 * 改掉，所以先经 `scopeCss` 限定到正文列（`[data-doc]`）再挂 —— 改写规则与已知偏差
 * 见 `lib/note-style.ts`。
 *
 * 挂在 `document.head` 而不是模板里渲染一个 `<style>`：`<style>` 元素放哪个位置都会
 * 全局生效，挂在 head 上至少让它的生命周期一眼可见 —— 本组件卸载（切到数据表标签）
 * 时一并摘掉。
 */
const SCOPE_ROOT = "[data-doc]"
let previewStyle: HTMLStyleElement | null = null

watchEffect(() => {
  // `theme` 也是依赖：外观一变，同一份页面样式要按新外观重新解析（含被摊平的
  // `prefers-color-scheme` 分支），否则深色界面里还挂着浅色那套。
  const css = scopeCss(activeStyle.value, SCOPE_ROOT, theme.value)
  if (css === "") {
    previewStyle?.remove()
    previewStyle = null
    return
  }
  if (previewStyle === null) {
    previewStyle = document.createElement("style")
    previewStyle.dataset.noteStylePreview = ""
    document.head.appendChild(previewStyle)
  }
  previewStyle.textContent = css
})

onBeforeUnmount(() => {
  previewStyle?.remove()
  previewStyle = null
  window.clearTimeout(settleTimer)
  hideGhost()
})

/**
 * + 菜单的插入:`offset` 0 = 当前块上方,1 = 当前块下方。找不到 id(块已被删)
 * 一律退化为追加到文档末尾,与 `insertBlockAfter` 的兜底同一立场。
 */
function handleInsert(id: string, type: BlockType, offset: 0 | 1) {
  // 数据表块要**先有文件**才能插 —— 引用块指向一个不存在的 `.tbl` 就是一个永远读不到的
  // 提示态。所以它走自己的异步路径：解析/新建那个表，拿到路径再插块。
  if (type === "datatable") {
    const blocks = activeDocument.value
    const index = blocks.findIndex((item) => item.id === id)
    void insertReferenceBlock(index === -1 ? blocks.length : index + offset, "datatable").then((blockId) => {
      if (blockId !== "") void focusBlockById(blockId)
    })
    return
  }
  // 画册 / 书签 / 看板 / 账目 / 统计 / 订阅块同样先有文件,但选哪张交给用户:记下落点与落块种类,打开对话框。
  if (type === "gallery" || type === "bookmark" || type === "kanban" || type === "ledger" || type === "stat" || type === "subscription" || type === "playlist") {
    openInsertDialog(type, id, offset)
    return
  }
  const newId = offset === 0 ? insertBlockBefore(id, type) : insertBlockAfter(id, type)
  flashSettle(newId)
  void focusBlockById(newId)
}

/**
 * 段落中间回车的拆块：前半已由 BlockItem 留在本块，这里把后半写进新块并聚焦。
 * 同一拍内的改 runs + 插块落在同一个历史静默段里，Ctrl+Z 一步退回。
 */
function handleSplitAfter(id: string, type: BlockType, tail: InlineRun[]) {
  const newId = insertBlockAfter(id, type)
  setBlockRuns(newId, tail)
  void focusBlockById(newId)
}

function handleRetype(id: string, type: BlockType) {
  // 转换成引用块同样**先有文件**:数据表自动同名解析(与插入同一套规则),画册与书签
  // 交给对话框挑表。不接这条规则,落下的就是空路径的引用块 —— 视图永远停在「正在读取」。
  // 解析失败就不转换,原块保持原样。
  if (type === "gallery" || type === "bookmark" || type === "kanban" || type === "ledger" || type === "stat" || type === "subscription" || type === "playlist") {
    dialogKind.value = type
    fileRetypeId.value = id
    return
  }
  if (type === "datatable") {
    void convertBlockToFileType(id, "datatable").then((blockId) => {
      if (blockId !== "") void focusBlockById(blockId)
    })
    return
  }
  const nextId = changeBlockType(id, type)
  const target = nextId ?? id
  // 转换换了块（ADR-0015），闪的是新块 —— 闪旧 id 等于什么也没闪。
  flashSettle(target)
  void focusBlockById(target)
}

function handleRemove(id: string) {
  const blocks = activeDocument.value
  const index = blocks.findIndex((item) => item.id === id)
  removeBlock(id)
  // 删完把自己交给前一个块；删的是首块则落到新的首块。
  const target = blocks[Math.max(index - 1, 0)]
  if (target) void focusBlockById(target.id)
}

// ---- 拖拽排序 ----
//
// 用 pointer 事件而不是原生 HTML5 拖拽：原生拖拽一旦 dragstart，浏览器就切进「拖拽
// 模式」，这期间 wheel 事件被底层吞掉 —— 加监听也收不到（Chromium 在 Windows 上连
// 页面都不滚），而拖长文档恰恰最需要滚轮。pointer 不进那个模式，滚轮照常滚 viewport。
//
// 代价是手柄同时还是块菜单的触发器（reka 的菜单是 **click** 打开的），所以两次动作
// 要自己分开：按住不动 = 点击开菜单，过阈值移动 = 拖拽；拖完压掉随之而来的那次 click。

const docRef = ref<HTMLElement | null>(null)
/** 落点：插入到 activeDocument 中的下标，取值 0..length。 */
const dropIndex = ref<number | null>(null)
/** 拖入的是**文件**时的落点。与块排序是两条独立的路，谁在拖由文件拖拽自己的状态区分。 */
const fileDropIndex = ref<number | null>(null)

/**
 * 拖动时跟着指针走的那张小纸片：只有这一块的开头文字。
 *
 * 块原位只是降了透明度，光靠它看不出「手里拿着的是哪一块」—— 尤其在一屏相似的段落里。
 *
 * **直接建 DOM，不走 Vue 渲染**。拖拽一开始只要发生一次重渲染，落点重算就会断掉
 * （`drag-check` 那两条滚动用例就是这么红的）；坐标还会每帧都在变。这两件事都不该
 * 交给调度器，所以这里自己 createElement、自己写 `style.transform`。
 */
const GHOST_CLASS =
  "pointer-events-none fixed top-0 left-0 z-50 max-w-[260px] truncate rounded-[7px] border border-line bg-popover px-2 py-1 text-[12.5px] leading-[1.4] text-foreground opacity-90 shadow-island"

let ghostEl: HTMLElement | null = null

/** 影子上的字：拖的那一行压平空白后取开头。空块（只剩占位）不给影子 —— 一张空纸片没意义。 */
function ghostLabel(row: HTMLElement | null): string {
  if (row === null) return ""
  return (row.textContent ?? "").replace(/\s+/g, " ").trim().slice(0, 80)
}

function placeGhost(x: number, y: number): void {
  if (ghostEl === null) return
  // 位移走 transform：每帧都在改，只有合成层扛得住。
  ghostEl.style.transform = `translate3d(${x + 14}px, ${y + 10}px, 0)`
}

function showGhost(row: HTMLElement | null, x: number, y: number): void {
  const text = ghostLabel(row)
  if (text === "") return
  if (ghostEl === null) {
    ghostEl = document.createElement("div")
    ghostEl.className = GHOST_CLASS
    // 内容与屏幕上的块重复，读屏不该念两遍。
    ghostEl.setAttribute("aria-hidden", "true")
    docRef.value?.parentElement?.append(ghostEl)
  }
  ghostEl.textContent = text
  placeGhost(x, y)
}

function hideGhost(): void {
  ghostEl?.remove()
  ghostEl = null
}

/**
 * 刚落地的那一块：闪一下底色（`.block-settle`）。
 *
 * 只在「从菜单插入」和「转换类型」时给 —— 这两件事发生时版面上多出来一个东西，
 * 眼睛未必跟得上。回车拆块不给：它是最频繁的建块方式，每换一行闪一次是纯噪音。
 *
 * 走 DOM 而不是 `:class` 绑定：这一笔状态变化会和紧随其后的 `focusBlockById` 抢同一个
 * `nextTick`，菜单还没卸载、焦点就被判成「在块外」—— `focus-check` 会连片红。
 * 一个纯装饰的底色不值得挤进渲染队列，这里只等 DOM 落定后补一个类。
 */
let settleTimer: number | undefined

function flashSettle(id: string): void {
  if (id === "") return
  void nextTick(() => {
    const row = document.querySelector(`[${DOM_ATTR.blockId}="${id}"]`)
    if (!(row instanceof HTMLElement)) return
    row.classList.remove("block-settle")
    // 读一次宽度逼一次回流：同名类重加才会重放动画，否则连点两次插入只闪第一次。
    void row.offsetWidth
    row.classList.add("block-settle")
    window.clearTimeout(settleTimer)
    settleTimer = window.setTimeout(() => row.classList.remove("block-settle"), 950)
  })
}

/** 位移超过这个距离才算在拖 —— 拖块与拖选正文共用一把尺子，手感一致；单击（含点完微抖）都不算。 */
const DRAG_THRESHOLD = 4

/** 按住手柄、还没过阈值：可能是在点菜单，也可能是拖拽起点。 */
let pressedId: string | null = null
/** 按住的那一行 DOM：影子的文字从它身上取（格子里的块不在顶层数组里，取不到模型）。 */
let pressedRow: HTMLElement | null = null
let pressedX = 0
let pressedY = 0
/** 拖拽中指针的最后位置：滚动之后要按它重算落点（滚轮动的是内容，指针没动）。 */
let pointerX = 0
let pointerY = 0
/** 这个时刻之前来的那次 click 要被吞掉（拖完会紧跟一次，见 `onDocClickCapture`）。 */
let suppressClickUntil = 0

const dragFrom = computed(() => {
  if (draggingBlockId.value === null) return -1
  return activeDocument.value.findIndex((block) => block.id === draggingBlockId.value)
})

/** 落点与当前位置等价（拖回原处）时不画线也不提交，免得松手白动一下。 */
const dropIsNoop = computed(() => {
  const to = dropIndex.value
  if (to === null || dragFrom.value === -1) return true
  return to === dragFrom.value || to === dragFrom.value + 1
})

/**
 * 按指针纵向位置算落点。
 *
 * 走「遍历所有块取中线」而不是「看指针落在哪个块」：指针落进块之间的空隙、容器上下
 * 留白时命中的是容器本身，按目标判定会漏；遍历 rect 一律有效。
 */
function computeDropIndex(clientY: number): number | null {
  const root = docRef.value
  if (root === null) return null
  // 只算顶层行：格子内也是块行（布局块 ADR-0007），算进落点序列下标就对不上顶层文档了。
  const rows = root.querySelectorAll(TOP_BLOCK_ROW_SELECTOR)
  if (rows.length === 0) return null
  for (let i = 0; i < rows.length; i += 1) {
    const row = rows[i]
    if (!(row instanceof HTMLElement)) continue
    const rect = row.getBoundingClientRect()
    if (clientY < rect.top + rect.height / 2) return i
  }
  return rows.length
}

/**
 * 指针落在哪个布局格子上。
 *
 * 用命中测试而不是监听格子的 pointermove：格子是 `LayoutBlockView` 的内部结构，
 * 拖拽的落点判定统一留在这层，格子只负责挂 `data-layout-cell` 和画高亮。
 */
function cellAt(clientX: number, clientY: number): { blockId: string; cellIndex: number } | null {
  const hit = document.elementFromPoint(clientX, clientY)
  if (hit === null) return null
  const cell = hit.closest(LAYOUT_CELL_SELECTOR)
  if (cell === null) return null
  const index = Number(cell.getAttribute(DOM_ATTR.layoutCell))
  if (!Number.isInteger(index)) return null
  // 格子最近的块行就是它所属的布局块（格子自身不是块行）。
  const blockId = closestBlockId(cell)
  return blockId === null ? null : { blockId, cellIndex: index }
}

/** 指针位置 → 落点。悬在格子上时改投格子，顶层不再画线。 */
function updateDropTarget(clientX: number, clientY: number) {
  const cell = cellAt(clientX, clientY)
  dragOverCell.value = cell
  dropIndex.value = cell === null ? computeDropIndex(clientY) : null
}

function onHandlePointerDown(event: PointerEvent) {
  if (event.button !== 0) return
  const target = event.target
  if (!(target instanceof HTMLElement) || target.closest(DRAG_HANDLE_SELECTOR) === null) return
  const id = closestBlockId(target)
  if (id === null) return
  const row = target.closest(`[${DOM_ATTR.blockId}]`)
  pressedId = id
  pressedRow = row instanceof HTMLElement ? row : null
  pressedX = event.clientX
  pressedY = event.clientY
  pointerX = event.clientX
  pointerY = event.clientY
  window.addEventListener("pointermove", onHandlePointerMove)
  window.addEventListener("pointerup", onHandlePointerUp)
  window.addEventListener("pointercancel", onHandlePointerUp)
}

function onHandlePointerMove(event: PointerEvent) {
  if (pressedId === null) return
  pointerX = event.clientX
  pointerY = event.clientY
  if (draggingBlockId.value === null) {
    if (Math.abs(pointerX - pressedX) < DRAG_THRESHOLD && Math.abs(pointerY - pressedY) < DRAG_THRESHOLD) return
    startBlockDrag(pressedId)
  }
  updateDropTarget(pointerX, pointerY)
  trackDragScroll(pointerX, pointerY)
  placeGhost(pointerX, pointerY)
}

function startBlockDrag(id: string) {
  draggingBlockId.value = id
  dropIndex.value = null
  dragOverCell.value = null
  showGhost(pressedRow, pointerX, pointerY)
  // 拖拽期间不让人在正文里划出选区、也不让浏览器把这段文字当成可拖的东西。
  docRef.value?.classList.add("select-none", "doc-dragging")
  window.getSelection()?.removeAllRanges()
  scrollViewport()?.addEventListener("scroll", onViewportScroll)
  // 指针跑到窗口外松手：pointerup 不会回来，拖拽会一直挂着。
  window.addEventListener("blur", endBlockDrag)
}

/** 滚轮 / 自动滚动都会改变内容位置，指针没动但落点变了 —— 重算一次，指示线不滞留。 */
function onViewportScroll() {
  if (draggingBlockId.value !== null) {
    updateDropTarget(pointerX, pointerY)
    return
  }
  if (fileDropIndex.value === null) return
  const index = computeDropIndex(dragScrollY)
  if (index !== null) fileDropIndex.value = index
}

function onHandlePointerUp(event: PointerEvent) {
  window.removeEventListener("pointermove", onHandlePointerMove)
  window.removeEventListener("pointerup", onHandlePointerUp)
  window.removeEventListener("pointercancel", onHandlePointerUp)
  const pressed = pressedId
  pressedId = null
  pressedRow = null
  // 没过阈值：这是点击，交给菜单。
  if (draggingBlockId.value === null || pressed === null) return

  const id = draggingBlockId.value
  const from = dragFrom.value
  updateDropTarget(event.clientX, event.clientY)
  const cell = dragOverCell.value
  const to = dropIndex.value
  endBlockDrag()
  // 紧接着还会来一次 click，不拦就会当场弹出块菜单。
  suppressClickUntil = performance.now() + 200
  if (cell !== null) {
    moveBlockIntoCell(cell.blockId, cell.cellIndex, id)
    return
  }
  if (to !== null && from !== -1) moveBlock(from, to)
}

function endBlockDrag() {
  draggingBlockId.value = null
  dropIndex.value = null
  dragOverCell.value = null
  hideGhost()
  docRef.value?.classList.remove("select-none", "doc-dragging")
  scrollViewport()?.removeEventListener("scroll", onViewportScroll)
  window.removeEventListener("blur", endBlockDrag)
  stopDragScroll()
}

/** 吞掉拖拽结尾那次 click：reka 的菜单在 click 上打开，不拦就白拖一次还弹菜单。 */
function onDocClickCapture(event: MouseEvent) {
  if (performance.now() >= suppressClickUntil) return
  suppressClickUntil = 0
  event.stopPropagation()
  event.preventDefault()
}

/** 原生拖拽（正文里拖选文字）会吞掉 mousemove / mouseup：先撤掉跨块选区的按住状态。 */
function onDragStart() {
  dragPressed = false
  window.removeEventListener("mousemove", onCrossMove)
  window.removeEventListener("mouseup", onCrossEnd)
}

function onDragOver(event: DragEvent) {
  // 剩下的原生拖拽只有一种：从系统里拖文件进来 = 在落点插入图片块。
  if (!isFileDrag(event.dataTransfer)) return
  // 必须 preventDefault，否则浏览器默认行为是「打开这个文件」，页面直接被替换掉。
  event.preventDefault()
  const index = computeDropIndex(event.clientY)
  if (index !== null) fileDropIndex.value = index
  trackDragScroll(event.clientX, event.clientY)
}

// ---- 拖拽时自动滚动 ----
//
// 滚轮能用了（pointer 拖拽不进拖拽模式），但指针贴着上下边缘不动时还是得靠这个：
// 按指针到边缘的深度定一个每帧步长，rAF 循环推 scrollTop，让内容跟着走。
// 落点由 viewport 的 scroll 监听统一重算，循环只管滚。

/** 指针进入滚动容器上下这么宽的一条带子就开始滚。 */
const DRAG_SCROLL_BAND = 80
/** 贴到最边上时每帧的滚动量（像素）。 */
const DRAG_SCROLL_MAX_STEP = 16

/** 当前每帧滚动量：负数向上、正数向下、0 表示不滚。 */
let dragScrollStep = 0
/** 最近一次拖拽指针位置：判指针是否还在容器上靠它（块拖拽与文件拖入共用）。 */
let dragScrollX = 0
let dragScrollY = 0
let dragScrollFrame = 0

/** 指针到上下边缘的距离换算成每帧滚动量；不在带子里给 0。 */
function dragScrollStepAt(clientY: number): number {
  const viewport = scrollViewport()
  if (viewport === null) return 0
  const rect = viewport.getBoundingClientRect()
  const topDepth = (rect.top + DRAG_SCROLL_BAND - clientY) / DRAG_SCROLL_BAND
  const bottomDepth = (clientY - (rect.bottom - DRAG_SCROLL_BAND)) / DRAG_SCROLL_BAND
  // 指针能被拖出容器，深度夹在 1 以内，免得贴边时速度飙到离谱。
  const depth = Math.min(1, Math.max(topDepth, bottomDepth))
  if (depth <= 0) return 0
  const step = Math.max(1, Math.ceil(depth * DRAG_SCROLL_MAX_STEP))
  return topDepth > bottomDepth ? -step : step
}

function pumpDragScroll() {
  dragScrollFrame = 0
  const viewport = scrollViewport()
  if (viewport === null || dragScrollStep === 0) return
  // 指针横向出了容器：不会再有拖拽事件送新位置，就此收手，别让页面自己跑到底。
  const rect = viewport.getBoundingClientRect()
  if (dragScrollX < rect.left || dragScrollX > rect.right) {
    dragScrollStep = 0
    return
  }
  const before = viewport.scrollTop
  viewport.scrollTop = before + dragScrollStep
  // 到顶 / 到底：再推也不动，停循环等下一次拖拽事件重新量。
  if (viewport.scrollTop === before) {
    dragScrollStep = 0
    return
  }
  dragScrollFrame = requestAnimationFrame(pumpDragScroll)
}

function trackDragScroll(clientX: number, clientY: number) {
  dragScrollX = clientX
  dragScrollY = clientY
  dragScrollStep = dragScrollStepAt(clientY)
  if (dragScrollStep === 0) {
    stopDragScroll()
    return
  }
  if (dragScrollFrame === 0) dragScrollFrame = requestAnimationFrame(pumpDragScroll)
}

function stopDragScroll() {
  if (dragScrollFrame !== 0) cancelAnimationFrame(dragScrollFrame)
  dragScrollFrame = 0
  dragScrollStep = 0
}

/**
 * 拖出容器才清掉文件落点。
 *
 * 不能无条件清：dragleave 会随着指针在子块之间移动反复触发，无条件清会让指示线闪。
 * 文件拖拽不会触发 dragend（源在应用外），所以这里必须自己兜住「拖走放弃」。
 */
function onDragLeave(event: DragEvent) {
  const next = event.relatedTarget
  if (next instanceof Node && docRef.value?.contains(next) === true) return
  fileDropIndex.value = null
  // 指针离开正文容器，不再有 dragover 送位置，滚动循环跟着停。
  stopDragScroll()
}

function onDrop(event: DragEvent) {
  if (!isFileDrag(event.dataTransfer)) return
  event.preventDefault()
  const index = fileDropIndex.value
  fileDropIndex.value = null
  stopDragScroll()
  void insertImageFiles(pickImageFiles(event.dataTransfer), index)
}

/**
 * 把图片文件插成图片块。
 *
 * 读文件是异步的，而块可能在等待期间被删——所以每次插入都重新按下标走
 * `insertBlockAt`（越界会被夹住），不缓存块引用。多张按顺序依次插。
 */
async function insertImageFiles(files: readonly File[], from: number | null) {
  let index = from
  for (const file of files) {
    const src = await readImageFile(file)
    const id = index === null ? appendBlock("image") : insertBlockAt(index, "image")
    setImageSource(id, src)
    index = index === null ? null : index + 1
  }
}

/**
 * 粘贴图片的落点：光标所在块之后。
 *
 * 焦点不在任何块里时（比如刚点过工具栏）追加到文档末尾 —— 总比什么都不做好。
 */
function pasteAnchor(): number {
  const active = document.activeElement
  if (!(active instanceof HTMLElement)) return activeDocument.value.length
  const id = closestBlockId(active)
  if (id === null) return activeDocument.value.length
  const index = activeDocument.value.findIndex((block) => block.id === id)
  return index === -1 ? activeDocument.value.length : index + 1
}

function onPaste(event: ClipboardEvent) {
  const files = pickImageFiles(event.clipboardData)
  if (files.length === 0) return
  // 拦掉默认粘贴：不拦的话图片会以 <img> 形式塞进 contenteditable 里，
  // 那块内容不在模型里，一序列化就丢。
  event.preventDefault()
  void insertImageFiles(files, pasteAnchor())
}

/** 原生拖拽的兜底收尾：块拖拽由 pointerup 收，这里只管文件落点与滚动。 */
function resetDrag() {
  fileDropIndex.value = null
  stopDragScroll()
}

// ---- 跨块选区 ----

/**
 * 拖选高亮统一走覆盖层（块内与跨块同一层,颜色才不会两样）。
 *
 * 落点解析 / 矩形 / 复制内容都在 `lib/crossselect`。单击落光标仍走原生 ——
 * 从按下点移动超过阈值才算「在拖选」,那一刻才关原生选区（select-none）,
 * 把绘制权整个交给覆盖层;按住不放拖回锚块也保持覆盖层,不再退回原生。
 */
const crossAnchor = ref<BlockSelectionPoint | null>(null)
const crossFocus = ref<BlockSelectionPoint | null>(null)
/** 覆盖层高亮矩形（视口坐标），拖选期间每次 mousemove 重算。 */
const crossRects = ref<{ top: number; left: number; width: number; height: number }[]>([])
/** 拖拽过程状态（无需响应式）：锚点、是否按住、按下坐标、覆盖层是否已接管。 */
let dragAnchor: BlockSelectionPoint | null = null
let dragPressed = false
let dragStartX = 0
let dragStartY = 0
let overlayOn = false

function clearCrossSelection() {
  crossAnchor.value = null
  crossFocus.value = null
  crossRects.value = []
  dragAnchor = null
  overlayOn = false
  setCrossSelecting(false)
  docRef.value?.classList.remove("select-none")
}

function onCrossMove(event: MouseEvent) {
  const root = docRef.value
  if (!dragPressed || dragAnchor === null || root === null) return

  // 未过阈值先让原生跑;过了阈值接管:关原生选区、锁 select-none,此后块内块外同一套覆盖层。
  if (!overlayOn) {
    if (Math.abs(event.clientX - dragStartX) < DRAG_THRESHOLD && Math.abs(event.clientY - dragStartY) < DRAG_THRESHOLD)
      return
    overlayOn = true
    setCrossSelecting(true)
    root.classList.add("select-none")
    window.getSelection()?.removeAllRanges()
  }

  const focus = resolvePoint(root, activeDocument.value, event.clientX, event.clientY)
  if (focus === null) return

  crossAnchor.value = dragAnchor
  crossFocus.value = focus
  // 矩形存文档坐标(视口坐标减文档容器原点):覆盖层随内容一起滚动,不用监听 scroll 重算。
  const docRect = root.getBoundingClientRect()
  crossRects.value = selectionRects(root, activeDocument.value, dragAnchor, focus).map((rect) => ({
    top: rect.top - docRect.top,
    left: rect.left - docRect.left,
    width: rect.width,
    height: rect.height,
  }))
}

function onCrossEnd() {
  dragPressed = false
  window.removeEventListener("mousemove", onCrossMove)
  window.removeEventListener("mouseup", onCrossEnd)
  if (!overlayOn) {
    dragAnchor = null
    return
  }
  // 拖选结束落在单个正文块内:还原成原生选区。浮条(useInlineToolbar)只认原生选区
  // —— 双击 / Shift+点选本来就是原生的所以有浮条,拖选被覆盖层接管后原生选区是空的,
  // 不还回去浮条永远不出来。跨块选区保留 anchor/focus 供 Ctrl+C。
  const anchor = crossAnchor.value
  const focus = crossFocus.value
  if (anchor === null || focus === null || anchor.index !== focus.index) return
  if (anchor.offset === -1 || focus.offset === -1) return
  const editable = findEditable(anchor.id)
  if (editable === null) return
  const range = rangeForOffsets(editable, {
    start: Math.min(anchor.offset, focus.offset),
    end: Math.max(anchor.offset, focus.offset),
  })
  if (range === null) return
  clearCrossSelection()
  editable.focus({ preventScroll: true })
  const selection = window.getSelection()
  if (selection === null) return
  selection.removeAllRanges()
  selection.addRange(range)
}

function onDocMouseDown(event: MouseEvent) {
  clearCrossSelection()
  if (event.button !== 0) return
  const root = docRef.value
  const target = event.target
  if (root === null || !(target instanceof Element)) return
  // 手柄上按下是在准备拖块 / 点开菜单，不是要选正文。
  if (target.closest(DRAG_HANDLE_SELECTOR) !== null) return
  // 只从顶层块的可编辑体起选。resolvePoint 按落点返回顶层块端点,
  // 返回的块与 mousedown 归属的块对不上（格子内、树、工具条）就整段交给原生。
  const point = resolvePoint(root, activeDocument.value, event.clientX, event.clientY)
  if (point === null || point.id !== closestBlockId(target)) return
  dragAnchor = point
  dragPressed = true
  dragStartX = event.clientX
  dragStartY = event.clientY
  window.addEventListener("mousemove", onCrossMove)
  window.addEventListener("mouseup", onCrossEnd)
}

async function copyCrossSelection() {
  const anchor = crossAnchor.value
  const focus = crossFocus.value
  if (anchor === null || focus === null) return
  const payload = copyPayload(activeDocument.value, anchor, focus)
  if (typeof ClipboardItem !== "undefined") {
    try {
      await navigator.clipboard.write([
        new ClipboardItem({
          "text/plain": new Blob([payload.text], { type: "text/plain" }),
          "text/html": new Blob([payload.html], { type: "text/html" }),
        }),
      ])
      return
    } catch {
      // WebView 不支持多 flavor 写入时落到纯文本兜底。
    }
  }
  await navigator.clipboard.writeText(payload.text)
}

/**
 * 跨块删除:选区内内容删掉,文档序靠前块的头残段与靠后块的尾残段拼进一个块（类型随
 * 靠前块,靠前块不是正文块则随靠后块,两端都不是则落一个空文本块）,位置取范围上沿。
 * 拖选方向不限 —— 锚/焦先按文档序归一再取残段。
 * 改 runs + 逐个删块在同一拍完成,落在同一个历史静默段里,Ctrl+Z 一步退回。
 */
function deleteCrossSelection() {
  const anchor = crossAnchor.value
  const focus = crossFocus.value
  if (anchor === null || focus === null) return

  const blocks = activeDocument.value
  const from = Math.min(anchor.index, focus.index)
  const to = Math.max(anchor.index, focus.index)
  // 文档序归一:头残段永远属于靠前的块、尾残段属于靠后的块。锚点是按下位置,
  // 反向拖选(从下往上)时锚在下、焦在上,直接拿锚块算头残段会把两端未选部分算反
  // —— 整篇反选删除后首尾内容反而留下的根因就在这。
  const sameBlock = anchor.index === focus.index
  const forward = sameBlock ? anchor.offset <= focus.offset : anchor.index < focus.index
  const start = forward ? anchor : focus
  const end = forward ? focus : anchor
  const startBlock = blocks[start.index]
  const endBlock = blocks[end.index]
  if (startBlock === undefined || endBlock === undefined) {
    clearCrossSelection()
    return
  }

  const head = isTextualBlock(startBlock) ? sliceRuns(startBlock.runs, { start: 0, end: Math.max(start.offset, 0) }) : []
  const tail = isTextualBlock(endBlock)
    ? sliceRuns(endBlock.runs, { start: Math.max(end.offset, 0), end: runsText(endBlock.runs).length })
    : []
  // 合并块落在范围上沿(文档序靠前的位置),类型也随靠前的块,正反两个方向行为一致。
  const mergedType = isTextualBlock(startBlock)
    ? startBlock.type
    : isTextualBlock(endBlock)
      ? endBlock.type
      : "text"
  const mergedRuns = [...head, ...tail]
  const newId = mergeBlockRange(from, to, mergedType, mergedRuns)
  clearCrossSelection()

  // contenteditable 非受控:数据改了 DOM 不会自己跟上(类型没变时 BlockItem 也不重画),
  // 保留块的正文要按数据直接重写,再把光标放到拼接缝(头残段的末尾)上。
  const caret = runsText(head).length
  void nextTick(() => {
    const editable = newId === "" ? null : findEditable(newId)
    if (editable === null) return
    editable.innerHTML = runsToHtml(mergedRuns)
    editable.focus()
    const range = rangeForOffsets(editable, { start: caret, end: caret })
    const selection = window.getSelection()
    if (range === null || selection === null) return
    selection.removeAllRanges()
    selection.addRange(range)
  })
}

// ---- 撤销 / 重做 ----

/**
 * 全局接管 Ctrl+Z / Ctrl+Shift+Z / Ctrl+Y,走文档级历史(`useWorkspace`)。
 *
 * 不指望浏览器原生撤销:块级操作(插入 / 删除 / 拖拽 / 转换)压根不进 contenteditable
 * 的撤销栈,文本编辑的原生栈又会在数据驱动重渲染后失效。所以正文里的 Ctrl+Z 一律
 * preventDefault,换成整文档快照回退。
 *
 * 输入框(设置面板等)放过原生行为 —— 那是表单,原生撤销才是对的;输入法组字中的
 * 快捷键也要放过,组字确认键不能同时撤销。
 */
function onKeyDown(event: KeyboardEvent) {
  // 跨块选区在位:Ctrl+C 复制（选区保留,可连抄几刀）,其余按键一律清除选区。
  // 修饰键不清 —— Ctrl 是 Ctrl+C 的前半个组合键,按下它本身选区必须还在。
  if (isCrossSelecting()) {
    if ((event.ctrlKey || event.metaKey) && !event.shiftKey && !event.altKey && event.key.toLowerCase() === "c") {
      event.preventDefault()
      void copyCrossSelection()
    } else if (event.key === "Backspace" || event.key === "Delete") {
      event.preventDefault()
      deleteCrossSelection()
    } else if (event.key !== "Control" && event.key !== "Shift" && event.key !== "Alt" && event.key !== "Meta") {
      clearCrossSelection()
    }
    return
  }
  if (!(event.ctrlKey || event.metaKey) || event.isComposing) return
  const key = event.key.toLowerCase()
  if (key !== "z" && key !== "y") return
  const target = event.target
  if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement) return
  event.preventDefault()
  if (key === "y" || event.shiftKey) redo()
  else undo()
}

onMounted(() => document.addEventListener("keydown", onKeyDown))
onBeforeUnmount(() => document.removeEventListener("keydown", onKeyDown))

// ---- 滚动位置记忆 ----

/** 滚动容器是 ScrollArea 的 viewport，从正文容器向上找（reka 写了 `data-slot`）。 */
function scrollViewport(): HTMLElement | null {
  const node = docRef.value?.closest('[data-slot="scroll-area-viewport"]')
  return node instanceof HTMLElement ? node : null
}

function rememberScroll(path: string) {
  const viewport = scrollViewport()
  if (path !== "" && viewport !== null) scrollTops.set(path, viewport.scrollTop)
}

/** 恢复要等新文档渲染落地，所以包一层 `nextTick`；没记忆的路径落回顶部。 */
function restoreScroll(path: string) {
  if (path === "") return
  void nextTick(() => {
    const viewport = scrollViewport()
    if (viewport !== null) viewport.scrollTop = scrollTops.get(path) ?? 0
  })
}

// 缓存命中的切换不经历卸载，靠这条 watcher 换存取；卸载重挂的路由 `onMounted` 兜住。
// 换文档先清跨块选区 —— 覆盖层挂在 body 上不随文档卸载，锚点也是旧文档的块，
// 不清的话高亮会跟着切到另一篇文章里去。
watch(activePath, (next, prev) => {
  if (prev !== undefined) rememberScroll(prev)
  clearCrossSelection()
  restoreScroll(next)
})
onMounted(() => {
  restoreScroll(activePath.value)
  navViewport.value = scrollViewport()
})
onBeforeUnmount(() => {
  rememberScroll(activePath.value)
  clearCrossSelection()
  endBlockDrag()
})

/** 每个块的落点标记。同一时刻只画一条线：先判 before，末尾再特判 after。 */
function dropEdgeAt(index: number): BlockDropEdge {
  // 文件拖入不存在「拖回原处」这种空操作，落点永远有效。
  const file = fileDropIndex.value
  if (file !== null) return edgeOf(index, file)

  const to = dropIndex.value
  if (draggingBlockId.value === null || to === null || dropIsNoop.value) return "none"
  return edgeOf(index, to)
}

/** `to` 是插入下标：标在该下标处块的上沿；追加到末尾则标在最后一个块的下沿。 */
function edgeOf(index: number, to: number): BlockDropEdge {
  if (index === to) return "before"
  if (to === activeDocument.value.length && index === to - 1) return "after"
  return "none"
}
</script>

<template>
  <!-- 包一层 relative：标题导航要贴在编辑区右缘（不是正文列右缘），只能相对这层定位；
       滚动容器仍是里面那层 ScrollArea，导航不随内容滚。 -->
  <div class="relative flex min-h-0 flex-1 flex-col">
    <ScrollArea class="min-h-0 flex-1">
      <!-- `data-doc` 给自检页当探针钩子：量正文列宽度（内容宽度偏好）时靠它定位这层容器。 -->
      <div
        ref="docRef"
        data-doc
        class="relative mx-auto w-full pt-16 pb-30"
        :style="docStyle"
        @dragstart="onDragStart"
        @dragover="onDragOver"
        @dragleave="onDragLeave"
        @drop="onDrop"
        @dragend="resetDrag"
        @pointerdown="onHandlePointerDown"
        @click.capture="onDocClickCapture"
        @paste="onPaste"
        @mousedown="onDocMouseDown"
      >
        <BlockItem
          v-for="(block, index) in activeDocument"
          :key="`${restoreTick}:${block.id}`"
          :block="block"
          :ordered-index="orderedIndexes.get(block.id) ?? 0"
          :dragging="draggingBlockId === block.id"
          :drop-edge="dropEdgeAt(index)"
          @insert-after="(id: string, type: BlockType) => handleInsert(id, type, 1)"
          @insert-before="(id: string, type: BlockType) => handleInsert(id, type, 0)"
          @split-after="handleSplitAfter"
          @retype="handleRetype"
          @duplicate="duplicateBlock"
          @remove="handleRemove"
        />

        <!-- 拖选高亮覆盖层:块内与跨块统一走这里,样式(.cross-selection-rect)在 style.css。
             直接铺在文档容器里(文档坐标),随内容滚动 —— 不挂在 body 上,滚动不错位。
             不包容器层:mix-blend 要跟页面内容同处一个层叠上下文,包一层会被隔离成不透明色块。 -->
        <span
          v-for="(rect, i) in crossRects"
          :key="i"
          aria-hidden="true"
          class="cross-selection-rect pointer-events-none absolute"
          :style="{ top: `${rect.top}px`, left: `${rect.left}px`, width: `${rect.width}px`, height: `${rect.height}px` }"
        />
      </div>
    </ScrollArea>

    <!-- 拖块时跟着指针的那张小纸片不在这里：它由 `showGhost` 直接建 DOM 挂到本层，
         理由见那段注释（拖拽开始时的重渲染会打断落点重算）。 -->
    <!-- 标题导航贴在编辑区右缘，不随正文滚动。门槛没到（或设置里关掉）时整个不挂。 -->
    <HeadingNav v-if="showHeadingNav" :items="headings" :viewport="navViewport" />
  </div>

  <GalleryInsertDialog :kind="dialogKind" :index="fileInsertIndex" :retype-id="fileRetypeId" @close="closeFileInsert" />
</template>

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
import { useWorkspace } from "@/composables/useWorkspace"
import { isTextualBlock, orderedIndexes as orderedIndexesOf } from "@/lib/blocks"
import { BLOCK_DRAG_TYPE, DRAG_HANDLE_SELECTOR, TOP_BLOCK_ROW_SELECTOR, closestBlockId, findEditable, focusBlockById } from "@/lib/dom"
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

const {
  activePath,
  activeDocument,
  activeStyle,
  insertBlockAfter,
  insertBlockBefore,
  insertBlockAt,
  insertDataTableBlock,
  convertBlockToFileType,
  appendBlock,
  changeBlockType,
  duplicateBlock,
  mergeBlockRange,
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
const dialogKind = ref<"gallery" | "bookmark" | "kanban" | "ledger" | "stat">("gallery")
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
function openInsertDialog(kind: "gallery" | "bookmark" | "kanban" | "ledger" | "stat", id: string, offset: 0 | 1) {
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
const { contentWidth } = useSettings()
const docStyle = computed(() => ({ maxWidth: `${CONTENT_WIDTH_PX[contentWidth.value]}px` }))

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
  const css = scopeCss(activeStyle.value, SCOPE_ROOT)
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
    void insertDataTableBlock(index === -1 ? blocks.length : index + offset).then((blockId) => {
      if (blockId !== "") void focusBlockById(blockId)
    })
    return
  }
  // 画册 / 书签 / 看板 / 账目块同样先有文件,但选哪张交给用户:记下落点与落块种类,打开对话框。
  if (type === "gallery" || type === "bookmark" || type === "kanban" || type === "ledger" || type === "stat") {
    openInsertDialog(type, id, offset)
    return
  }
  const newId = offset === 0 ? insertBlockBefore(id, type) : insertBlockAfter(id, type)
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
  if (type === "gallery" || type === "bookmark" || type === "kanban" || type === "ledger" || type === "stat") {
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
  changeBlockType(id, type)
  void focusBlockById(id)
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
// 用原生 HTML5 拖拽而不是 pointer 事件：手柄同时还是块菜单的触发器，而 reka 的
// 菜单是**点击**打开的 —— 原生拖拽成功后会吃掉那次 click，两者天然不打架。
// pointer 方案得自己判阈值再手动压掉菜单，反而更绕。

const docRef = ref<HTMLElement | null>(null)
/** 正在被拖的块 id。null 表示当前没有块拖拽（也因此拒绝一切 drop）。 */
const dragId = ref<string | null>(null)
/** 落点：插入到 activeDocument 中的下标，取值 0..length。 */
const dropIndex = ref<number | null>(null)
/** 拖入的是**文件**时的落点。与块排序是两条独立的路，谁在拖由 dragId / 它区分。 */
const fileDropIndex = ref<number | null>(null)

const dragFrom = computed(() => {
  if (dragId.value === null) return -1
  return activeDocument.value.findIndex((block) => block.id === dragId.value)
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
 * 走「遍历所有块取中线」而不是「看 event.target 落在哪个块」：指针落进块之间的
 * 空隙、容器上下留白时 target 是容器本身，按 target 判定会漏；遍历 rect 一律有效。
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

function onDragStart(event: DragEvent) {
  // HTML5 拖拽期间 mousemove / mouseup 不触发 —— 无论是排序还是拖文字,先撤掉
  // 跨块选择的按住状态,免得拖完之后指针一动就拿残留的锚点误开选区。
  dragPressed = false
  window.removeEventListener("mousemove", onCrossMove)
  window.removeEventListener("mouseup", onCrossEnd)
  const target = event.target
  // 只有手柄发起的才算排序。正文里选中文字也会触发 dragstart，那种放过。
  if (!(target instanceof HTMLElement) || target.closest(DRAG_HANDLE_SELECTOR) === null) return
  const id = closestBlockId(target)
  if (id === null) return

  dragId.value = id
  dropIndex.value = null
  if (event.dataTransfer === null) return
  event.dataTransfer.effectAllowed = "move"
  // 必须写点数据：某些 WebView 在 dataTransfer 全空时干脆不认这次拖拽，连 dragover 都不给。
  event.dataTransfer.setData("text/plain", id)
  // 自定义类型给布局格子认落点用：dragover 受保护模式读不到数据，但 types 可查；
  // `text/plain` 与拖选文字撞车，它区分不了「块在拖」还是「一段文字在拖」。
  event.dataTransfer.setData(BLOCK_DRAG_TYPE, id)
}

function onDragOver(event: DragEvent) {
  // 拖文件进来 = 在落点插入图片块，与块排序是两条路，优先判它。
  if (isFileDrag(event.dataTransfer)) {
    // 必须 preventDefault，否则浏览器默认行为是「打开这个文件」，页面直接被替换掉。
    event.preventDefault()
    const index = computeDropIndex(event.clientY)
    if (index !== null) fileDropIndex.value = index
    return
  }
  // 非块拖拽（比如拖一段选中文字）不放行：不 preventDefault，浏览器就画禁止光标。
  if (dragId.value === null) return
  event.preventDefault()
  if (event.dataTransfer !== null) event.dataTransfer.dropEffect = "move"
  const index = computeDropIndex(event.clientY)
  if (index !== null) dropIndex.value = index
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
}

function onDrop(event: DragEvent) {
  if (isFileDrag(event.dataTransfer)) {
    event.preventDefault()
    const index = fileDropIndex.value
    fileDropIndex.value = null
    void insertImageFiles(pickImageFiles(event.dataTransfer), index)
    return
  }

  if (dragId.value === null) return
  event.preventDefault()
  const from = dragFrom.value
  const to = dropIndex.value
  resetDrag()
  if (to === null) return
  moveBlock(from, to)
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

function resetDrag() {
  dragId.value = null
  dropIndex.value = null
  fileDropIndex.value = null
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

/** 位移超过这个距离才算拖选 —— 单击（含点完微抖）仍是原生光标落点。 */
const DRAG_THRESHOLD = 4

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
onMounted(() => restoreScroll(activePath.value))
onBeforeUnmount(() => {
  rememberScroll(activePath.value)
  clearCrossSelection()
})

/** 每个块的落点标记。同一时刻只画一条线：先判 before，末尾再特判 after。 */
function dropEdgeAt(index: number): BlockDropEdge {
  // 文件拖入不存在「拖回原处」这种空操作，落点永远有效。
  const file = fileDropIndex.value
  if (file !== null) return edgeOf(index, file)

  const to = dropIndex.value
  if (dragId.value === null || to === null || dropIsNoop.value) return "none"
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
  <ScrollArea class="min-h-0 flex-1">
    <!-- `data-doc` 给自检页当探针钩子：量正文列宽度（内容宽度偏好）时靠它定位这层容器。 -->
    <div
      ref="docRef"
      data-doc
      class="relative mx-auto w-full pt-16 pb-30 pr-10 pl-24"
      :style="docStyle"
      @dragstart="onDragStart"
      @dragover="onDragOver"
      @dragleave="onDragLeave"
      @drop="onDrop"
      @dragend="resetDrag"
      @paste="onPaste"
      @mousedown="onDocMouseDown"
    >
      <BlockItem
        v-for="(block, index) in activeDocument"
        :key="`${restoreTick}:${block.id}`"
        :block="block"
        :ordered-index="orderedIndexes.get(block.id) ?? 0"
        :dragging="dragId === block.id"
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

  <GalleryInsertDialog :kind="dialogKind" :index="fileInsertIndex" :retype-id="fileRetypeId" @close="closeFileInsert" />
</template>

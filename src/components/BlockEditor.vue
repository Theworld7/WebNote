<script setup lang="ts">
import type { BlockDropEdge, BlockType } from "@/types/workspace"
import { computed, nextTick, ref } from "vue"
import { ScrollArea } from "@/components/ui/scroll-area"
import { useWorkspace } from "@/composables/useWorkspace"
import { orderedIndexes as orderedIndexesOf } from "@/lib/blocks"
import { findEditable, focusEditable } from "@/lib/dom"
import { isFileDrag, pickImageFiles, readImageFile } from "@/lib/image"
import BlockItem from "./BlockItem.vue"

const {
  activeDocument,
  insertBlockAfter,
  insertBlockAt,
  appendBlock,
  changeBlockType,
  duplicateBlock,
  removeBlock,
  moveBlock,
  setImageSource,
} = useWorkspace()

/**
 * 有序列表序号。
 *
 * 原型用 CSS counter 算（伪元素方案），换成真实 DOM 节点后必须显式计算 ——
 * 规则收在 `orderedIndexes()` 里，与序列化的分组共用一份判断：**不相邻的 ol 各自从 1 数**。
 */
const orderedIndexes = computed(() => orderedIndexesOf(activeDocument.value))

/** 新块 / 转换后的块要接管焦点，等 DOM 落地再找元素。 */
async function focusBlock(id: string, at: "start" | "end" = "end") {
  await nextTick()
  const el = findEditable(id)
  if (el) focusEditable(el, at)
}

function handleInsertAfter(id: string, type: BlockType) {
  void focusBlock(insertBlockAfter(id, type))
}

function handleRetype(id: string, type: BlockType) {
  changeBlockType(id, type)
  void focusBlock(id)
}

function handleRemove(id: string) {
  const blocks = activeDocument.value
  const index = blocks.findIndex((item) => item.id === id)
  removeBlock(id)
  // 删完把自己交给前一个块；删的是首块则落到新的首块。
  const target = blocks[Math.max(index - 1, 0)]
  if (target) void focusBlock(target.id)
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
  const rows = root.querySelectorAll("[data-block-id]")
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
  const target = event.target
  // 只有手柄发起的才算排序。正文里选中文字也会触发 dragstart，那种放过。
  if (!(target instanceof HTMLElement) || target.closest("[data-drag-handle]") === null) return
  const row = target.closest("[data-block-id]")
  if (!(row instanceof HTMLElement)) return
  const id = row.dataset.blockId
  if (id === undefined) return

  dragId.value = id
  dropIndex.value = null
  if (event.dataTransfer === null) return
  event.dataTransfer.effectAllowed = "move"
  // 必须写点数据：某些 WebView 在 dataTransfer 全空时干脆不认这次拖拽，连 dragover 都不给。
  event.dataTransfer.setData("text/plain", id)
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
  const row = active.closest("[data-block-id]")
  if (!(row instanceof HTMLElement)) return activeDocument.value.length
  const id = row.dataset.blockId
  if (id === undefined) return activeDocument.value.length
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
    <div
      ref="docRef"
      class="mx-auto w-full max-w-[800px] pt-5 pb-30 pr-10 pl-24"
      @dragstart="onDragStart"
      @dragover="onDragOver"
      @dragleave="onDragLeave"
      @drop="onDrop"
      @dragend="resetDrag"
      @paste="onPaste"
    >
      <BlockItem
        v-for="(block, index) in activeDocument"
        :key="block.id"
        :block="block"
        :ordered-index="orderedIndexes.get(block.id) ?? 0"
        :dragging="dragId === block.id"
        :drop-edge="dropEdgeAt(index)"
        @insert-after="handleInsertAfter"
        @retype="handleRetype"
        @duplicate="duplicateBlock"
        @remove="handleRemove"
      />
    </div>
  </ScrollArea>
</template>

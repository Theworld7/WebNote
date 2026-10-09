<script setup lang="ts">
import type { Block, BlockDropEdge, BlockMenuKind, BlockType, InlineMark, InlineRun } from "@/types/workspace"
import type { OffsetRange } from "@/lib/marks"
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue"
import { Checkbox } from "@/components/ui/checkbox"
import { useWorkspace } from "@/composables/useWorkspace"
import { bodyHasMarkerIndent, isListType, isTextualBlock } from "@/lib/blocks"
import { focusEditable } from "@/lib/dom"
import { runsFromNode } from "@/lib/html"
import { runsText, runsToHtml } from "@/lib/inline"
import { marksAt, offsetRangeIn, paintRuns, shortcutMark, toggleMarkAt } from "@/lib/marks"
import { cn } from "@/lib/utils"
import BlockToolbar from "./BlockToolbar.vue"
import ImageBlockView from "./ImageBlockView.vue"
import InlineToolbar from "./InlineToolbar.vue"
import TableBlockView from "./TableBlockView.vue"

const props = defineProps<{
  block: Block
  /** ol 块在文档里的序号，从 1 起。非 ol 块忽略。 */
  orderedIndex: number
  /** 当前块是否正在被拖拽。拖拽中降透明度，标示「它正被搬走」。 */
  dragging: boolean
  /** 落点指示线画在哪条边。`none` 表示当前块不是落点。 */
  dropEdge: BlockDropEdge
}>()

const emit = defineEmits<{
  (event: "insert-after", id: string, type: BlockType): void
  (event: "retype", id: string, type: BlockType): void
  (event: "duplicate", id: string): void
  (event: "remove", id: string): void
}>()

const { setBlockRuns, toggleBlockChecked } = useWorkspace()

const bodyRef = ref<HTMLElement | null>(null)
/** 行内格式条的显示状态，null 表示不显示。坐标是视口坐标。 */
const toolbar = ref<{ marks: InlineMark[]; top: number; left: number } | null>(null)
const openMenu = ref<BlockMenuKind>("")
const typeMenuMode = ref<"insert" | "convert">("insert")

/** 只有正文块才有可编辑体；图片 / 表格当前是只读展示。 */
const textual = computed(() => (isTextualBlock(props.block) ? props.block : null))

/**
 * 菜单选中项会触发插入 / 删除，焦点该落在新块或上一块上（由 BlockEditor 决定）。
 * 这时候菜单关闭的回调必须让位，否则会把焦点抢回当前块。
 */
let yieldFocus = false

/**
 * contenteditable 走非受控：DOM 内容只在挂载时由数据写入一次，
 * 之后由浏览器维护，Vue 不回写 —— 否则每次输入都会重设内容把光标顶到开头。
 *
 * 这里写的是 `innerHTML` 而不是 `innerText`：正文是 runs，挂载时要让加粗 / 链接
 * 先成型；写纯文本会把一份富文本笔记在打开瞬间压平。
 */
onMounted(() => {
  const element = bodyRef.value
  const block = textual.value
  if (element === null || block === null) return
  element.innerHTML = runsToHtml(block.runs)
  document.addEventListener("selectionchange", refreshToolbar)
  // 捕获阶段：滚动发生在内层滚动容器里，不冒泡到 document。
  document.addEventListener("scroll", hideToolbar, true)
})

onBeforeUnmount(() => {
  document.removeEventListener("selectionchange", refreshToolbar)
  document.removeEventListener("scroll", hideToolbar, true)
})

/**
 * 收起格式条。
 *
 * 滚动会让浮条跟选区脱节 —— 它是 fixed 定位，而文字跟着内容走。与其追着重算位置，
 * 不如照惯例收起来，等下一次选区变化（用户松手、再选）自然会回来。
 */
function hideToolbar() {
  toolbar.value = null
}

// 转换类型时清空内容（与原型一致）。块对象被替换但 id 未变，组件实例复用，需手动清。
watch(
  () => props.block.type,
  () => {
    const element = bodyRef.value
    if (element) element.innerHTML = ""
  },
)

/**
 * 选区变化时决定格式条露不露面。
 *
 * document 级的 selectionchange 每个块都会收到，所以开头几道判断要尽量便宜：焦点不在
 * 本块就立刻返回。跨块选区由 `offsetRangeIn` 里的 contains 挡掉 —— 两端不可能同时落在
 * 同一个可编辑体里。
 */
function refreshToolbar() {
  const element = bodyRef.value
  const block = textual.value
  if (element === null || block === null || document.activeElement !== element) {
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
    marks: marksAt(block.runs, range.start),
    top: rect.top - 8,
    left: rect.left + rect.width / 2,
  }
}

/**
 * 把新的 runs 画回 DOM、复原选区，再刷新格式条的激活态。
 *
 * 正文块特有的只有最后那步：选区回到同一段文字上，哪几个格式亮着可能已经变了。
 */
function paint(runs: InlineRun[], range: OffsetRange) {
  const element = bodyRef.value
  if (element === null) return
  paintRuns(element, runs, range)
  refreshToolbar()
}

/** 对当前选区切换一个行内标记。格式条与快捷键共用这一条路。 */
function applyMark(mark: InlineMark) {
  const element = bodyRef.value
  const block = textual.value
  if (element === null || block === null) return

  const range = offsetRangeIn(element)
  if (range === null) return

  const runs = toggleMarkAt(block.runs, range, mark)
  setBlockRuns(block.id, runs)
  paint(runs, range)
}

function onInput() {
  const element = bodyRef.value
  if (element === null) return

  // 回读时关掉空白折叠：用户敲的空格是有意义的。解析静态 HTML 时才折叠。
  const runs = runsFromNode(element, { collapseWhitespace: false })
  const text = runsText(runs)

  // 删空后浏览器可能残留 <br>，`:empty` 就不成立、占位符不显示。这里归一成真空元素。
  if (text === "") {
    element.innerHTML = ""
    setBlockRuns(props.block.id, [])
    return
  }

  setBlockRuns(props.block.id, runs)

  // 空行输入 `/` 唤起类型菜单（convert 模式）。触发字符被吃掉，不留在内容里。
  if (openMenu.value === "" && text.trim() === "/") {
    typeMenuMode.value = "convert"
    openMenu.value = "type"
  }
}

function onKeydown(event: KeyboardEvent) {
  // 中文输入法组字中的 Enter 是确认候选词，不能当成换块。
  if (event.isComposing) return

  // 行内格式快捷键。接管而不是放给浏览器的原生 execCommand：原生那条路产出
  // `<b>` 而不是序列化产物里的 `<strong>`，高亮更没有跨浏览器一致的写法。
  const mark = shortcutMark(event)
  if (mark !== null) {
    event.preventDefault()
    applyMark(mark)
    return
  }

  const text = bodyRef.value?.innerText ?? ""

  if (event.key === "Enter" && !event.shiftKey) {
    event.preventDefault()
    // 空的列表项 / 待办项回车 → 退出该形态，变回普通文本块。
    if (text === "" && (isListType(props.block.type) || props.block.type === "todo")) {
      yieldFocus = true
      emit("retype", props.block.id, "text")
      return
    }
    emit("insert-after", props.block.id, props.block.type)
    return
  }

  if (event.key === "Backspace" && text === "") {
    event.preventDefault()
    yieldFocus = true
    emit("remove", props.block.id)
  }
}

async function onMenuChange(value: BlockMenuKind) {
  openMenu.value = value
  if (value !== "") return
  typeMenuMode.value = "insert"
  const shouldRefocus = !yieldFocus
  yieldFocus = false
  if (!shouldRefocus) return
  // 菜单关掉后焦点默认落在触发按钮上，得手动送回正文。
  await nextTick()
  const element = bodyRef.value
  if (element) focusEditable(element, "end")
}

const markerText = computed(() => (props.block.type === "ol" ? `${props.orderedIndex}.` : "•"))

const blockClass = computed(() => {
  switch (props.block.type) {
    case "h1":
      return "pt-4 pb-0.5"
    case "h2":
      return "pt-3.5 pb-0.5"
    case "divider":
      return "py-2.5"
    default:
      return "py-[3px]"
  }
})

/**
 * 行内样式：手柄纵向偏移 + 列表缩进。
 *
 * 缩进用 `margin-left` 而不是 `padding-left`：手柄是 `left: -50px` 的绝对定位，
 * 它的包含块是行的 padding box，padding 不会把它推走，margin 才会 ——
 * 缩进时手柄得跟着内容一起右移。
 */
const rowStyle = computed(() => {
  const block = textual.value
  const type = props.block.type
  const top = type === "h1" ? "18px" : type === "h2" ? "16px" : "2px"
  const depth = block === null ? 0 : Math.min(block.depth, 6)
  return {
    "--tools-top": top,
    "margin-left": depth === 0 ? "0px" : `${depth * 22}px`,
  }
})

const BODY_BASE = "min-h-6 outline-none whitespace-pre-wrap break-words"

/**
 * 落点指示线：2px 圆角短横线，压在块的上下沿上。
 * 用伪元素而不是真 DOM —— 线不参与布局，拖拽过程中不会把下面的块推来推去。
 */
const DROP_BEFORE =
  "before:pointer-events-none before:absolute before:inset-x-0 before:-top-px before:h-[2px] before:rounded-full before:bg-selection-foreground before:content-['']"
const DROP_AFTER =
  "after:pointer-events-none after:absolute after:inset-x-0 after:-bottom-px after:h-[2px] after:rounded-full after:bg-selection-foreground after:content-['']"

/** 空块占位。divider 没有正文，不参与。 */
const PLACEHOLDER = "empty:before:content-['输入内容，或按_/_唤起块类型'] empty:before:text-muted-foreground"

const bodyClass = computed(() => {
  const block = textual.value
  if (block === null) return BODY_BASE

  const indent = bodyHasMarkerIndent(block.type) ? "pl-6" : ""
  const text = "text-sm leading-[1.65] text-foreground/90"
  switch (block.type) {
    case "h1":
      return cn(BODY_BASE, PLACEHOLDER, "text-2xl font-medium leading-[1.35] tracking-[-0.01em] text-foreground/90")
    case "h2":
      return cn(BODY_BASE, PLACEHOLDER, "text-lg font-medium leading-[1.4] text-foreground/90")
    case "h3":
      return cn(BODY_BASE, PLACEHOLDER, "text-[15.5px] font-medium text-foreground/90")
    case "quote":
      return cn(BODY_BASE, PLACEHOLDER, "my-1 rounded-lg bg-muted px-3.5 py-2.5 text-[oklch(0.42_0_0)]")
    case "code":
      return cn(
        BODY_BASE,
        PLACEHOLDER,
        "my-1 rounded-lg bg-muted-strong px-3.5 py-2.5 font-mono text-[12.5px] leading-[1.7] text-[oklch(0.3_0_0)]",
      )
    case "callout":
      return cn(BODY_BASE, PLACEHOLDER, "my-1 rounded-lg bg-selection px-3.5 py-2.5 text-[oklch(0.33_0.05_255)]")
    case "todo":
      return cn(BODY_BASE, PLACEHOLDER, text, indent, block.checked === true && "text-muted-foreground line-through")
    default:
      return cn(BODY_BASE, PLACEHOLDER, text, indent)
  }
})
</script>

<template>
  <div
    class="group relative"
    :data-block-id="block.id"
    :class="[
      blockClass,
      dragging && 'opacity-40',
      dropEdge === 'before' && DROP_BEFORE,
      dropEdge === 'after' && DROP_AFTER,
    ]"
    :style="rowStyle"
  >
    <BlockToolbar
      :open-menu="openMenu"
      :type-menu-mode="typeMenuMode"
      @update:open-menu="onMenuChange"
      @insert="(type: BlockType) => emit('insert-after', block.id, type)"
      @retype="(type: BlockType) => emit('retype', block.id, type)"
      @duplicate="emit('duplicate', block.id)"
      @remove="emit('remove', block.id)"
    />

    <span
      v-if="isListType(block.type)"
      class="pointer-events-none absolute left-0.5 top-1.5 w-5 text-center text-[13px] leading-[1.65] text-muted-foreground"
    >
      {{ markerText }}
    </span>

    <Checkbox
      v-if="block.type === 'todo'"
      class="absolute left-0.5 top-[5px] size-3.5 data-checked:border-selection-foreground data-checked:bg-selection-foreground"
      :model-value="block.checked === true"
      @update:model-value="() => toggleBlockChecked(block.id)"
    />

    <ImageBlockView v-if="block.type === 'image'" :block="block" />

    <TableBlockView v-else-if="block.type === 'table'" :block="block" />

    <div v-else-if="block.type === 'divider'" class="h-px bg-line" />

    <div
      v-else
      ref="bodyRef"
      :data-editable="block.id"
      contenteditable="true"
      spellcheck="false"
      :class="bodyClass"
      @input="onInput"
      @keydown="onKeydown"
    />

    <!-- 传送到 body：格式条用 fixed 定位，留在块里的话，祖先一旦有 transform
         （滚动容器、后续可能的动效）就会改成相对那个祖先定位，位置会漂。 -->
    <Teleport to="body">
      <InlineToolbar
        v-if="toolbar !== null"
        :marks="toolbar.marks"
        :anchor="{ top: toolbar.top, left: toolbar.left }"
        @toggle="applyMark"
      />
    </Teleport>
  </div>
</template>

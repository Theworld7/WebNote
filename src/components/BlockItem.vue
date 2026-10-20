<script setup lang="ts">
import type { Block, BlockDropEdge, BlockInsertPosition, BlockMenuKind, BlockType, InlineRun } from "@/types/workspace"
import { computed, nextTick, onMounted, ref, watch } from "vue"
import { Checkbox } from "@/components/ui/checkbox"
import { useWorkspace } from "@/composables/useWorkspace"
import { useInlineToolbar } from "@/composables/useInlineToolbar"
import { blockText, hasLeadingMarker, isListType, isTextualBlock, tableToTsv } from "@/lib/blocks"
import { tableHtml } from "@/lib/html/serialize"
import { requestEditableFocus } from "@/lib/dom"
import { runsFromNode } from "@/lib/html"
import { runsText, runsToHtml } from "@/lib/inline"
import { caretOffsetIn, shortcutMark, splitRunsAt } from "@/lib/marks"
import {
  BODY_TEXT_CLASS,
  CHECKBOX_TOP,
  HANDLE_SIZE,
  MARKER_TOP,
  firstLineCenter,
  headingClass,
  indentStyle,
  spacingClass,
} from "@/lib/typography"
import { cn } from "@/lib/utils"
import BlockToolbar from "./BlockToolbar.vue"
import BookmarkBlockView from "./BookmarkBlockView.vue"
import ChatBlockView from "./ChatBlockView.vue"
import ImageBlockView from "./ImageBlockView.vue"
import InlineToolbar from "./InlineToolbar.vue"
import LayoutBlockView from "./LayoutBlockView.vue"
import LinkPopover from "./LinkPopover.vue"
import MermaidBlockView from "./MermaidBlockView.vue"
import CodeBlockView from "./CodeBlockView.vue"
import TableBlockView from "./TableBlockView.vue"
import DataTableBlockView from "./DataTableBlockView.vue"
import GalleryBlockView from "./GalleryBlockView.vue"
import HtmlBlockView from "./HtmlBlockView.vue"
import KanbanBlockView from "./KanbanBlockView.vue"
import LedgerBlockView from "./LedgerBlockView.vue"
import StatBlockView from "./StatBlockView.vue"
import { CELL_EXCLUDED_TYPES } from "@/lib/blocks"

const props = defineProps<{
  block: Block
  /** ol 块在文档里的序号，从 1 起。非 ol 块忽略。 */
  orderedIndex: number
  /** 当前块是否正在被拖拽。拖拽中降透明度，标示「它正被搬走」。 */
  dragging: boolean
  /** 落点指示线画在哪条边。`none` 表示当前块不是落点。 */
  dropEdge: BlockDropEdge
  /** 是否渲染在布局格子里：菜单滤掉容器/引用块、手柄贴内容左缘、行首留出手柄位。 */
  inCell?: boolean
}>()

const emit = defineEmits<{
  (event: "insert-after", id: string, type: BlockType): void
  (event: "insert-before", id: string, type: BlockType): void
  (event: "split-after", id: string, type: BlockType, tail: InlineRun[]): void
  (event: "retype", id: string, type: BlockType): void
  (event: "duplicate", id: string): void
  (event: "remove", id: string): void
}>()

const { setBlockRuns, toggleBlockChecked } = useWorkspace()

const bodyRef = ref<HTMLElement | null>(null)
const openMenu = ref<BlockMenuKind>("")
const typeMenuMode = ref<"insert" | "convert">("insert")

/** 承载 runs 的正文块才走下面那套 contenteditable；图片 / 表格 / mermaid 各有自己的视图组件。 */
const textual = computed(() => (isTextualBlock(props.block) ? props.block : null))

// 浮条与链接浮层的编排收在 composable 里，与表格单元格共用同一套（见 useInlineToolbar）。
const { toolbar, linkEdit, applyMark, applyColor, openLink, applyLink } = useInlineToolbar({
  target: () => bodyRef.value,
  getRuns: () => textual.value?.runs ?? [],
  commit: (runs) => setBlockRuns(props.block.id, runs),
})

/**
 * 菜单选中项会触发插入 / 删除，焦点该落在新块或上一块上（由 BlockEditor 决定）。
 * 这时候菜单关闭的回调必须让位，否则会把焦点抢回当前块。
 */
let yieldFocus = false

/**
 * 菜单里的动作项一挑，焦点就归这次动作的结果（新块 / 转换后的块 / 上一块）。
 * 三个 emit 统一在这里打让位标记：漏一个，菜单关闭的回调就会把焦点抢回本块，
 * 用户点完菜单还得自己去点新块才能打字。
 */
function onInsertFromMenu(type: BlockType, position: BlockInsertPosition) {
  yieldFocus = true
  if (position === "above") emit("insert-before", props.block.id, type)
  else emit("insert-after", props.block.id, type)
}

function onRetypeFromMenu(type: BlockType) {
  yieldFocus = true
  emit("retype", props.block.id, type)
}

function onRemoveFromMenu() {
  yieldFocus = true
  emit("remove", props.block.id)
}

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
})

// 转换类型时按数据重画正文(转换会带着 runs 走)。块对象被替换但 id 未变,组件实例
// 复用;结构性块进出时正文层整个换挂载,所以等 DOM 落地后统一按 runs 重画 ——
// 空 runs 自然就是清空,`/` 触发的转换走同一条路。
watch(
  () => props.block.type,
  () => {
    void nextTick(() => {
      const element = bodyRef.value
      const block = textual.value
      if (element === null) return
      element.innerHTML = block === null ? "" : runsToHtml(block.runs)
    })
  },
)

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

  // 空行输入 `/` 唤起类型菜单（convert 模式）。触发字符当场吃掉：`/` 是手势不是内容，
  // 留着的话切成标题 / 引用会把它一起带进新块，取消菜单也会在块里留一个孤零零的斜杠。
  if (openMenu.value === "" && text.trim() === "/") {
    typeMenuMode.value = "convert"
    openMenu.value = "type"
    element.innerHTML = ""
    setBlockRuns(props.block.id, [])
  }
}

/**
 * 在光标处把本块正文切成两半，光标之后的内容即返回值的前半留在 DOM / 数据里。
 * 光标不在正文内、或在末尾（无事可拆）时返回 null。
 *
 * runs 从 DOM 现读而不是用 props 里的：光标是相对 DOM 量的，两边万一漂移，
 * 按同一份事实切才不会错位。
 */
function splitAtCaret(): InlineRun[] | null {
  const element = bodyRef.value
  if (element === null) return null
  const caret = caretOffsetIn(element)
  if (caret === null) return null

  const runs = runsFromNode(element, { collapseWhitespace: false })
  if (caret >= runsText(runs).length) return null

  const { head, tail } = splitRunsAt(runs, caret)
  // contenteditable 非受控：本块的 DOM 与高亮层要自己按前半重画（焦点马上移去新块，无需复原选区）。
  element.innerHTML = runsToHtml(head)
  setBlockRuns(props.block.id, head)
  return tail
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
    // 段落中间回车 → 光标之后的内容带去新块。Shift+Enter 是块内软换行，
    // 放行给浏览器插 <br>，不经这条分支。
    const tail = splitAtCaret()
    if (tail !== null) {
      emit("split-after", props.block.id, props.block.type, tail)
      return
    }
    // 标题末尾回车 → 新块直接落文本块：写完标题回车是开始写正文，不是接着写标题。
    // 拆块分支不受影响 —— 标题中间回车仍是把标题切成两半。
    const isHeading = /^h[1-6]$/.test(props.block.type)
    emit("insert-after", props.block.id, isHeading ? "text" : props.block.type)
    return
  }

  if (event.key === "Backspace" && text === "") {
    event.preventDefault()
    yieldFocus = true
    emit("remove", props.block.id)
  }
}

function onMenuChange(value: BlockMenuKind) {
  openMenu.value = value
  if (value !== "") return
  typeMenuMode.value = "insert"
  const shouldRefocus = !yieldFocus
  yieldFocus = false
  if (!shouldRefocus) return
  // 菜单关掉后焦点默认落在触发按钮上，得手动送回正文。菜单项这时还在卸载，
  // 当场聚焦会被它一起带走的 —— 交给菜单的关闭回调落（`requestEditableFocus`）。
  const element = bodyRef.value
  if (element) requestEditableFocus(element, "end")
}

const markerText = computed(() => (props.block.type === "ol" ? `${props.orderedIndex}.` : "•"))

/**
 * 布局块已有格子 → 底部悬浮条在，手柄停靠进去；还没选布局方式时空布局没有悬浮条，
 * 手柄照旧贴块左缘外挂。
 */
const layoutDocked = computed(() => props.block.type === "layout" && props.block.cells.length > 0)

/**
 * 块外边距。折叠后的实际距离见 `@/lib/typography` 的 `BLOCK_SPACING`：
 *
 * | 相邻            | 距离                        |
 * |-----------------|-----------------------------|
 * | 正文 ↔ 正文     | 16px                        |
 * | 正文 → 标题     | 28px                        |
 * | 标题 → 正文     | 20px（h4~h6 为 18px）       |
 * | 引用 / 分割线 ↔ | 12px 与邻居取大（挨正文即 16）|
 *
 * 首块与末块的外边距归零，对应 naive 的 `:first-child` / `:last-child` 规则
 * ——由模板上的 `first:mt-0 last:mb-0` 承担。
 */
const blockClass = computed(() => spacingClass(props.block.type))

/**
 * 行内样式：手柄纵向偏移 + 列表缩进。
 *
 * 缩进用 `margin-left` 而不是 `padding-left`：手柄是 `left: -50px` 的绝对定位，
 * 它的包含块是行的 padding box，padding 不会把它推走，margin 才会 ——
 * 缩进时手柄得跟着内容一起右移。
 */
const rowStyle = computed(() => {
  const block = textual.value
  return {
    "--tools-top": `${firstLineCenter(props.block.type) - HANDLE_SIZE / 2}px`,
    "margin-left": indentStyle(block === null ? 0 : block.depth),
  }
})

const BODY_BASE = "min-h-6 outline-none whitespace-pre-wrap break-words"

/**
 * 手柄菜单「复制内容」:表格同时写 text/html(在线表格只认 HTML 网格)与
 * text/plain(TSV,给不支持 HTML flavor 的接收方兜底),其余块走纯文本投影。
 */
async function copyContent() {
  const block = props.block
  if (block.type !== "table") {
    await navigator.clipboard.writeText(blockText(block))
    return
  }
  const tsv = tableToTsv(block.rows)
  const html = tableHtml(block.rows)
  if (typeof ClipboardItem !== "undefined") {
    try {
      await navigator.clipboard.write([
        new ClipboardItem({
          "text/plain": new Blob([tsv], { type: "text/plain" }),
          "text/html": new Blob([html], { type: "text/html" }),
        }),
      ])
      return
    } catch {
      // WebView 不支持多 flavor 写入时落到下面的老路。
    }
  }
  copyHtmlViaCommand(html)
}

/**
 * 兜底:把 HTML 选进一个离屏节点再 execCommand("copy"),webview 会顺手产出
 * text/html + text/plain 两种 flavor。execCommand 虽废弃,但这是唯一不依赖
 * ClipboardItem 的多 flavor 复制路。
 */
function copyHtmlViaCommand(html: string) {
  const host = document.createElement("div")
  host.contentEditable = "true"
  host.style.position = "fixed"
  host.style.opacity = "0"
  host.innerHTML = html
  document.body.appendChild(host)
  const selection = window.getSelection()
  if (selection !== null) {
    const range = document.createRange()
    range.selectNodeContents(host)
    selection.removeAllRanges()
    selection.addRange(range)
    document.execCommand("copy")
    selection.removeAllRanges()
  }
  host.remove()
}

/**
 * 落点指示线：2px 圆角短横线，压在块的上下沿上。
 * 用伪元素而不是真 DOM —— 线不参与布局，拖拽过程中不会把下面的块推来推去。
 */
const DROP_BEFORE =
  "before:pointer-events-none before:absolute before:inset-x-0 before:-top-px before:h-[2px] before:rounded-full before:bg-selection-foreground before:content-['']"
const DROP_AFTER =
  "after:pointer-events-none after:absolute after:inset-x-0 after:-bottom-px after:h-[2px] after:rounded-full after:bg-selection-foreground after:content-['']"

/** 空块占位。divider 没有正文，不参与。格子内空间窄，占位再降一号。 */
const PLACEHOLDER = "empty:before:content-['输入内容，或按_/_唤起块类型'] empty:before:text-muted-foreground"
const PLACEHOLDER_IN_CELL = "empty:before:text-[11px]"

const bodyClass = computed(() => {
  const block = textual.value
  if (block === null) return BODY_BASE

  const indent = hasLeadingMarker(block.type) ? "pl-6" : ""
  switch (block.type) {
    // 六级标题的字号 / 字重 / 字色走 `headingClass`（naive headerFontSize + headerFontWeight）。
    // 不单独设行高 —— naive 的 header.cssr 也不设，继承全局 1.6。
    case "h1":
    case "h2":
    case "h3":
    case "h4":
    case "h5":
    case "h6":
      return cn(BODY_BASE, PLACEHOLDER, headingClass(block.type))
    // 引用：左侧 4px 竖线 + 12px 左内边距，无底色无圆角（naive blockquote 的形态）。
    case "quote":
      return cn(BODY_BASE, PLACEHOLDER, "border-l-4 border-line pl-3", BODY_TEXT_CLASS)
    case "callout":
      return cn(
        BODY_BASE,
        PLACEHOLDER,
        "rounded-lg bg-selection px-3.5 py-2.5 text-[oklch(0.33_0.05_255)]",
        BODY_TEXT_CLASS,
      )
    case "todo":
      return cn(BODY_BASE, PLACEHOLDER, BODY_TEXT_CLASS, indent, block.checked === true && "text-muted-foreground line-through")
    default:
      return cn(BODY_BASE, PLACEHOLDER, BODY_TEXT_CLASS, indent)
  }
})
</script>

<template>
  <div
      class="group relative"
      :data-block-id="block.id"
      :class="[
        blockClass,
        // naive 的 :first-child / :last-child 归零：首块不额外下压、末块不留尾。
        'first:mt-0 last:mb-0',
        // 格子内不再为手柄预留文档流空间：工具条 absolute 贴左缘悬浮，hover 时才浮现。
        inCell === true && PLACEHOLDER_IN_CELL,
        dragging && 'opacity-40',
        dropEdge === 'before' && DROP_BEFORE,
        dropEdge === 'after' && DROP_AFTER,
      ]"
      :style="rowStyle"
    >
    <!-- 布局块的手柄不走这里：它投给 LayoutBlockView，停靠进底部悬浮条（见下方 #toolbar）。 -->
    <BlockToolbar
      v-if="block.type !== 'layout'"
      :block-type="block.type"
      :open-menu="openMenu"
      :type-menu-mode="typeMenuMode"
      :exclude-types="inCell === true ? CELL_EXCLUDED_TYPES : undefined"
      :inside="inCell === true"
      @update:open-menu="onMenuChange"
      @insert="onInsertFromMenu"
      @retype="onRetypeFromMenu"
      @duplicate="emit('duplicate', block.id)"
      @copy-content="copyContent"
      @remove="onRemoveFromMenu"
    />

    <span
      v-if="isListType(block.type)"
      class="pointer-events-none absolute left-0.5 w-5 text-center text-[13px] leading-[1.6] text-muted-foreground"
      :style="{ top: MARKER_TOP }"
    >
      {{ markerText }}
    </span>

    <Checkbox
      v-if="block.type === 'todo'"
      class="absolute left-0.5 size-3.5 data-checked:border-selection-foreground data-checked:bg-selection-foreground"
      :style="{ top: CHECKBOX_TOP }"
      :model-value="block.checked === true"
      @update:model-value="() => toggleBlockChecked(block.id)"
    />

    <ImageBlockView v-if="block.type === 'image'" :block="block" />

    <TableBlockView v-else-if="block.type === 'table'" :block="block" />

    <MermaidBlockView v-else-if="block.type === 'mermaid'" :block="block" />

    <CodeBlockView v-else-if="block.type === 'code'" :block="block" />

    <DataTableBlockView v-else-if="block.type === 'datatable'" :block="block" />

    <GalleryBlockView v-else-if="block.type === 'gallery'" :block="block" />

    <BookmarkBlockView v-else-if="block.type === 'bookmark'" :block="block" />

    <KanbanBlockView v-else-if="block.type === 'kanban'" :block="block" />

    <LedgerBlockView v-else-if="block.type === 'ledger'" :block="block" />

    <StatBlockView v-else-if="block.type === 'stat'" :block="block" />

    <ChatBlockView v-else-if="block.type === 'chat'" :block="block" />

    <LayoutBlockView v-else-if="block.type === 'layout'" :block="block">
      <!--
        布局块手柄的第二个落位。它与上面那份是同一条组件、同一套处理函数，只是外壳位置不同：
        停靠时由悬浮条排布（底条最左侧），空布局时回到块左缘外挂。改动时两处一起改。
      -->
      <template #toolbar>
        <BlockToolbar
          :block-type="block.type"
          :open-menu="openMenu"
          :type-menu-mode="typeMenuMode"
          :inside="inCell === true"
          :docked="layoutDocked"
          @update:open-menu="onMenuChange"
          @insert="onInsertFromMenu"
          @retype="onRetypeFromMenu"
          @duplicate="emit('duplicate', block.id)"
          @copy-content="copyContent"
          @remove="onRemoveFromMenu"
        />
      </template>
    </LayoutBlockView>

    <HtmlBlockView v-else-if="block.type === 'html'" :block="block" />

    <div v-else-if="block.type === 'divider'" class="h-px bg-line" />

    <div v-else class="relative">
      <!-- `data-block-type` 是页面级 CSS 预览的选择器改写钩子（见 lib/note-style.ts）：
           编辑器不把正文渲染成 `<p>` / `<h1>`，没有这个钩子，用户写的
           `h1 { color: red }` 在编辑器里一条都命中不了。别删。 -->
      <div
        ref="bodyRef"
        :data-editable="block.id"
        :data-block-type="block.type"
        contenteditable="true"
        spellcheck="false"
        :class="bodyClass"
        @input="onInput"
        @keydown="onKeydown"
      />
    </div>

    <!-- 传送到 body：格式条用 fixed 定位，留在块里的话，祖先一旦有 transform
         （滚动容器、后续可能的动效）就会改成相对那个祖先定位，位置会漂。 -->
    <Teleport to="body">
      <InlineToolbar
        v-if="toolbar !== null && linkEdit === null"
        :marks="toolbar.marks"
        :link="toolbar.link"
        :anchor="{ top: toolbar.top, left: toolbar.left }"
        @toggle="applyMark"
        @color="applyColor"
        @link="openLink"
      />
      <LinkPopover
        v-if="linkEdit !== null"
        :href="linkEdit.href"
        :shape="linkEdit.shape"
        :anchor="{ top: linkEdit.top, left: linkEdit.left }"
        @apply="applyLink"
        @close="linkEdit = null"
      />
    </Teleport>
  </div>
</template>

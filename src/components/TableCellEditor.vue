<script setup lang="ts">
import type { TableAlign, TableCell } from "@/types/workspace"
import { computed, onMounted, ref } from "vue"
import { useWorkspace } from "@/composables/useWorkspace"
import { useInlineToolbar } from "@/composables/useInlineToolbar"
import { runsFromNode } from "@/lib/html"
import { runsText, runsToHtml } from "@/lib/inline"
import { shortcutMark } from "@/lib/marks"
import { cn } from "@/lib/utils"
import InlineToolbar from "./InlineToolbar.vue"

/**
 * 一个表格单元格。
 *
 * 非受控：DOM 内容只在挂载时写一次，之后交给浏览器维护，Vue 不回写 ——
 * 受控（把数据绑到 `innerHTML`）会在每次输入后重设内容，光标被顶回格首。
 */
const props = defineProps<{
  blockId: string
  row: number
  column: number
  cell: TableCell
  /**
   * 随「表格效果」变化的折行策略（来自 `tableEffectClasses()`）。
   * 由 `TableBlockView` 传进来，而不是在这里读设置：效果是**整张表**的属性，
   * 一个表格块里几十个格子各读一次全局状态没有必要，也让这里少一个耦合同级设置的理由。
   */
  wrapClass: string
}>()

const emit = defineEmits<{ (event: "focus"): void }>()

const { setTableCellRuns } = useWorkspace()

/** 本格子的根元素。浮条的目标，也是挂载时写入初始 HTML 的地方。 */
const cellRef = ref<HTMLElement | null>(null)

// 浮条与快捷键共用同一条标记切换路（见 useInlineToolbar）；数据出口按行列定位到本格。
const { applyMark, applyColor, toolbar } = useInlineToolbar({
  target: () => cellRef.value,
  getRuns: () => props.cell.runs,
  commit: (runs) => setTableCellRuns(props.blockId, props.row, props.column, runs),
})

/** 单元格的 `data-editable` 记成 `块id/行/列`，加行加列后要按它把焦点送到新格子。 */
const editableKey = computed(() => `${props.blockId}/${props.row}/${props.column}`)

/**
 * 单元格只画右侧与下侧的内线 —— 外框与四个圆角归 `<table>`（见 `TableBlockView`）。
 * 四边都画的话，末行末列会与表格外框贴成 2px。
 *
 * 折行 / 不换行（`whitespace-*`、`break-words`、`min-w-16`）不在这里，
 * 而是由 `wrapClass` 按当前「表格效果」传入 —— 它们是整张表的属性。
 */
const CELL = "border-r border-b border-line px-2.5 py-1.5 align-top text-sm leading-[1.6] outline-none"

/**
 * 对齐 → 工具类。字面量写全，Tailwind 的 JIT 才扫得到（拼字符串会漏编译）。
 *
 * `left` 必须显式写出来：`<th>` 的 UA 默认是居中，不给类的话表头在编辑器里居中、
 * 在导出文件里靠左（`DOC_STYLE` 把 th/td 都定成左）—— 同一个文件两副样子。
 */
const ALIGN_CLASS: Record<TableAlign, string> = {
  left: "text-left",
  center: "text-center",
  right: "text-right",
}

const cellClass = computed(() =>
  cn(
    CELL,
    props.wrapClass,
    ALIGN_CLASS[props.cell.align ?? "left"],
    props.cell.header && "bg-muted font-medium",
  ),
)

onMounted(() => {
  const el = cellRef.value
  if (el === null) return
  el.innerHTML = runsToHtml(props.cell.runs)
})

function onInput(event: Event) {
  const el = event.currentTarget
  if (!(el instanceof HTMLElement)) return

  // 关掉空白折叠：格子里敲的空格是有意义的（与正文块的约定一致）。
  const runs = runsFromNode(el, { collapseWhitespace: false })
  if (runsText(runs) === "") {
    // 删空后浏览器可能残留 <br>，归一成真空元素，下次进来占位才正确。
    el.innerHTML = ""
    setTableCellRuns(props.blockId, props.row, props.column, [])
    return
  }
  setTableCellRuns(props.blockId, props.row, props.column, runs)
}

/**
 * 行内格式快捷键。与浮条按钮共用同一条切换路（composable 的 `applyMark`）：
 * 接管而不是放给浏览器的原生 execCommand，理由与正文块相同（见 BlockItem）。
 */
function onKeydown(event: KeyboardEvent) {
  if (event.isComposing) return

  const mark = shortcutMark(event)
  if (mark === null) return

  event.preventDefault()
  applyMark(mark)
}

const tag = computed(() => (props.cell.header ? "th" : "td"))
</script>

<template>
  <component
    :is="tag"
    ref="cellRef"
    contenteditable="true"
    spellcheck="false"
    :data-editable="editableKey"
    :class="cellClass"
    @input="onInput"
    @keydown="onKeydown"
    @focus="emit('focus')"
  />

  <!-- 单元格的格式条：与正文块同一套（useInlineToolbar），但不放链接按钮 ——
       链接浮层太宽，会盖住相邻格（理由见 InlineToolbar 的 noLink）。 -->
  <Teleport to="body">
    <InlineToolbar
      v-if="toolbar !== null"
      :marks="toolbar.marks"
      no-link
      :anchor="{ top: toolbar.top, left: toolbar.left }"
      @toggle="applyMark"
      @color="applyColor"
    />
  </Teleport>
</template>

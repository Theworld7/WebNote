<script setup lang="ts">
import type { TableAlign, TableCell } from "@/types/workspace"
import { computed, onMounted } from "vue"
import { useWorkspace } from "@/composables/useWorkspace"
import { findTableCell } from "@/lib/dom"
import { runsFromNode } from "@/lib/html"
import { runsText, runsToHtml } from "@/lib/inline"
import { offsetRangeIn, paintRuns, shortcutMark, toggleMarkAt } from "@/lib/marks"
import { cn } from "@/lib/utils"

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
}>()

const emit = defineEmits<{ (event: "focus"): void }>()

const { setTableCellRuns } = useWorkspace()

/** 单元格的 `data-editable` 记成 `块id/行/列`，加行加列后要按它把焦点送到新格子。 */
const editableKey = computed(() => `${props.blockId}/${props.row}/${props.column}`)

/**
 * 单元格只画右侧与下侧的内线 —— 外框与四个圆角归 `<table>`（见 `TableBlockView`）。
 * 四边都画的话，末行末列会与表格外框贴成 2px。
 */
const CELL =
  "min-w-16 border-r border-b border-line px-2.5 py-1.5 align-top text-sm leading-[1.6] outline-none whitespace-pre-wrap break-words"

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
  cn(CELL, ALIGN_CLASS[props.cell.align ?? "left"], props.cell.header && "bg-muted font-medium"),
)

onMounted(() => {
  const el = findTableCell(props.blockId, props.row, props.column)
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
 * 行内格式快捷键。
 *
 * 单元格里不放浮动的格式条：格子本身窄，浮条会盖住相邻单元格，位置也没地方摆。
 * 框选一段再点按钮在这里远不如键盘顺手，所以只留快捷键这一条路。
 */
function onKeydown(event: KeyboardEvent) {
  if (event.isComposing) return

  const mark = shortcutMark(event)
  if (mark === null) return

  const el = findTableCell(props.blockId, props.row, props.column)
  if (el === null) return

  const range = offsetRangeIn(el)
  if (range === null) return

  event.preventDefault()
  const runs = toggleMarkAt(props.cell.runs, range, mark)
  setTableCellRuns(props.blockId, props.row, props.column, runs)
  paintRuns(el, runs, range)
}

const tag = computed(() => (props.cell.header ? "th" : "td"))
</script>

<template>
  <component
    :is="tag"
    contenteditable="true"
    spellcheck="false"
    :data-editable="editableKey"
    :class="cellClass"
    @input="onInput"
    @keydown="onKeydown"
    @focus="emit('focus')"
  />
</template>

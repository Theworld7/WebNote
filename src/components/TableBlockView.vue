<script setup lang="ts">
import type { TableAlign, TableBlock } from "@/types/workspace"
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue"
import { PlusIcon, TableIcon } from "@lucide/vue"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { useWorkspace } from "@/composables/useWorkspace"
import { useSettings } from "@/composables/useSettings"
import { findTableCell, focusEditable } from "@/lib/dom"
import { columnAlign, isHeaderRow } from "@/lib/table"
import { tableEffectClasses } from "@/lib/typography"
import TableCellEditor from "./TableCellEditor.vue"
import TableSizePicker from "./TableSizePicker.vue"

/**
 * 表格块。
 *
 * 行列增删分两层：加行 / 加列是高频动作，直接给按钮（表格底部的浮岛）；
 * 「在某行上下插、删本行本列、切换表头、列对齐」这些低频且需要参照点的收进菜单。
 * 参照点就是最后聚焦过的格子 —— 没聚焦过就落在第一个格子。
 */
const props = defineProps<{ block: TableBlock }>()

const {
  defineTable,
  insertTableRow,
  removeTableRow,
  insertTableColumn,
  removeTableColumn,
  setTableHeaderRow,
  setTableColumnAlign,
} = useWorkspace()

const hasRows = computed(() => props.block.rows.length > 0)
const columnCount = computed(() => props.block.rows[0]?.length ?? 0)
const headerRow = computed(() => isHeaderRow(props.block.rows[0] ?? []))

/**
 * 表格效果来自全局设置（显示 → 表格效果），是**查看偏好**而非笔记内容：
 * 只挑类名，不改 `block.rows`，所以切设置不会让标签变脏。
 */
const { tableEffect } = useSettings()
const frame = computed(() => tableEffectClasses(tableEffect.value))

/**
 * 「右边还有内容」内阴影的显隐。
 *
 * 阴影压在表格**上面**，不能画在滚动容器的背景里 —— 表格的 `th` 有不透明底色、
 * `td` 有边框，实测会把容器背景整个盖住。所以它是一层独立的覆盖元素（见模板），
 * 这里只负责判断该不该露出来。
 *
 * 判据：`scrollLeft + clientWidth` 还没到 `scrollWidth`，即右边仍有未滚出的内容。
 * 留 1px 容差 —— 浏览器在非整数缩放下 `scrollLeft` 与 `scrollWidth - clientWidth`
 * 可能差零点几像素，不留容差会让阴影在最右端闪一下。
 *
 * 只有滚动模式才有意义；换行模式容器不可滚，`scrollWidth === clientWidth`，
 * 判定恒为 false，阴影自然不出现，不需要额外判 `tableEffect`。
 */
const scroller = ref<HTMLElement | null>(null)
const showRightShadow = ref(false)

function updateRightShadow() {
  const el = scroller.value
  if (el === null) {
    showRightShadow.value = false
    return
  }
  showRightShadow.value = el.scrollLeft + el.clientWidth < el.scrollWidth - 1
}

/**
 * 监听对象是滚动容器本身，不是 window —— 表格滚动只改容器自己的 `scrollLeft`。
 * `passive` 是因为只读不 preventDefault。
 *
 * 用 `ResizeObserver` 而不是 window 的 resize：容器的宽度还会随侧栏拖拽、
 * 窗口布局变化而变（这些不一定触发 window resize 的时机与表格相关），
 * 观察元素本身更直接，也能覆盖「首次挂载时还没算好宽度」这一下。
 */
let observer: ResizeObserver | null = null

onMounted(() => {
  const el = scroller.value
  if (el === null) return
  el.addEventListener("scroll", updateRightShadow, { passive: true })
  observer = new ResizeObserver(updateRightShadow)
  observer.observe(el)
  updateRightShadow()
})

onBeforeUnmount(() => {
  scroller.value?.removeEventListener("scroll", updateRightShadow)
  observer?.disconnect()
  observer = null
})

/**
 * 两种情况要重算：
 *
 * 1. **表格内容变了**（加列 / 删列 / 切表头）—— 宽度变了，可能从「没有溢出」
 *    变成「有溢出」，或反之。等 DOM 落地再量。
 * 2. **表格效果被切换了** —— 这是关键的一条，漏掉会留下脏状态：从滚动切回换行时
 *    容器的 `overflow-x` 由 auto 变 visible，此刻**不会**自动触发 scroll 事件，
 *    于是上一轮算出的 `true` 会僵在那里，换行模式平白多出一条阴影。
 *    实测确认过：不监听它，切回换行后阴影仍在。
 */
watch(
  () => [props.block.rows.length, columnCount.value, tableEffect.value] as const,
  () => void nextTick(updateRightShadow),
)

/** 最后聚焦过的格子。 */
const cursor = ref({ row: 0, column: 0 })

/** 光标所在行列可能已被删掉，用之前夹回合法范围。 */
const anchor = computed(() => ({
  row: Math.min(cursor.value.row, Math.max(props.block.rows.length - 1, 0)),
  column: Math.min(cursor.value.column, Math.max(columnCount.value - 1, 0)),
}))

/** 新格子要等 DOM 落地才存在，聚焦前先等一拍。 */
function focusCell(row: number, column: number) {
  void nextTick(() => {
    const el = findTableCell(props.block.id, row, column)
    if (el !== null) focusEditable(el, "end")
  })
}

function addRow() {
  const at = props.block.rows.length
  insertTableRow(props.block.id, at)
  focusCell(at, anchor.value.column)
}

function addColumn() {
  const at = columnCount.value
  insertTableColumn(props.block.id, at)
  focusCell(anchor.value.row, at)
}

function insertRowAt(at: number) {
  insertTableRow(props.block.id, at)
  focusCell(at, anchor.value.column)
}

function insertColumnAt(at: number) {
  insertTableColumn(props.block.id, at)
  focusCell(anchor.value.row, at)
}

function deleteRow() {
  removeTableRow(props.block.id, anchor.value.row)
}

function deleteColumn() {
  removeTableColumn(props.block.id, anchor.value.column)
}

function toggleHeader() {
  setTableHeaderRow(props.block.id, !headerRow.value)
}

/** 锚点列当前的对齐，用来在子菜单里打勾。整列永远是被一起写掉的，所以取首行即该列的值。 */
const alignment = computed(() => columnAlign(props.block.rows, anchor.value.column))

/** 三档对齐。菜单里的顺序固定为「左 → 中 → 右」，与工具栏的习惯一致。 */
const ALIGN_ITEMS = [
  { align: "left", label: "左对齐" },
  { align: "center", label: "居中" },
  { align: "right", label: "右对齐" },
] satisfies readonly { align: TableAlign; label: string }[]

function alignColumn(align: TableAlign) {
  setTableColumnAlign(props.block.id, anchor.value.column, align)
}

/** 菜单外框与菜单项，与块手柄的两套菜单同一套参数。 */
const MENU = "w-[244px] rounded-island p-1.5 shadow-pop ring-0"
const SUB_MENU = "w-[148px] rounded-island p-1.5 shadow-pop ring-0"
const ITEM = "gap-2.5 rounded-[7px] px-2 py-1"
const MARKER = "w-5.5 shrink-0 text-center font-mono text-[11.5px] text-muted-foreground"
</script>

<template>
  <!-- 空表：先挑尺寸。首行默认当表头 —— 笔记里的表多半有表头，没有再从菜单关掉。 -->
  <div v-if="!hasRows" class="my-1 rounded-lg bg-muted p-3">
    <div class="mb-2 text-[12px] text-muted-foreground">选择表格尺寸（首行为表头）</div>
    <TableSizePicker
      @pick="(columns: number, rows: number) => defineTable(block.id, columns, rows, true)"
    />
  </div>

  <div v-else class="group/tbl relative my-1">
    <!-- 滚动模式下真正出滚动条的是这层容器；换行模式下 `container` 是空串，
         它退化成一层透明 div，几何与从前一致（外框/圆角仍在 <table> 上，见 typography）。 -->
    <div ref="scroller" :class="frame.container">
      <table :class="frame.table">
        <tbody>
          <tr v-for="(row, rowIndex) in block.rows" :key="rowIndex">
            <TableCellEditor
              v-for="(cell, columnIndex) in row"
              :key="columnIndex"
              :block-id="block.id"
              :row="rowIndex"
              :column="columnIndex"
              :cell="cell"
              :wrap-class="frame.cell"
              @focus="cursor = { row: rowIndex, column: columnIndex }"
            />
          </tr>
        </tbody>
      </table>
    </div>

    <!-- 「右边还有内容」内阴影。压在表格之上（容器背景会被 th 底色盖住），
         所以是一层独立的、`pointer-events-none` 的覆盖元素，贴容器右缘。
         底边用 `bottom-2` 抬起来，避开容器为滚动条留的那段下内边距 —— 否则阴影会
         一路盖到滚动条上。`bottom-2` 与容器 `pb-2` 同值，typography 的
         `TABLE_SCROLL_SHADOW_INSET` 在编译期钉住两者。
         只在滚动模式下出现：换行模式容器不可滚，showRightShadow 恒为 false。 -->
    <div
      v-show="showRightShadow"
      class="table-scroll-shadow pointer-events-none absolute top-0 right-0 bottom-2 w-5"
      aria-hidden="true"
    />

    <div
      class="absolute -bottom-3.5 left-1/2 flex -translate-x-1/2 items-center gap-0.5 rounded-full bg-background p-0.5 opacity-0 shadow-island transition-opacity group-hover/tbl:opacity-100 focus-within:opacity-100"
    >
      <Button
        variant="ghost"
        size="sm"
        class="h-6 gap-1 rounded-full px-2 text-[12px] text-muted-foreground hover:text-foreground"
        @click="addRow"
      >
        <PlusIcon class="size-3" />行
      </Button>
      <Button
        variant="ghost"
        size="sm"
        class="h-6 gap-1 rounded-full px-2 text-[12px] text-muted-foreground hover:text-foreground"
        @click="addColumn"
      >
        <PlusIcon class="size-3" />列
      </Button>

      <DropdownMenu>
        <DropdownMenuTrigger as-child>
          <Button
            variant="ghost"
            size="sm"
            class="h-6 rounded-full px-2 text-muted-foreground hover:text-foreground"
            aria-label="表格菜单"
          >
            <TableIcon class="size-3.5" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent :class="MENU" side="top" :side-offset="8" align="center">
          <DropdownMenuLabel class="px-2 pb-1 pt-1.5 text-[11px] font-normal text-muted-foreground">
            第 {{ anchor.row + 1 }} 行 · 第 {{ anchor.column + 1 }} 列
          </DropdownMenuLabel>

          <DropdownMenuItem :class="ITEM" @select="insertRowAt(anchor.row)">
            <span :class="MARKER">↑+</span>
            <span>在上方插入行</span>
          </DropdownMenuItem>
          <DropdownMenuItem :class="ITEM" @select="insertRowAt(anchor.row + 1)">
            <span :class="MARKER">↓+</span>
            <span>在下方插入行</span>
          </DropdownMenuItem>
          <DropdownMenuItem :class="ITEM" @select="insertColumnAt(anchor.column)">
            <span :class="MARKER">←+</span>
            <span>在左侧插入列</span>
          </DropdownMenuItem>
          <DropdownMenuItem :class="ITEM" @select="insertColumnAt(anchor.column + 1)">
            <span :class="MARKER">→+</span>
            <span>在右侧插入列</span>
          </DropdownMenuItem>

          <DropdownMenuSeparator class="mx-2 my-1 bg-line" />

          <DropdownMenuItem :class="ITEM" @select="toggleHeader">
            <span :class="MARKER">▤</span>
            <span>{{ headerRow ? "取消表头行" : "设首行为表头" }}</span>
          </DropdownMenuItem>

          <DropdownMenuSeparator class="mx-2 my-1 bg-line" />

          <!-- 对齐挂在「列」上是使用口径：整列一起写，插行时新格继承同列，列内不会半截。 -->
          <DropdownMenuSub>
            <DropdownMenuSubTrigger :class="ITEM">
              <span :class="MARKER">↔</span>
              <span>第 {{ anchor.column + 1 }} 列对齐</span>
            </DropdownMenuSubTrigger>
            <DropdownMenuSubContent :class="SUB_MENU">
              <DropdownMenuItem
                v-for="item in ALIGN_ITEMS"
                :key="item.align"
                :class="ITEM"
                @select="alignColumn(item.align)"
              >
                <span :class="MARKER">{{ alignment === item.align ? "✓" : "" }}</span>
                <span>{{ item.label }}</span>
              </DropdownMenuItem>
            </DropdownMenuSubContent>
          </DropdownMenuSub>

          <DropdownMenuSeparator class="mx-2 my-1 bg-line" />

          <DropdownMenuItem variant="destructive" :class="ITEM" @select="deleteRow">
            <span :class="MARKER">✕</span>
            <span>删除本行</span>
          </DropdownMenuItem>
          <DropdownMenuItem variant="destructive" :class="ITEM" @select="deleteColumn">
            <span :class="MARKER">✕</span>
            <span>删除本列</span>
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  </div>
</template>

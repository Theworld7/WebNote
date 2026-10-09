<script setup lang="ts">
import type { TableAlign, TableBlock } from "@/types/workspace"
import { computed, nextTick, ref } from "vue"
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
import { findTableCell, focusEditable } from "@/lib/dom"
import { columnAlign, isHeaderRow } from "@/lib/table"
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
    <!-- 外框带 8px 圆角，内线由格子自己画。
         `border-collapse: collapse` 下浏览器会忽略 `border-radius`（计算值有、渲染出来是直角），
         所以外框与圆角交给 `<table>`（`border-separate` + `border-spacing: 0` 保证相邻格之间没有缝），
         格子只留右/下内线；末行末列去掉，否则会与外框贴成 2px。
         四角格子再各设一档内弧（8px 外弧减掉 1px 边框 = 7px），表头底色才跟着弧线走 ——
         `<table>` 的 `overflow: hidden` 在部分内核上对表格不生效，不指望它裁。
         末行不画下边框那条特例这次是必需的：外框改由表格自己画，留着才是双线。 -->
    <table
      class="w-full rounded-[8px] border border-line border-separate border-spacing-0 [&_tr:last-child>*]:border-b-0 [&_tr>*:last-child]:border-r-0 [&_tr:first-child>*:first-child]:rounded-tl-[7px] [&_tr:first-child>*:last-child]:rounded-tr-[7px] [&_tr:last-child>*:first-child]:rounded-bl-[7px] [&_tr:last-child>*:last-child]:rounded-br-[7px]"
    >
      <tbody>
        <tr v-for="(row, rowIndex) in block.rows" :key="rowIndex">
          <TableCellEditor
            v-for="(cell, columnIndex) in row"
            :key="columnIndex"
            :block-id="block.id"
            :row="rowIndex"
            :column="columnIndex"
            :cell="cell"
            @focus="cursor = { row: rowIndex, column: columnIndex }"
          />
        </tr>
      </tbody>
    </table>

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

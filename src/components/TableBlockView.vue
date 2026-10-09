<script setup lang="ts">
import type { TableBlock } from "@/types/workspace"
import { computed, nextTick, ref } from "vue"
import { PlusIcon, TableIcon } from "@lucide/vue"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { useWorkspace } from "@/composables/useWorkspace"
import { findTableCell, focusEditable } from "@/lib/dom"
import { isHeaderRow } from "@/lib/table"
import TableCellEditor from "./TableCellEditor.vue"
import TableSizePicker from "./TableSizePicker.vue"

/**
 * 表格块。
 *
 * 行列增删分两层：加行 / 加列是高频动作，直接给按钮（表格底部的浮岛）；
 * 「在某行上下插、删本行本列、切换表头」这些低频且需要参照点的收进菜单。
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

/** 菜单外框与菜单项，与块手柄的两套菜单同一套参数。 */
const MENU = "w-[244px] rounded-island p-1.5 shadow-pop ring-0"
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
    <!-- 最后一行不画下边框：那是表格的收口线，留着会与底部浮岛叠在一起显得脏。 -->
    <table class="w-full border-collapse [&_tr:last-child>*]:border-b-0">
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

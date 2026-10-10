<script setup lang="ts">
import type { DataColumn } from "@/types/data-table"
import type { DataRow } from "@/types/data-table"
import type { DataCellValue, DataColumnType, DataTable } from "@/types/data-table"
import { computed, onMounted, ref, shallowRef } from "vue"
import { PlusIcon, Trash2Icon } from "@lucide/vue"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import type { TableEntry } from "@/composables/useTables"
import { useTables } from "@/composables/useTables"
import { useWorkspace } from "@/composables/useWorkspace"
import * as dt from "@/lib/data-table"
import { MAX_DATA_TABLE_COLUMNS } from "@/types/data-table"

/**
 * 数据表编辑器 —— 编辑那**一个** `.tbl` 文件的界面。
 *
 * 它是「共享真源」这件事的落点：所有的编辑都在这里发生（或经由引用块，走同一个注册表），
 * 于是任何一处改动都立刻反映到所有引用它的笔记上。它自己不持有数据副本 —— 数据在
 * 注册表里，这里只是它的一个视图。
 *
 * 与笔记里的 `TableBlockView` 刻意不同：
 * - **不受「表格效果」偏好影响**。那个偏好解决的是「表格比正文列宽宽」的问题，而这里
 *   没有正文列 —— 表就是窗口的内容，永远按窗口宽 + 横向滚动（见 CONTEXT.md）。
 * - **列有类型**，列头是一个下拉菜单（改类型、删列），不是纯文本。
 * - **行不设上限**，这正是数据表存在的理由（见 CONTEXT.md 的「Data table bound」）。
 *
 * 单元格用朴素 `input` 而不是 `contenteditable`：格子装的是**数据**，不是正文 ——
 * 富文本、行内标记、非受控 DOM 那一整套在这里没有意义，而它会带来一堆复杂度。
 */
const { activePath, fsError } = useWorkspace()
const tables = useTables()

const mounted = ref(false)

/** 错误写到工作区那个出口，与其它错误同一个地方显示。 */
const errorSink = computed({
  get: () => fsError.value,
  set: (value: string) => {
    fsError.value = value
  },
})

/**
 * 当前正在编辑的那张表。
 *
 * **必须是 `shallowRef`**：`ref()` 会深度解包嵌套 ref，而 `TableEntry` 的字段本身
 * 就是 `Ref` —— 用 `ref` 装它会让 `entry.value.table` 退化成 `DataTable | null`，
 * 于是 `entry.value.table.value` 读到 `undefined`，编辑器永远空白。
 * 与引用块里的 `entry` 同一条理由。
 */
const entry = shallowRef<TableEntry | null>(null)

const table = computed(() => entry.value?.table.value ?? null)
const columns = computed<readonly DataColumn[]>(() => table.value?.columns ?? [])
const rows = computed<readonly DataRow[]>(() => table.value?.rows ?? [])

onMounted(async () => {
  if (activePath.value === "") return
  entry.value = await tables.use(activePath.value)
  mounted.value = true
})

/** 单行统计，给状态栏用。 */
const summary = computed(() => {
  if (table.value === null) return ""
  return `${columns.value.length} 列 · ${rows.value.length} 行`
})

async function change(next: (current: DataTable) => DataTable): Promise<void> {
  if (activePath.value === "") return
  await tables.mutate(activePath.value, next, errorSink)
}

// ---- 单元格 ----

function displayOf(row: DataRow, column: DataColumn): string {
  return dt.valueText(dt.cellValue(row, column), column)
}

/** 输入框文本 → 列类型对应的值。非法输入给空值，不保留原字符串（见引用块里的同一条注释）。 */
function parseCellInput(raw: string, type: DataColumnType): DataCellValue {
  if (type === "number") {
    if (raw.trim() === "") return null
    const parsed = Number(raw)
    return Number.isFinite(parsed) ? parsed : null
  }
  if (type === "date") {
    const trimmed = raw.trim()
    return /^\d{4}-\d{2}-\d{2}$/.test(trimmed) ? trimmed : null
  }
  if (type === "checkbox") return raw !== ""
  return raw === "" ? null : raw
}

function commitCell(row: DataRow, column: DataColumn, event: Event): void {
  const target = event.target
  if (!(target instanceof HTMLInputElement)) return
  const parsed = parseCellInput(target.value, column.type)
  if (parsed === dt.cellValue(row, column)) return
  void change((current) => dt.replaceRow(current, dt.setCell(row, column.id, parsed)))
}

function commitOnEnter(event: Event): void {
  const target = event.target
  if (target instanceof HTMLInputElement) target.blur()
}

function toggleCheck(row: DataRow, column: DataColumn, event: Event): void {
  const target = event.target
  if (!(target instanceof HTMLInputElement)) return
  void change((current) => dt.replaceRow(current, dt.setCell(row, column.id, target.checked)))
}

// ---- 行列 ----

function addRow(): void {
  void change((current) => dt.addRow(current))
}

function addColumn(): void {
  void change((current) => dt.addColumn(current))
}

function removeRow(rowId: string): void {
  void change((current) => dt.removeRow(current, rowId))
}

function removeColumn(columnId: string): void {
  void change((current) => dt.removeColumn(current, columnId))
}

function setColumnType(columnId: string, type: DataColumnType): void {
  void change((current) => dt.setColumnType(current, columnId, type))
}

function renameColumnAt(column: DataColumn, event: Event): void {
  const target = event.target
  if (!(target instanceof HTMLInputElement)) return
  const name = target.value.trim()
  if (name === column.name) return
  void change((current) => dt.renameColumn(current, column.id, name === "" ? column.name : name))
}

const atColumnLimit = computed(() => columns.value.length >= MAX_DATA_TABLE_COLUMNS)

const COLUMN_TYPE_ITEMS = [
  { type: "text", label: "文本" },
  { type: "number", label: "数字" },
  { type: "date", label: "日期" },
  { type: "select", label: "单选" },
  { type: "checkbox", label: "勾选" },
] satisfies readonly { type: DataColumnType; label: string }[]

/** 菜单外框与菜单项，与块手柄的两套菜单同一套参数。 */
const MENU = "w-[176px] rounded-island p-1.5 shadow-pop ring-0"
const ITEM = "gap-2.5 rounded-[7px] px-2 py-1"
const MARKER = "w-5.5 shrink-0 text-center font-mono text-[11.5px] text-muted-foreground"
</script>

<template>
  <!-- 读不到。文件被删或移走 —— 与引用块同一个立场：说明白，不喊错。 -->
  <div v-if="mounted && table === null" class="flex flex-1 items-center justify-center p-8">
    <div class="max-w-sm text-center">
      <p class="text-[13px] text-foreground/80">这个数据表读不到</p>
      <p class="mt-1.5 font-mono text-[11.5px] text-muted-foreground">{{ activePath }}</p>
      <p class="mt-3 text-[12px] text-muted-foreground">
        文件可能已被移动或删除，也可能不是合法的数据表文件。
      </p>
    </div>
  </div>

  <div v-else-if="table !== null" class="flex min-h-0 flex-1 flex-col gap-2">
    <!-- 工具条：加行加列在左，统计在右。 -->
    <div class="flex shrink-0 items-center gap-1 px-1">
      <Button
        variant="ghost"
        size="sm"
        class="h-7 gap-1 rounded-[7px] px-2 text-[12px] text-muted-foreground hover:text-foreground"
        @click="addRow"
      >
        <PlusIcon class="size-3" />行
      </Button>
      <Button
        variant="ghost"
        size="sm"
        class="h-7 gap-1 rounded-[7px] px-2 text-[12px] text-muted-foreground hover:text-foreground disabled:opacity-40"
        :disabled="atColumnLimit"
        @click="addColumn"
      >
        <PlusIcon class="size-3" />列
      </Button>

      <div class="flex-1" />

      <span class="pr-1 font-mono text-[11.5px] text-muted-foreground">{{ summary }}</span>
    </div>

    <!-- 表格：自己横向滚动，永远铺满窗口宽度（不受「表格效果」偏好影响）。 -->
    <div class="min-h-0 flex-1 overflow-auto rounded-lg border border-line">
      <table class="w-full border-separate border-spacing-0">
        <thead>
          <tr>
            <!-- 行号列。固定短宽度，不参与列模型。 -->
            <th class="sticky left-0 z-10 w-9 border-r border-b border-line bg-muted/60 px-2 py-1.5 text-right font-mono text-[10.5px] font-normal text-muted-foreground/70">
              #
            </th>
            <th
              v-for="column in columns"
              :key="column.id"
              class="min-w-32 border-r border-b border-line bg-muted/40 px-1.5 py-1 align-middle"
            >
              <div class="flex items-center gap-1">
                <!-- 列名可改：直接编输入框。 -->
                <input
                  class="min-w-0 flex-1 bg-transparent font-medium text-foreground/90 outline-none"
                  :value="column.name"
                  @keydown.enter.prevent="commitOnEnter"
                  @blur="(event: Event) => renameColumnAt(column, event)"
                >
                <DropdownMenu>
                  <DropdownMenuTrigger as-child>
                    <button
                      type="button"
                      class="shrink-0 rounded-[5px] px-1 font-mono text-[10px] text-muted-foreground/70 hover:bg-muted hover:text-foreground"
                    >
                      {{ dt.columnTypeLabel(column.type) }}
                    </button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent :class="MENU" align="end">
                    <DropdownMenuLabel class="px-2 pb-1 pt-1.5 text-[11px] font-normal text-muted-foreground">
                      列类型
                    </DropdownMenuLabel>
                    <DropdownMenuItem
                      v-for="item in COLUMN_TYPE_ITEMS"
                      :key="item.type"
                      :class="ITEM"
                      @select="setColumnType(column.id, item.type)"
                    >
                      <span :class="MARKER">{{ column.type === item.type ? "✓" : "" }}</span>
                      <span>{{ item.label }}</span>
                    </DropdownMenuItem>
                    <DropdownMenuSeparator class="mx-2 my-1 bg-line" />
                    <DropdownMenuItem
                      variant="destructive"
                      :class="ITEM"
                      :disabled="columns.length <= 1"
                      @select="removeColumn(column.id)"
                    >
                      <span :class="MARKER">✕</span>
                      <span>删除本列</span>
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
            </th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="(row, rowIndex) in rows" :key="row.id" class="group/drow">
            <th class="sticky left-0 z-10 border-r border-b border-line bg-muted/30 px-2 py-1 text-right font-mono text-[10.5px] font-normal text-muted-foreground/60">
              <span class="group-hover/drow:hidden">{{ rowIndex + 1 }}</span>
              <button
                type="button"
                class="hidden text-muted-foreground hover:text-destructive group-hover/drow:inline"
                aria-label="删除本行"
                @click="removeRow(row.id)"
              >
                <Trash2Icon class="ml-auto size-3" />
              </button>
            </th>
            <td
              v-for="column in columns"
              :key="column.id"
              class="border-r border-b border-line px-1.5 py-1 align-middle last:border-r-0"
            >
              <input
                v-if="column.type === 'checkbox'"
                type="checkbox"
                class="size-3.5 align-middle accent-foreground"
                :checked="dt.cellValue(row, column) === true"
                @change="(event: Event) => toggleCheck(row, column, event)"
              >
              <input
                v-else
                class="w-full bg-transparent outline-none placeholder:text-muted-foreground/40"
                :value="displayOf(row, column)"
                :placeholder="column.type === 'date' ? 'YYYY-MM-DD' : ''"
                @keydown.enter.prevent="commitOnEnter"
                @blur="(event: Event) => commitCell(row, column, event)"
              >
            </td>
          </tr>

          <!-- 末尾的「加一行」行：点一下就到下一行，比回工具条找按钮快。 -->
          <tr>
            <th class="sticky left-0 z-10 border-r border-line bg-muted/30" />
            <td :colspan="columns.length" class="border-line px-1.5 py-0">
              <button
                type="button"
                class="flex w-full items-center gap-1 rounded-[5px] px-1 py-0.5 text-left text-[12px] text-muted-foreground/50 hover:bg-muted hover:text-muted-foreground"
                @click="addRow"
              >
                <PlusIcon class="size-3" />新记录
              </button>
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  </div>
</template>

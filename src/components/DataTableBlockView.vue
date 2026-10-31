<script setup lang="ts">
import type { DataTableBlock } from "@/types/workspace"
import type { DataColumn, DataColumnType, DataRow } from "@/types/data-table"
import type { TableEffectClasses } from "@/lib/typography"
import { computed } from "vue"
import { ExternalLinkIcon, PlusIcon } from "@lucide/vue"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import TableRefNotice from "@/components/TableRefNotice.vue"
import OptionCell from "@/components/OptionCell.vue"
import { useSettings } from "@/composables/useSettings"
import { useTableEntry } from "@/composables/useTableEntry"
import { useWorkspace } from "@/composables/useWorkspace"
import { markImageBroken, usableImage } from "@/lib/broken-images"
import * as dt from "@/lib/data-table"
import { tableEffectClasses } from "@/lib/typography"

/**
 * 数据表引用块。
 *
 * 渲染的是**别人家的数据** —— 记录留在 `.tbl` 文件里（ADR-0005），这里只是它的一扇窗。
 * 因此三件事与笔记内的 `TableBlock` 不同：
 *
 * 1. **数据从注册表来**，不是从块里来。同一个路径在多篇笔记里指向**同一个响应式对象**，
 *    一处编辑立刻反映到所有窗口 —— 这是「像 SQLite 一样被多个 html 使用」这句话在运行时的落点。
 * 2. **编辑不走笔记的保存流程**。改一个格子会立刻写那个 `.tbl` 文件，笔记的脏标记**不变**：
 *    引用块的数据从来就不属于这篇笔记，把它算成笔记的改动是错的。
 * 3. **读不到是正常状态**，不是错误（见 `GLOSSARY.md` 的「Missing Data table」）。
 *    文件可能被移走或改名，用户也许正准备去找回来，所以给提示 + 重指定入口,而不是报错。
 *
 * 取数与改表走 `useTableEntry` 这条共用 seam —— 认领、释放、记脏的口径收在那边。
 */
const props = defineProps<{ block: DataTableBlock }>()

const { openFile, rebindTable, tablePaths } = useWorkspace()
const { tableEffect } = useSettings()

/** 表格效果对引用块生效（它是笔记里的一张表），数据表**编辑视图**则不受它影响。 */
const frame = computed<TableEffectClasses>(() => tableEffectClasses(tableEffect.value))

const { state, table, columns, rows, change } = useTableEntry(() => props.block.path)

function cellOf(row: DataRow, column: DataColumn): string {
  return dt.valueText(dt.cellValue(row, column), column)
}

/**
 * 图片格实际画出来的地址：空值、以及加载失败过的，都给空串 ——
 * 这个格子在引用块里是只读的，画不出来就安静地留白，不摆一张裂图。
 */
function imageSrcOf(row: DataRow, column: DataColumn): string {
  const value = dt.cellValue(row, column)
  return typeof value === "string" ? usableImage(value) : ""
}

/** `@error` 记账用：拿格子里存的原始地址，而不是解析后的 `img.src`。 */
function imageSourceOf(row: DataRow, column: DataColumn): string {
  const value = dt.cellValue(row, column)
  return typeof value === "string" ? value : ""
}

/** 打开数据表本身：切到它的标签页。引用块的「深潜」入口。 */
function openTable() {
  if (props.block.path === "") return
  // 走工作区的打开入口 —— 标签、按需读都由它统一管。
  openFile(props.block.path)
}

/** 输入框文本 → 值的解析口径收在 `lib/data-table.ts`，画册卡片与这里共用。 */

/**
 * 勾选格的切换。
 *
 * 抽成方法而不是写在模板里：模板里的内联处理函数拿不到全局 DOM 类型
 * （`HTMLInputElement` / `EventTarget` 在 `v-for` 的作用域下解析不到），
 * 也塞不进 `instanceof` 收窄。在这里写，类型是干净的。
 */
function toggleCheck(row: DataRow, column: DataColumn, event: Event): void {
  const target = event.target
  if (!(target instanceof HTMLInputElement)) return
  void change((current) => dt.replaceRow(current, dt.setCell(row, column.id, target.checked)))
}

/** Enter 提交：失焦即触发写盘。表格里按 Enter 的直觉就是「这一格填完了」。 */
function commitOnEnter(event: Event): void {
  const target = event.target
  if (target instanceof HTMLInputElement) target.blur()
}

/** 失焦提交。值没变就不写盘 —— 否则点一下格子再点走就产生一次无意义的写。 */
function commitOnBlur(row: DataRow, column: DataColumn, event: Event): void {
  const target = event.target
  if (!(target instanceof HTMLInputElement)) return
  const parsed = dt.parseCellInput(target.value, column.type)
  if (parsed === dt.cellValue(row, column)) return
  void change((current) => dt.replaceRow(current, dt.setCell(row, column.id, parsed)))
}

/**
 * 单选格的提交：空项即清空。选项本身的增删改名留在数据表编辑页 —— 这里是「一扇窗」。
 * 值由 `OptionCell` 递过来（选项 id 或空串），不再从事件里摸 DOM 控件。
 */
function commitOption(row: DataRow, column: DataColumn, value: string): void {
  const next = value === "" ? null : value
  if (next === dt.cellValue(row, column)) return
  void change((current) => dt.replaceRow(current, dt.setCell(row, column.id, next)))
}

function addRow() {
  void change((current) => dt.addRow(current))
}

function addColumn() {
  void change((current) => dt.addColumn(current))
}

const COLUMN_TYPE_ITEMS = [
  { type: "text", label: "文本" },
  { type: "number", label: "数字" },
  { type: "date", label: "日期" },
  { type: "select", label: "单选" },
  { type: "checkbox", label: "勾选" },
  { type: "image", label: "图片" },
] satisfies readonly { type: DataColumnType; label: string }[]

function setColumnType(columnId: string, type: DataColumnType) {
  void change((current) => dt.setColumnType(current, columnId, type))
}

function removeColumn(columnId: string) {
  void change((current) => dt.removeColumn(current, columnId))
}

/** 菜单外框与菜单项，与块手柄的两套菜单同一套参数。 */
const MENU = "w-[176px] rounded-island p-1.5 shadow-pop ring-1 ring-line/70"
const ITEM = "gap-2.5 rounded-[7px] px-2 py-1"
const MARKER = "w-5.5 shrink-0 text-center font-mono text-[12px] text-muted-foreground"
</script>

<template>
  <!-- 空指针(转换流程修好前的遗留块 / 手工编辑):如实说没指定,而不是永远转圈。 -->
  <TableRefNotice
    v-if="props.block.path === ''"
    kind="unset"
    label="引用块"
  />

  <!-- 引用的文件读不到：提示态，不是错误态 —— 提示条自带一条重新指向的出路。 -->
  <TableRefNotice
    v-else-if="state === 'missing' || state === 'failed'"
    kind="missing"
    label="引用块"
    :path="props.block.path"
    :tables="tablePaths"
    @reselect="(path: string) => rebindTable(props.block.id, path)"
  />

  <!-- 还没读完。 -->
  <TableRefNotice
    v-else-if="table === null"
    kind="loading"
    label="引用块"
  />

  <div v-else class="group/ref relative my-4">
    <div :class="frame.container">
      <table :class="[frame.table, 'text-[13px]']">
        <thead>
          <tr>
            <th
              v-for="column in columns"
              :key="column.id"
              :class="[frame.cell, 'bg-muted/40 text-left']"
            >
              <DropdownMenu>
                <DropdownMenuTrigger as-child>
                  <button
                    type="button"
                    class="flex w-full items-center gap-1.5 text-left font-medium text-foreground/90 hover:text-foreground"
                  >
                    <span class="truncate">{{ column.name }}</span>
                    <span class="shrink-0 font-mono text-[11px] font-normal text-muted-foreground/70">
                      {{ dt.columnTypeLabel(column.type) }}
                    </span>
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent :class="MENU" align="start">
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
            </th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="row in rows" :key="row.id" class="group/row">
            <!-- 数字列右对齐 + 等宽数字：金额 / 数量逐位上下对齐才好扫。表头不动 ——
                 它是可编辑的列名，右对齐会让光标贴右边缘，且主流的表格视图（Excel、
                 Airtable）也是「表头左、数字右」。 -->
            <td
              v-for="column in columns"
              :key="column.id"
              :class="[frame.cell, dt.isNumberColumn(column) && 'text-right tabular-nums']"
            >
              <!-- 勾选：一个真正的 checkbox，不走 contenteditable。 -->
              <input
                v-if="column.type === 'checkbox'"
                type="checkbox"
                class="size-3.5 align-middle accent-foreground"
                :checked="dt.cellValue(row, column) === true"
                @change="(event: Event) => toggleCheck(row, column, event)"
              >
              <!-- 图片格在这里只读：换图去数据表编辑页。这里挂选图控件就得跟块编辑器的
                   文件拖拽抢事件，不值得 —— 引用块是「一扇窗」，不是第二个编辑入口。 -->
              <div v-else-if="column.type === 'image'">
                <!-- 懒加载与编辑器同一口径：引用块挂载即整表渲染，图片不延迟解码
                     会把笔记打开拖住。 -->
                <img
                  v-if="imageSrcOf(row, column) !== ''"
                  :src="imageSrcOf(row, column)"
                  alt=""
                  loading="lazy"
                  decoding="async"
                  class="max-h-24 rounded-lg"
                  @error="markImageBroken(imageSourceOf(row, column))"
                />
              </div>
              <!-- 单选格：下拉选已有选项，空项给「—」。选项的增删改名在数据表编辑页，
                   这里只负责选值 —— 引用块是「一扇窗」，不是第二个编辑入口。
                   键盘模型与账目格同源（Tab 到就展开），组件是 `OptionCell`。 -->
              <OptionCell
                v-else-if="column.type === 'select'"
                class="cursor-pointer rounded hover:bg-muted/60"
                :model-value="String(dt.cellValue(row, column) ?? '')"
                :options="column.options"
                empty-label="—"
                :chevron="false"
                @pick="commitOption(row, column, $event)"
              />
              <!-- 其余类型都是文本外观。编辑用 contenteditable 太复杂（要处理富文本、
                   选区、非受控 DOM），这里用最朴素的输入：提交（blur / Enter）时写盘。
                   数据表的单元格本来就是数据，不是正文。 -->
              <input
                v-else
                class="w-full bg-transparent outline-none placeholder:text-muted-foreground/50"
                :class="dt.isNumberColumn(column) && 'text-right tabular-nums'"
                :value="cellOf(row, column)"
                :placeholder="column.type === 'date' ? 'YYYY-MM-DD' : ''"
                @keydown.enter.prevent="commitOnEnter"
                @blur="(event: Event) => commitOnBlur(row, column, event)"
              >
            </td>
          </tr>
        </tbody>
      </table>
    </div>

    <!-- 浮岛：加行 / 加列 / 跳到数据表本身。与 `TableBlockView` 同一套观感。 -->
    <div
      class="absolute -bottom-3.5 left-1/2 flex -translate-x-1/2 items-center gap-0.5 rounded-full bg-popover p-0.5 opacity-0 shadow-island transition-opacity group-hover/ref:opacity-100 focus-within:opacity-100"
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
      <Button
        variant="ghost"
        size="sm"
        class="h-6 gap-1 rounded-full px-2 text-[12px] text-muted-foreground hover:text-foreground"
        @click="openTable"
      >
        <ExternalLinkIcon class="size-3" />打开
      </Button>
    </div>
  </div>
</template>

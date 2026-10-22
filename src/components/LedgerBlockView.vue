<script setup lang="ts">
import type { LedgerBlock } from "@/types/workspace"
import type { DataColumn, DataRow } from "@/types/data-table"
import { computed } from "vue"
import { DatabaseIcon, PlusIcon, Settings2Icon, Trash2Icon } from "@lucide/vue"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import TableRefNotice from "@/components/TableRefNotice.vue"
import { useWorkspace } from "@/composables/useWorkspace"
import { useTableEntry } from "@/composables/useTableEntry"
import { useCellEditing } from "@/composables/useCellEditing"
import * as dt from "@/lib/data-table"
import { LEDGER_EXPENSE_COLOR, LEDGER_INCOME_COLOR, balanceMap, formatAmount, formatExpense, formatIncome, formatYuan, ledgerSections, ledgerSort, sortRows, sumRows } from "@/lib/ledger"

/**
 * 账目块:把一张数据表按财务口径渲染成流水账 —— 收入列 / 支出列带符号的金额、
 * 逐行累计的余额列、分组节(按月 / 按列)标题行内的小计、底部合计行。
 *
 * 数据链路与画册 / 书签 / 看板块完全同源,取数走 `useTableEntry` 共用 seam。
 * 求和 / 格式化 / 分节全部在 `lib/ledger`,与导出快照共用一份 —— 这里不重复公式。
 *
 * 就地增删改与看板卡的逐格编辑同一套口径(解析走 `dt.parseCellInput`):点格值即编辑,
 * 文本框 / 数字 / 日期是输入框,select 换下拉,勾选直接切;回车提交并跳到**下一行同列**
 * —— 纵向把一列金额录完最快;表底「记一笔」追加到末尾并把光标放进新行首格;行号列
 * 悬停变 ✕ 删行。金额格显示的是格式化后的带符号金额,一进编辑态就换回**原始数字**,
 * 于是「看到的是账,改的是数」,来回一趟不会把显示串解析成空。
 *
 * 逐格编辑的输入框**绝对定位浮在格值按钮上**、不参与文档流 —— 表格是 auto 布局,列宽由内容
 * 算出,输入框自带的 intrinsic 宽度会把列撑宽,点一下整张表就横向抖一次(详见模板里的注释)。
 * 校验这一点的断言在 `design/ledger-edit-check.html`(进出编辑态前后几何逐项相同)。
 *
 * 改动经 `useTableEntry` 的 `change` 记在当前笔记名下,与笔记共用同一个保存出口(保存
 * 笔记时 `.tbl` 与快照一起落盘)。注意撤销栈只管**块结构**,表内容不进历史 —— 删行
 * 不能 Ctrl+Z,只能靠不保存退回去。
 */
const props = defineProps<{ block: LedgerBlock }>()

const { openFile, updateBlockSettings } = useWorkspace()

const { state, table, columns, rows, change } = useTableEntry(() => props.block.path)

/** 收入 / 支出列。指向的列被删后落空,视图退化为「未设置」,无需清洗。 */
const incomeColumn = computed<DataColumn | null>(() =>
  props.block.incomeColumnId === "" ? null : columns.value.find((column) => column.id === props.block.incomeColumnId) ?? null,
)
const expenseColumn = computed<DataColumn | null>(() =>
  props.block.expenseColumnId === "" ? null : columns.value.find((column) => column.id === props.block.expenseColumnId) ?? null,
)

const hasMoney = computed(() => incomeColumn.value !== null || expenseColumn.value !== null)

/** 分组列。month 模式下是日期列,column 模式下是任意列;被删后落空退化为平铺。 */
const groupColumn = computed<DataColumn | null>(() =>
  props.block.groupMode === "none" || props.block.groupColumnId === ""
    ? null
    : columns.value.find((column) => column.id === props.block.groupColumnId) ?? null,
)

/** 生效的排序:排序列被删后退化为不排序;月节序跟随方向(不排序时恒升序)。 */
const sort = computed(() => ledgerSort(columns.value, props.block.sortColumnId, props.block.sortDirection))

/** 展示序 = 表内行序按块的排序设置排过 —— 分节、行号、回车跳格都读它。 */
const orderedRows = computed(() => sortRows(rows.value, sort.value))

/** 分节(按月 / 按列 / 平铺)+ 节小计,含末尾的落空节。公式在 `ledgerSections`,与导出快照共用。 */
const allSections = computed(() => {
  const { sections, loose } = ledgerSections(orderedRows.value, incomeColumn.value, expenseColumn.value, {
    mode: groupColumn.value === null ? "none" : props.block.groupMode,
    column: groupColumn.value,
    monthOrder: sort.value.monthOrder,
  })
  return loose === null ? sections : [...sections, loose]
})

/** 逐行累计余额(键 = 行 id)。按**原始行序**算 —— 排序与分组只改展示顺序,不改发生序。 */
const balances = computed<Map<string, number> | null>(() =>
  props.block.showBalance && hasMoney.value ? balanceMap(rows.value, incomeColumn.value, expenseColumn.value) : null,
)

/** 底部合计。 */
const totals = computed(() => sumRows(rows.value, incomeColumn.value, expenseColumn.value))

/** 某行在金额列上的数值。非数字(null / 文本)返回 null,展示为空格。 */
function moneyAt(row: DataRow, column: DataColumn | null): number | null {
  if (column === null) return null
  const value = dt.cellValue(row, column)
  return typeof value === "number" && Number.isFinite(value) ? value : null
}

function incomeText(row: DataRow): string {
  const value = moneyAt(row, incomeColumn.value)
  return value === null ? "" : formatIncome(value)
}

function expenseText(row: DataRow): string {
  const value = moneyAt(row, expenseColumn.value)
  return value === null ? "" : formatExpense(value)
}

/** 普通格的文本投影(image 列显示「[图片]」占位,与看板卡同一口径)。 */
function cellText(row: DataRow, column: DataColumn): string {
  const value = dt.cellValue(row, column)
  if (column.type === "image") return typeof value === "string" && value !== "" ? "[图片]" : ""
  return dt.valueText(value, column)
}

/** 右对齐(等宽数字)的列:数字列与两个金额列 —— 表体、合计行、编辑按钮共用同一条判据。 */
function isNumberish(column: DataColumn): boolean {
  return column.type === "number" || column === incomeColumn.value || column === expenseColumn.value
}

/** 合计标签的落点:第一个非金额列的下标。全列都是金额列时返回 -1,不画标签。 */
const labelIndex = computed(() =>
  columns.value.findIndex((column) => column !== incomeColumn.value && column !== expenseColumn.value),
)

/** 行号:按**展示序**编号 —— 表里从上往下第几行,与眼前看到的顺序一致。 */
const rowNumbers = computed(() => {
  const numbers = new Map<string, number>()
  orderedRows.value.forEach((row, index) => numbers.set(row.id, index + 1))
  return numbers
})

/** 一行总格数:行号列 + 数据列 + 余额列。节标题行与空态的 colspan 都用它。 */
const cellCount = computed(() => columns.value.length + (balances.value === null ? 0 : 1) + 1)

// ---- 就地增删改 ----

/**
 * 格编辑（编辑态 / 提交 / 勾选 / select）走共用模块；账目只多两件**读法**上的事：
 * 编辑态初值要把金额换回原始数字，回车要跳到下一行同列。
 */
const { editing, cellKey, commit, commitOnBlur, commitSelect, toggleCheck, focusOnMount } = useCellEditing(change)

/**
 * 编辑态的初值。金额格显示的是 `+5,000.00` 这种格式化文本,进编辑态必须换回原始数字
 * —— 否则一回车就把显示串解析成了 null,账目被「编辑」没了。其余列取文本投影。
 */
function editText(row: DataRow, column: DataColumn): string {
  const value = dt.cellValue(row, column)
  if (column === incomeColumn.value || column === expenseColumn.value) {
    return typeof value === "number" ? String(value) : ""
  }
  return dt.valueText(value, column)
}

/** 回车:提交 + 跳到**展示序**的下一行同列(纵向录一列最快);已是最后一行就退出编辑态。 */
function commitOnEnter(row: DataRow, column: DataColumn, event: Event): void {
  const target = event.target
  if (!(target instanceof HTMLInputElement)) return
  commit(row, column, target.value)
  const index = orderedRows.value.findIndex((item) => item.id === row.id)
  const next = orderedRows.value[index + 1]
  editing.value = next === undefined ? "" : cellKey(next, column)
}

/**
 * 表底记一笔:追加到末尾 —— 流水账的末位就是最新一笔,落点没有歧义 —— 然后把光标
 * 放进新行的第一个可输入格(图片格不能就地编辑、勾选格是直接切,都不作落点)。
 */
async function addEntry(): Promise<void> {
  await change((current) => dt.addRow(current))
  const added = rows.value[rows.value.length - 1]
  if (added === undefined) return
  const first = columns.value.find((column) => column.type !== "image" && column.type !== "checkbox")
  if (first === undefined) return
  editing.value = cellKey(added, first)
}

/** 删一行。正在编辑这一行时先把编辑态收掉,免得输入框跟着一个已消失的行。 */
function removeEntry(row: DataRow): void {
  if (editing.value.startsWith(row.id + ":")) editing.value = ""
  void change((current) => dt.removeRow(current, row.id))
}

// ---- 块设置 ----

function setIncomeColumn(event: Event): void {
  const target = event.target
  if (!(target instanceof HTMLSelectElement)) return
  updateBlockSettings(props.block.id, { incomeColumnId: target.value })
}

function setExpenseColumn(event: Event): void {
  const target = event.target
  if (!(target instanceof HTMLSelectElement)) return
  updateBlockSettings(props.block.id, { expenseColumnId: target.value })
}

function toggleBalance(checked: boolean): void {
  updateBlockSettings(props.block.id, { showBalance: checked })
}

/** 排序字段。空串 = 不排序(回到表内行序)。方向留着不动,下次选字段即生效。 */
function setSortColumn(event: Event): void {
  const target = event.target
  if (!(target instanceof HTMLSelectElement)) return
  updateBlockSettings(props.block.id, { sortColumnId: target.value })
}

function setSortDirection(event: Event): void {
  const target = event.target
  if (!(target instanceof HTMLSelectElement)) return
  updateBlockSettings(props.block.id, { sortDirection: target.value === "asc" ? "asc" : "desc" })
}

/**
 * 分组下拉的合并取值:空串 = 不分组;`month:<列id>` = 按月 · 某日期列;`<列id>` =
 * 按某列。设置落盘时拆回 groupMode + groupColumnId 两个字段。
 */
const groupSelection = computed({
  get: () => {
    if (props.block.groupMode === "month") return `month:${props.block.groupColumnId}`
    if (props.block.groupMode === "column") return props.block.groupColumnId
    return ""
  },
  set: (value: string) => {
    if (value === "") updateBlockSettings(props.block.id, { groupMode: "none", groupColumnId: "" })
    else if (value.startsWith("month:")) updateBlockSettings(props.block.id, { groupMode: "month", groupColumnId: value.slice(6) })
    else updateBlockSettings(props.block.id, { groupMode: "column", groupColumnId: value })
  },
})

const dateColumns = computed(() => columns.value.filter((column) => column.type === "date"))

/** 可排序列:图片列除外(data URI 排序没有意义,投影也是空串)。 */
const sortableColumns = computed(() => columns.value.filter((column) => column.type !== "image"))

const MENU = "w-[210px] rounded-island p-1.5 shadow-pop ring-0"
const ITEM = "gap-2.5 rounded-[7px] px-2 py-1"
const SELECT = "w-full cursor-pointer rounded border border-line bg-transparent px-1.5 py-1 text-[12px] outline-none"

function openTable() {
  if (props.block.path === "") return
  openFile(props.block.path)
}
</script>

<template>
  <!-- 空指针:如实说没指定,而不是永远转圈。 -->
  <TableRefNotice v-if="props.block.path === ''" kind="unset" label="账目" />

  <!-- 引用的文件读不到:提示态,不是错误态。 -->
  <TableRefNotice
    v-else-if="state === 'missing' || state === 'failed'"
    kind="missing"
    label="账目"
    :path="props.block.path"
  />

  <!-- 还没读完。 -->
  <TableRefNotice v-else-if="table === null" kind="loading" label="账目" />

  <div v-else class="group/ledger relative my-4">
    <!-- 块操作入口:右上角,悬停浮现。 -->
    <div class="absolute -top-2 right-0 z-20 flex items-center gap-1 opacity-0 transition-opacity group-hover/ledger:opacity-100 focus-within:opacity-100">
      <Button
        variant="ghost"
        size="sm"
        class="h-6 gap-1 rounded-full bg-background px-2 text-[12px] text-muted-foreground hover:text-foreground"
        @click="openTable"
      >
        <DatabaseIcon class="size-3" />打开数据表
      </Button>
      <DropdownMenu>
        <DropdownMenuTrigger as-child>
          <Button variant="ghost" size="sm" class="h-6 gap-1 rounded-full bg-background px-2 text-[12px] text-muted-foreground hover:text-foreground">
            <Settings2Icon class="size-3" />设置
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent :class="MENU" align="end">
          <DropdownMenuLabel class="px-2 pb-1 pt-1.5 text-[11px] font-normal text-muted-foreground">收入列</DropdownMenuLabel>
          <div class="px-2 pb-1.5">
            <select :class="SELECT" :value="props.block.incomeColumnId" @change="setIncomeColumn">
              <option value="">未设置</option>
              <option v-for="column in columns" :key="column.id" :value="column.id">{{ column.name }}</option>
            </select>
          </div>
          <DropdownMenuLabel class="px-2 pb-1 pt-1.5 text-[11px] font-normal text-muted-foreground">支出列</DropdownMenuLabel>
          <div class="px-2 pb-1.5">
            <select :class="SELECT" :value="props.block.expenseColumnId" @change="setExpenseColumn">
              <option value="">未设置</option>
              <option v-for="column in columns" :key="column.id" :value="column.id">{{ column.name }}</option>
            </select>
          </div>
          <DropdownMenuSeparator class="mx-2 my-1 bg-line" />
          <DropdownMenuLabel class="px-2 pb-1 pt-1.5 text-[11px] font-normal text-muted-foreground">分组</DropdownMenuLabel>
          <div class="px-2 pb-1.5">
            <select v-model="groupSelection" :class="SELECT">
              <option value="">不分组</option>
              <option v-for="column in dateColumns" :key="'m' + column.id" :value="'month:' + column.id">按月 · {{ column.name }}</option>
              <option v-for="column in columns" :key="'c' + column.id" :value="column.id">按列 · {{ column.name }}</option>
            </select>
          </div>
          <DropdownMenuSeparator class="mx-2 my-1 bg-line" />
          <DropdownMenuLabel class="px-2 pb-1 pt-1.5 text-[11px] font-normal text-muted-foreground">排序</DropdownMenuLabel>
          <div class="flex gap-1 px-2 pb-1.5">
            <select class="min-w-0 flex-1 cursor-pointer rounded border border-line bg-transparent px-1.5 py-1 text-[12px] outline-none" :value="props.block.sortColumnId" @change="setSortColumn">
              <option value="">不排序</option>
              <option v-for="column in sortableColumns" :key="column.id" :value="column.id">{{ column.name }}</option>
            </select>
            <select
              class="w-[62px] cursor-pointer rounded border border-line bg-transparent px-1.5 py-1 text-[12px] outline-none disabled:opacity-40"
              :value="props.block.sortDirection"
              :disabled="props.block.sortColumnId === ''"
              @change="setSortDirection"
            >
              <option value="desc">倒序</option>
              <option value="asc">正序</option>
            </select>
          </div>
          <DropdownMenuSeparator class="mx-2 my-1 bg-line" />
          <DropdownMenuCheckboxItem
            :class="ITEM"
            :model-value="props.block.showBalance"
            :disabled="!hasMoney"
            @update:model-value="(checked: boolean) => toggleBalance(checked)"
            @select.prevent
          >
            <span class="truncate">显示余额列</span>
          </DropdownMenuCheckboxItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>

    <!-- 未设收入 / 支出列:引导去设,表格照常渲染(不做金额格式化与合计)。 -->
    <p
      v-if="!hasMoney"
      class="mb-2 rounded-lg border border-dashed border-line bg-muted/30 px-3 py-2.5 text-[12px] text-muted-foreground"
    >
      账目尚未设置收入 / 支出列 —— 点右上角「设置」各挑一列(只设收入就是礼账的记法),
      金额求和、余额与合计才会出现。
    </p>

    <!--
      不换行 + 横向滚动,与数据表 scroll 档同一套几何(typography.ts 的 TABLE_SCROLL):
      格子 nowrap 让列宽由内容决定;表要 `w-max min-w-full` 而不是 `w-full` —— w-full
      被容器宽钉死,内容再宽也只会溢出格子,w-max 才产生可滚动量;容器 pb-2 把细滚动条
      从圆角底边推开。
    -->
    <div class="table-scrollbar overflow-x-auto rounded-lg border border-line pb-2">
      <table class="w-max min-w-full whitespace-nowrap border-collapse text-[12px]">
        <thead>
          <tr class="border-b border-line bg-muted/40 text-left text-muted-foreground">
            <!-- 行号列(空表头):宽度定死,行号与悬停删除钮共用这一格。 -->
            <th class="w-7 px-2 py-1.5 font-normal"></th>
            <th v-for="column in columns" :key="column.id" class="px-2.5 py-1.5 font-normal">{{ column.name }}</th>
            <th v-if="balances !== null" class="px-2.5 py-1.5 text-right font-normal">余额</th>
          </tr>
        </thead>
        <tbody>
          <template v-for="section in allSections" :key="section.key">
            <!-- 节标题行:分组名 + 行内小计(平铺模式没有标题行)。 -->
            <tr v-if="section.title !== ''" class="border-b border-line bg-muted/20">
              <th :colspan="cellCount" class="px-2.5 py-1 text-left text-[11px] font-medium text-muted-foreground">
                {{ section.title }}
                <span v-if="section.totals.income !== 0 || section.totals.expense !== 0" class="ml-2.5 font-normal">
                  收入 <span :style="{ color: LEDGER_INCOME_COLOR }">{{ formatYuan(section.totals.income) }}</span>
                  · 支出 <span :style="{ color: LEDGER_EXPENSE_COLOR }">{{ formatYuan(section.totals.expense) }}</span>
                </span>
              </th>
            </tr>
            <tr v-for="row in section.rows" :key="row.id" class="group/lrow border-b border-line last:border-b-0">
              <!-- 行号 / 删除同占一格(与数据表编辑页同一手法):悬停换成 ✕,列宽不变、行不跳。 -->
              <th class="relative w-7 px-2 py-1 text-right align-top font-mono text-[10.5px] font-normal text-muted-foreground/60">
                <span class="group-hover/lrow:invisible">{{ rowNumbers.get(row.id) }}</span>
                <button
                  type="button"
                  class="absolute inset-y-0 right-1 hidden items-center text-muted-foreground hover:text-destructive group-hover/lrow:flex"
                  aria-label="删除本行"
                  @click="removeEntry(row)"
                >
                  <Trash2Icon class="size-3" />
                </button>
              </th>
              <td
                v-for="column in columns"
                :key="column.id"
                class="px-2.5 py-1 align-top"
                :class="isNumberish(column) && 'text-right tabular-nums'"
              >
                <!-- 图片格不就地编辑:data URI 在表格里没处看,换图去数据表。 -->
                <span v-if="column.type === 'image'" class="opacity-60">{{ cellText(row, column) }}</span>

                <input
                  v-else-if="column.type === 'checkbox'"
                  type="checkbox"
                  class="size-3.5 align-middle"
                  :checked="dt.cellValue(row, column) === true"
                  @change="(event: Event) => toggleCheck(row, column, event)"
                >

                <select
                  v-else-if="column.type === 'select'"
                  class="w-full cursor-pointer rounded bg-transparent text-[12px] outline-none"
                  :value="String(dt.cellValue(row, column) ?? '')"
                  @change="(event: Event) => commitSelect(row, column, event)"
                >
                  <option value="">未选择</option>
                  <option v-for="option in column.options" :key="option.id" :value="option.id">{{ option.name }}</option>
                </select>

                <!--
                  格值按钮**始终留在文档流里**(进编辑态只是隐形),输入框绝对定位浮在它上面。
                  理由是表格是 auto 布局,列宽由格里内容的最大宽度算出来:若把按钮换成输入框,
                  输入框自带的 intrinsic 宽度(`size=20` ≈ 200px —— `w-full` 的百分比在算内在
                  尺寸时退化为 auto)会把整列撑宽几十像素,其余列被挤走,点一下整张表横向抖一次。
                  输入框定在按钮的框上(inset-0),顺带同一条对齐线 —— input 的 text-align 计算值
                  是 UA 的 start(不继承 td 的 right),不显式声明的话数字一进编辑态就跳到左边。
                -->
                <span v-else class="relative block min-h-[18px] w-full min-w-0">
                  <!-- 平时是格值,点进去才编辑;空格按钮撑满格子,保证点哪都能进编辑态。 -->
                  <button
                    type="button"
                    class="block min-h-[18px] w-full min-w-0 rounded px-0.5 hover:bg-muted/60"
                    :class="[isNumberish(column) ? 'text-right' : 'cursor-text text-left', editing === cellKey(row, column) && 'invisible']"
                    @click="editing = cellKey(row, column)"
                  >
                    <template v-if="column === incomeColumn"><span :style="{ color: LEDGER_INCOME_COLOR }">{{ incomeText(row) }}</span></template>
                    <template v-else-if="column === expenseColumn"><span :style="{ color: LEDGER_EXPENSE_COLOR }">{{ expenseText(row) }}</span></template>
                    <template v-else>{{ cellText(row, column) }}</template>
                  </button>

                  <input
                    v-if="editing === cellKey(row, column)"
                    :ref="focusOnMount"
                    class="absolute inset-0 rounded bg-transparent px-0.5 text-[12px] outline-none"
                    :class="isNumberish(column) ? 'text-right tabular-nums' : 'text-left'"
                    :value="editText(row, column)"
                    :placeholder="column.type === 'date' ? 'YYYY-MM-DD' : ''"
                    @keydown.enter.prevent="commitOnEnter(row, column, $event)"
                    @blur="commitOnBlur(row, column, $event)"
                  >
                </span>
              </td>
              <td v-if="balances !== null" class="px-2.5 py-1 text-right tabular-nums text-muted-foreground">
                {{ formatAmount(balances.get(row.id) ?? 0) }}
              </td>
            </tr>
          </template>

          <!-- 空表:一句话 + 下面那行「记一笔」即唯一入口。 -->
          <tr v-if="rows.length === 0">
            <td :colspan="cellCount" class="px-2.5 py-4 text-center text-muted-foreground">
              这张表还没有账目 —— 点下面「记一笔」开始记。
            </td>
          </tr>
        </tbody>
        <tfoot>
          <tr v-if="hasMoney" class="bg-muted/40 font-medium">
            <td class="w-7"></td>
            <td
              v-for="(column, index) in columns"
              :key="column.id"
              class="px-2.5 py-1.5"
              :class="isNumberish(column) && 'text-right tabular-nums'"
            >
              <template v-if="column === incomeColumn"><span :style="{ color: LEDGER_INCOME_COLOR }">{{ formatIncome(totals.income) }}</span></template>
              <template v-else-if="column === expenseColumn"><span :style="{ color: LEDGER_EXPENSE_COLOR }">{{ formatExpense(totals.expense) }}</span></template>
              <template v-else-if="index === labelIndex">合计</template>
            </td>
            <td class="whitespace-nowrap px-2.5 py-1.5 text-right tabular-nums">结余 {{ formatYuan(totals.net) }}</td>
          </tr>
          <!-- 表底记一笔:追加到末尾(流水账的末位即最新一笔),光标直接落进新行首格。 -->
          <tr class="border-t border-dashed border-line">
            <td :colspan="cellCount" class="p-0">
              <button
                type="button"
                class="flex w-full items-center justify-center gap-1 px-2.5 py-1.5 text-[12px] text-muted-foreground hover:bg-muted/40 hover:text-foreground"
                @click="addEntry"
              >
                <PlusIcon class="size-3" />记一笔
              </button>
            </td>
          </tr>
        </tfoot>
      </table>
    </div>
  </div>
</template>

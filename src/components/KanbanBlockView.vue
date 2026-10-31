<script setup lang="ts">
import type { KanbanBlock } from "@/types/workspace"
import type { DataColumn, DataRow, DataCellValue } from "@/types/data-table"
import { computed } from "vue"
import { ChevronDownIcon, ChevronUpIcon, DatabaseIcon, PlusIcon, Settings2Icon } from "@lucide/vue"
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
import OptionCell from "@/components/OptionCell.vue"
import DateCalendar from "@/components/DateCalendar.vue"
import { useWorkspace } from "@/composables/useWorkspace"
import { useTableEntry } from "@/composables/useTableEntry"
import { useCellEditing } from "@/composables/useCellEditing"
import { useDateCellPanel } from "@/composables/useDateCellPanel"
import * as dt from "@/lib/data-table"

/**
 * 看板块:把一张数据表按某列的值分成若干列,每行一张便签贴纸卡,卡片可跨列拖拽
 * —— 拖到哪一列就把该行的分组列值改成那一列的值(ADR-0008)。
 *
 * 数据链路与画册 / 书签块完全同源,取数与改表走 `useTableEntry` 共用 seam,
 * 这里不再复述。差别的只有**展示**:横向几列分组、便签卡片、拖拽改值。
 *
 * 卡片背景色由行 id 哈希出固定浅色(同卡每次同色),不进 `.tbl` 也不进笔记 ——
 * 它是视图态,导出快照不带颜色(与画册图片填充是块设置、但快照只存
 * 数据同一立场:颜色不是数据)。调色板与哈希在 `dt.kanbanCardColor`,
 * 导出侧画静态便签卡用同一份,两处观感不漂移。
 */
const props = defineProps<{ block: KanbanBlock }>()

const { openFile, updateBlockSettings, rebindTable, tablePaths } = useWorkspace()

const { state, table, columns, rows, change } = useTableEntry(() => props.block.path)

// ---- 分组 ----

/** 分组列。块设置指向的列被删后这里落空,视图退化为「请选分组列」提示,无需清洗。 */
const groupColumn = computed<DataColumn | null>(() =>
  columns.value.find((column) => column.id === props.block.groupColumnId) ?? null,
)

/**
 * 一个看板分组的描述。`value` 是分组列的原生值,拖拽落位时直接写回该列。
 */
interface KanbanGroup {
  /** 稳定 key:未分组固定 "__ungrouped__",其余为 String(原生值)。 */
  key: string
  /** 分组列的原生值(select 即选项 id,text 即字符串,number 即数字…)。未分组为 null。 */
  value: DataCellValue
  /** 列头显示文本(select 翻译成选项名,其余取 valueText)。 */
  label: string
  rows: readonly DataRow[]
}

/**
 * 分组规则收在 `dt.groupRows`(与画册节 / 书签节同一套):归桶、手排、空 select 组
 * 都在那边。视图只决定两件展示层的事:「未分组」列恒在最左(拖回 null 值是清空,
 * 是看板的落点语义),其余组按手排序跟上。
 */
const groups = computed<readonly KanbanGroup[]>(() => {
  const col = groupColumn.value
  if (col === null) return []

  const { groups: bucketed, loose } = dt.groupRows(rows.value, col, {
    manualOrder: props.block.groupOrder,
    emptySelectGroups: props.block.showEmptyGroups,
  })

  const out: KanbanGroup[] = []
  if (loose.length > 0 || props.block.showEmptyGroups) {
    out.push({ key: "__ungrouped__", value: null, label: "未分组", rows: loose })
  }
  for (const group of bucketed) {
    out.push({ key: group.key, value: group.value, label: group.title, rows: group.rows })
  }
  return out
})

// ---- 卡片 ----

/**
 * 卡片上显示的列。`displayColumnIds` 为空 = 全显(分组列本身除外);非空则按记录顺序
 * 过滤当前仍存在的列,删列后残留的 id 在这里自然丢掉,无需清洗。
 */
const displayColumns = computed<readonly DataColumn[]>(() => {
  if (props.block.displayColumnIds.length === 0) {
    return columns.value.filter((column) => column.id !== props.block.groupColumnId)
  }
  return props.block.displayColumnIds
    .map((id) => columns.value.find((column) => column.id === id))
    .filter((column): column is DataColumn => column !== undefined)
})

/** 卡片上一格的文本。image 列显示「[图片]」占位(卡片小,不内联渲染图),其余走 valueText。 */
function cellOf(row: DataRow, column: DataColumn): string {
  const v = dt.cellValue(row, column)
  if (column.type === "image") return typeof v === "string" && v !== "" ? "[图片]" : ""
  return dt.valueText(v, column)
}

// ---- 卡片上的内联编辑 ----

/**
 * 点击格值 → 就地编辑:文本 / 数字 / 日期是输入框(失焦提交),select 换成下拉,
 * 勾选直接切换。这一套与画册卡 / 账目行共用 `useCellEditing` ——
 * 同一格在表格编辑页与三种引用块里编辑,规则必须是同一条。
 */
const { editing, cellKey, commit, commitOnEnter, commitOnBlur, commitOption, toggleCheck, focusOnMount } = useCellEditing(change)

/**
 * 日期格的下拉月历,与账目行同一套(状态与焦点处理都在 `useDateCellPanel`):
 * 点开输入框就展开,选中的那天直接写回格。卡片本身小,靠文本手敲 `YYYY-MM-DD`
 * 太容易打错,日历面板省掉这一层。
 */
const {
  panel: datePanel,
  open: openDatePanel,
  close: closeDatePanel,
  pick: pickDate,
  blur: blurDateCell,
  keydown: dateKeydown,
} = useDateCellPanel(
  { editing, cellKey, commit, commitOnBlur },
  { rows: () => rows.value, columns: () => columns.value },
)

/**
 * 卡片格子的键盘。日期格把方向键与回车让给月历(高亮那天、回车确认)，
 * 其余键照常进输入框打日期;非日期格就是原来的「回车提交」。
 */
function onCellKeydown(column: DataColumn, event: KeyboardEvent): void {
  if (column.type === "date" && dateKeydown(event)) return
  if (event.key === "Enter") {
    event.preventDefault()
    commitOnEnter(event)
  }
}

// ---- 拖拽改值 ----

/** 卡片开始拖拽:把行 id 塞进 dataTransfer,落位时据此改值。 */
function onCardDragStart(event: DragEvent, row: DataRow): void {
  const transfer = event.dataTransfer
  if (transfer === null) return
  transfer.setData("text/kanban-card", row.id)
  transfer.effectAllowed = "move"
}

/** 列容器放行 drop。dragover 不 preventDefault 就不会触发 drop。 */
function onColumnDragOver(event: DragEvent): void {
  event.preventDefault()
  const transfer = event.dataTransfer
  if (transfer !== null) transfer.dropEffect = "move"
}

/**
 * 卡片落到某列:把该行的分组列值改成这一列代表的值。`target.value` 是分组列的
 * 原生值(select 即选项 id,其余即其值),直接写回 —— 不需要从列头文本反 parse。
 * 未分组列的 value 是 null,拖过去等于把分组列清空。
 */
function onColumnDrop(event: DragEvent, target: KanbanGroup): void {
  event.preventDefault()
  const transfer = event.dataTransfer
  if (transfer === null) return
  const rowId = transfer.getData("text/kanban-card")
  if (rowId === "") return
  const col = groupColumn.value
  if (col === null) return
  const row = rows.value.find((item) => item.id === rowId)
  if (row === undefined) return
  // 同列落回是空操作:避免一次无意义的 mutate 记脏。
  if (String(dt.cellValue(row, col)) === String(target.value) && dt.cellValue(row, col) === target.value) return
  void change((current) => dt.replaceRow(current, dt.setCell(row, col.id, target.value)))
}

// ---- 添加卡片 ----

/**
 * 在某列添加卡片:表尾追加一行,分组列直接落成这一列的值 —— 卡片即刻归位,
 * 不必先去数据表加行再拖过来。未分组列的 value 是 null,等于加一张不归组的卡。
 * 加行与设值在同一拍 `change` 里完成,只记一次脏、一次写盘。
 */
function addCard(group: KanbanGroup): void {
  const col = groupColumn.value
  if (col === null) return
  void change((current) => {
    const added = dt.addRow(current)
    const row = added.rows[added.rows.length - 1]
    if (row === undefined) return added
    return dt.replaceRow(added, dt.setCell(row, col.id, group.value))
  })
}

// ---- 块设置 ----

/** 分组列的下拉选择:空 = 关闭(提示态)。 */
const groupSelection = computed({
  get: () => props.block.groupColumnId,
  set: (value: string) => updateBlockSettings(props.block.id, { groupColumnId: value }),
})

/**
 * 上移/下移分组列:按当前生效顺序整体重写 groupOrder(交换口径在 `dt.swapInOrder`)。
 * 「未分组」列不参与。
 */
function moveGroup(value: string, dir: -1 | 1): void {
  const values = groups.value.filter((group) => group.value !== null).map((group) => String(group.value))
  const next = dt.swapInOrder(values, value, dir)
  if (next === null) return
  updateBlockSettings(props.block.id, { groupOrder: next })
}

/** 该列是否在卡片上显示。全显模式(displayColumnIds 空)下分组列由列头表达、不上卡片,其余列全显。 */
function isFieldShown(column: DataColumn): boolean {
  if (props.block.displayColumnIds.length === 0) return column.id !== props.block.groupColumnId
  return props.block.displayColumnIds.includes(column.id)
}

/**
 * 切换某列的显隐。全显模式下取消某列 → 进入显式模式(显示其余全部);勾上分组列
 * 同样进入显式模式(全列显式)。显式模式下勾齐「分组列以外的全部」→ 恢复全显默认
 * (清空 displayColumnIds,省下存储也与「默认即全显」口径一致)。
 */
function toggleField(column: DataColumn, checked: boolean): void {
  const current = props.block.displayColumnIds
  if (current.length === 0) {
    // 全显模式:非分组列本来就显示,只有勾上分组列才需要进显式模式。
    if (!checked || column.id !== props.block.groupColumnId) return
    updateBlockSettings(props.block.id, { displayColumnIds: columns.value.map((item) => item.id) })
    return
  }
  const next = checked ? [...current, column.id] : current.filter((id) => id !== column.id)
  const base = columns.value.filter((item) => item.id !== props.block.groupColumnId)
  const collapsesToAll = !next.includes(props.block.groupColumnId) && base.every((item) => next.includes(item.id))
  updateBlockSettings(props.block.id, { displayColumnIds: collapsesToAll ? [] : next })
}

const MENU = "w-[196px] rounded-island p-1.5 shadow-pop ring-1 ring-line/70"
const ITEM = "gap-2.5 rounded-[7px] px-2 py-1"

function openTable() {
  if (props.block.path === "") return
  openFile(props.block.path)
}
</script>

<template>
  <!-- 空指针:如实说没指定,而不是永远转圈。 -->
  <TableRefNotice v-if="props.block.path === ''" kind="unset" label="看板" />

  <!-- 引用的文件读不到:提示态,不是错误态 —— 提示条自带一条重新指向的出路。 -->
  <TableRefNotice
    v-else-if="state === 'missing' || state === 'failed'"
    kind="missing"
    label="看板"
    :path="props.block.path"
    :tables="tablePaths"
    @reselect="(path: string) => rebindTable(props.block.id, path)"
  />

  <!-- 还没读完。 -->
  <TableRefNotice v-else-if="table === null" kind="loading" label="看板" />

  <div v-else class="group/kanban relative my-4">
    <!-- 块操作入口:右上角,悬停浮现。 -->
    <div class="absolute -top-2 right-0 z-20 flex items-center gap-1 opacity-0 transition-opacity group-hover/kanban:opacity-100 focus-within:opacity-100">
      <Button
        variant="ghost"
        size="sm"
        class="h-6 gap-1 rounded-full bg-popover px-2 text-[12px] text-muted-foreground hover:text-foreground"
        @click="openTable"
      >
        <DatabaseIcon class="size-3" />打开数据表
      </Button>
      <DropdownMenu>
        <DropdownMenuTrigger as-child>
          <Button variant="ghost" size="sm" class="h-6 gap-1 rounded-full bg-popover px-2 text-[12px] text-muted-foreground hover:text-foreground">
            <Settings2Icon class="size-3" />设置
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent :class="MENU" align="end">
          <DropdownMenuLabel class="px-2 pb-1 pt-1.5 text-[11px] font-normal text-muted-foreground">
            分组字段
          </DropdownMenuLabel>
          <div class="px-2 pb-1.5">
            <select
              v-model="groupSelection"
              class="w-full cursor-pointer rounded border border-line bg-transparent px-1.5 py-1 text-[12px] outline-none"
            >
              <option value="">未选择(看板未分组)</option>
              <option v-for="column in columns" :key="column.id" :value="column.id">
                {{ column.name }}
              </option>
            </select>
            <!-- 组序手排:选了分组列才出现;按当前生效顺序列出各组(不含「未分组」),
                 ↑↓ 即时写回 groupOrder。mt 与 select 拉开间距,px-1.5 对齐 select 的边框内文字。 -->
            <div v-if="props.block.groupColumnId !== ''" class="mt-1.5 space-y-0.5 px-1.5">
              <div v-for="group in groups" v-show="group.value !== null" :key="group.key" class="flex items-center gap-1">
                <span class="min-w-0 flex-1 truncate text-[12px]">{{ group.label }}</span>
                <button
                  type="button"
                  aria-label="上移该组"
                  class="rounded p-0.5 text-muted-foreground hover:bg-muted hover:text-foreground"
                  @click="moveGroup(String(group.value), -1)"
                >
                  <ChevronUpIcon class="size-3" />
                </button>
                <button
                  type="button"
                  aria-label="下移该组"
                  class="rounded p-0.5 text-muted-foreground hover:bg-muted hover:text-foreground"
                  @click="moveGroup(String(group.value), 1)"
                >
                  <ChevronDownIcon class="size-3" />
                </button>
              </div>
            </div>
          </div>
          <template v-if="props.block.groupColumnId !== ''">
            <DropdownMenuSeparator class="mx-2 my-1 bg-line" />
            <DropdownMenuCheckboxItem
              :class="ITEM"
              :model-value="props.block.showEmptyGroups"
              @update:model-value="(checked: boolean) => updateBlockSettings(props.block.id, { showEmptyGroups: checked })"
              @select.prevent
            >
              <span class="truncate">显示空分组</span>
            </DropdownMenuCheckboxItem>
            <DropdownMenuLabel class="px-2 pb-1 pt-1.5 text-[11px] font-normal text-muted-foreground">
              卡片显示字段
            </DropdownMenuLabel>
            <DropdownMenuCheckboxItem
              v-for="column in columns"
              :key="column.id"
              :class="ITEM"
              :model-value="isFieldShown(column)"
              @update:model-value="(checked: boolean) => toggleField(column, checked)"
              @select.prevent
            >
              <span class="truncate">{{ column.name }}</span>
            </DropdownMenuCheckboxItem>
          </template>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>

    <!-- 未选分组列:引导去设。 -->
    <p
      v-if="props.block.groupColumnId === '' || groupColumn === null"
      class="rounded-lg border border-dashed border-line bg-muted/30 px-3 py-2.5 text-[12px] text-muted-foreground"
    >
      看板尚未选择分组字段 —— 点右上角「设置」选一列,卡片会按它的值分列。
    </p>

    <!-- 看板:横向几列,每列若干便签卡。空表给一句说明。 -->
    <p v-else-if="rows.length === 0" class="py-6 text-center text-[12px] text-muted-foreground">
      这张表还没有行 —— 到数据表里添加后,看板会自动出现。
    </p>
    <div v-else class="flex gap-3 overflow-x-auto pb-1">
      <section
        v-for="group in groups"
        :key="group.key"
        class="flex w-56 shrink-0 flex-col rounded-lg bg-muted/30 p-2"
        @dragover="onColumnDragOver"
        @drop="onColumnDrop($event, group)"
      >
        <div class="mb-2 flex items-center justify-between px-0.5">
          <span class="truncate text-[12px] font-medium text-foreground">{{ group.label }}</span>
          <span class="flex shrink-0 items-center gap-0.5">
            <span class="rounded-full bg-muted px-1.5 text-[11px] text-muted-foreground">{{ group.rows.length }}</span>
            <button
              type="button"
              aria-label="添加卡片"
              title="添加卡片"
              class="rounded p-0.5 text-muted-foreground/60 transition-colors hover:bg-black/5 hover:text-muted-foreground"
              @click="addCard(group)"
            >
              <PlusIcon class="size-3.5" />
            </button>
          </span>
        </div>
        <div class="flex flex-col gap-2">
          <article
            v-for="row in group.rows"
            :key="row.id"
            :draggable="editing === ''"
            class="cursor-grab rounded-md border border-black/5 px-2 py-1.5 text-black shadow-sm transition-shadow hover:shadow-md active:cursor-grabbing"
            :style="{ backgroundColor: dt.kanbanCardColor(row.id) }"
            @dragstart="onCardDragStart($event, row)"
          >
            <div v-for="column in displayColumns" :key="column.id" class="flex min-h-4 flex-col py-0.5">
              <span class="text-[11px] leading-tight text-black/50">{{ column.name }}</span>
              <!-- 图片格不就地编辑:data URI 在卡片上没处看,换图去数据表。 -->
              <span v-if="column.type === 'image'" class="break-words text-[12px] leading-snug" :class="cellOf(row, column) === '' && 'text-black/30'">{{ cellOf(row, column) || "空" }}</span>

              <input
                v-else-if="column.type === 'checkbox'"
                type="checkbox"
                class="size-3.5 accent-black/70"
                :checked="dt.cellValue(row, column) === true"
                @change="(event: Event) => toggleCheck(row, column, event)"
              >

              <!-- 单选格：键盘模型与账目格、数据表格同源（Tab 到就展开），走 `OptionCell`。 -->
              <OptionCell
                v-else-if="column.type === 'select'"
                class="rounded text-[12px] leading-snug hover:bg-black/5"
                :model-value="String(dt.cellValue(row, column) ?? '')"
                :options="column.options"
                :chevron="false"
                @pick="commitOption(row, column, $event)"
              />

              <!-- 日期格:输入框一聚焦就展开月历(浮层在模板末尾的 Teleport 里)。
                   面板上所有 mousedown 都 prevent,点日期不会让输入框失焦 —— 失焦即提交、
                   一提交就退出编辑态,面板跟着消失,那一天根本点不到。 -->
              <input
                v-else-if="editing === cellKey(row, column)"
                :ref="focusOnMount"
                class="w-full min-w-0 rounded bg-transparent px-0.5 text-[12px] leading-snug outline-none"
                :value="cellOf(row, column)"
                :placeholder="column.type === 'date' ? 'YYYY-MM-DD' : ''"
                @focus="column.type === 'date' && openDatePanel(row, column, $event)"
                @click="column.type === 'date' && openDatePanel(row, column, $event)"
                @keydown="onCellKeydown(column, $event)"
                @keydown.esc.prevent="column.type === 'date' && closeDatePanel()"
                @blur="column.type === 'date' ? blurDateCell(row, column, $event) : commitOnBlur(row, column, $event)"
              >

              <button
                v-else
                type="button"
                class="w-full min-w-0 rounded px-0.5 text-left text-[12px] leading-snug hover:bg-black/5"
                @click="editing = cellKey(row, column)"
              >
                <span class="break-words" :class="cellOf(row, column) === '' && 'text-black/30'">{{ cellOf(row, column) || "空" }}</span>
              </button>
            </div>
          </article>
        </div>
      </section>
    </div>

    <!-- 日期浮层:挂到 body 上、fixed 定位 —— 看板外面是横向滚动容器,卡内浮层会被裁掉。
         `mousedown.prevent` 是这套面板的命门:点日期时输入框不失焦,编辑态与面板都还活着。 -->
    <Teleport to="body">
      <div
        v-if="datePanel !== null"
        class="fixed z-50 rounded-lg bg-popover text-popover-foreground shadow-md ring-1 ring-foreground/10"
        :style="{ top: `${datePanel.top}px`, left: `${datePanel.left}px` }"
        @mousedown.prevent
      >
        <DateCalendar :value="datePanel.value" :focus="datePanel.focus" @pick="pickDate($event)" @clear="pickDate('')" />
      </div>
    </Teleport>
  </div>
</template>

<script setup lang="ts">
import type { KanbanBlock } from "@/types/workspace"
import type { DataColumn, DataRow, DataTable, DataCellValue } from "@/types/data-table"
import type { TableEntry } from "@/composables/useTables"
import { computed, onBeforeUnmount, onMounted, shallowRef, watch } from "vue"
import { ChevronDownIcon, ChevronUpIcon, DatabaseIcon, Settings2Icon } from "@lucide/vue"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { useTables } from "@/composables/useTables"
import { useWorkspace } from "@/composables/useWorkspace"
import * as dt from "@/lib/data-table"

/**
 * 看板块:把一张数据表按某列的值分成若干列,每行一张便签贴纸卡,卡片可跨列拖拽
 * —— 拖到哪一列就把该行的分组列值改成那一列的值(ADR-0008)。
 *
 * 数据链路与画册 / 书签块完全同源 —— 注册表取数、拖拽改值直接写 `.tbl`、读不到
 * 是提示态不是错误。差别的只有**展示**:横向几列分组、便签卡片、拖拽改值。
 *
 * 卡片背景色由行 id 哈希出固定浅色(同卡每次同色),不进 `.tbl` 也不进笔记 ——
 * 它是视图态,导出快照是普通表格不带颜色(与画册图片填充是块设置、但快照只存
 * 数据同一立场:颜色不是数据)。
 */
const props = defineProps<{ block: KanbanBlock }>()

const { openFile, updateKanbanBlock, markTableDirty } = useWorkspace()
const tables = useTables()

/** 当前这张表的条目。**必须是 `shallowRef`**,理由同画册块 —— `ref` 深度解包会把 `TableEntry` 压扁。 */
const entry = shallowRef<TableEntry | null>(null)

const state = computed(() => entry.value?.state.value ?? "loading")
const table = computed(() => entry.value?.table.value ?? null)
const columns = computed<readonly DataColumn[]>(() => table.value?.columns ?? [])
const rows = computed<readonly DataRow[]>(() => table.value?.rows ?? [])

onMounted(() => {
  void mount()
})

watch(
  () => props.block.path,
  () => void mount(),
)

async function mount(): Promise<void> {
  const path = props.block.path
  if (path === "") {
    entry.value = null
    return
  }
  entry.value = await tables.use(path)
}

onBeforeUnmount(() => {
  if (props.block.path !== "") tables.release(props.block.path)
})

/** 所有数据编辑都走这一条:算出新表 → 进内存记脏,随所在笔记统一保存。 */
async function change(next: (table: DataTable) => DataTable): Promise<void> {
  const ok = await tables.mutate(props.block.path, next)
  if (ok) markTableDirty(props.block.path)
}

// ---- 分组 ----

/** 分组列。块设置指向的列被删后这里落空,视图退化为「请选分组列」提示,无需清洗。 */
const groupColumn = computed<DataColumn | null>(() =>
  columns.value.find((column) => column.id === props.block.groupColumnId) ?? null,
)

/** 一个看板分组的描述。`value` 是分组列的原生值,拖拽落位时直接写回该列。 */
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
 * 按分组列的值归组。空值(null / "")行收进最左的「未分组」列;其余组按 groupOrder
 * 手排,没记录的跟值首次出现序排在后面(JS sort 稳定,同为未记录的组之间保持原
 * 相对顺序)。一个值自成一组(即便只有一行)—— 看板的列就是分组的可视化,合并
 * 单行组会让「这一列为什么没有卡片」变成谜题。
 */
const groups = computed<readonly KanbanGroup[]>(() => {
  const col = groupColumn.value
  if (col === null) return []

  const buckets = new Map<string, { value: DataCellValue; label: string; rows: DataRow[] }>()
  const ungrouped: DataRow[] = []
  for (const row of rows.value) {
    const v = dt.cellValue(row, col)
    if (v === null || v === "") {
      ungrouped.push(row)
      continue
    }
    const key = String(v)
    const bucket = buckets.get(key)
    if (bucket === undefined) buckets.set(key, { value: v, label: dt.valueText(v, col), rows: [row] })
    else bucket.rows.push(row)
  }

  // 手排:groupOrder 里记录的组按记录序靠前,没记录的跟首现序排在后面。
  const recorded = props.block.groupOrder
  const ordered = [...buckets.values()]
    .map((bucket, index) => ({ bucket, index, rank: recorded.indexOf(String(bucket.value)) }))
    .sort((a, b) => {
      const ra = a.rank === -1 ? recorded.length + a.index : a.rank
      const rb = b.rank === -1 ? recorded.length + b.index : b.rank
      return ra - rb
    })

  const out: KanbanGroup[] = []
  if (ungrouped.length > 0) {
    out.push({ key: "__ungrouped__", value: null, label: "未分组", rows: ungrouped })
  }
  for (const { bucket } of ordered) {
    out.push({
      key: String(bucket.value),
      value: bucket.value,
      label: bucket.label === "" ? String(bucket.value) : bucket.label,
      rows: bucket.rows,
    })
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

/** 便签贴纸的浅色调色板:保证黑字可读(背景足够浅)。 */
const PALETTE = [
  "#fff4c2",
  "#ffe0b3",
  "#ffd6e0",
  "#d7f0d4",
  "#d4e8ff",
  "#e0d4ff",
  "#d4f0ec",
  "#f7e0c2",
] as const

/** 行 id 哈希出固定浅色:同卡每次同色,稳定可复现。 */
function colorOf(id: string): string {
  let h = 0
  for (let i = 0; i < id.length; i += 1) h = (Math.imul(h, 31) + id.charCodeAt(i)) >>> 0
  return PALETTE[h % PALETTE.length] ?? PALETTE[0]
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

// ---- 块设置 ----

/** 分组列的下拉选择:空 = 关闭(提示态)。 */
const groupSelection = computed({
  get: () => props.block.groupColumnId,
  set: (value: string) => updateKanbanBlock(props.block.id, { groupColumnId: value }),
})

/**
 * 上移/下移分组列:按当前生效顺序整体重写 groupOrder。之后它就是全量清单 ——
 * 后续新增的组值不在列表里,照常按首现序排在末尾,无需清洗。「未分组」列不参与。
 */
function moveGroup(value: string, dir: -1 | 1): void {
  const values = groups.value.filter((group) => group.value !== null).map((group) => String(group.value))
  const i = values.indexOf(value)
  const j = i + dir
  if (i === -1 || j < 0 || j >= values.length) return
  const a = values[i]
  const b = values[j]
  if (a === undefined || b === undefined) return
  values[i] = b
  values[j] = a
  updateKanbanBlock(props.block.id, { groupOrder: values })
}

/** 该列是否在卡片上显示。全显模式(displayColumnIds 空)下默认全显。 */
function isFieldShown(column: DataColumn): boolean {
  return props.block.displayColumnIds.length === 0 || props.block.displayColumnIds.includes(column.id)
}

/**
 * 切换某列的显隐。全显模式下取消某列 → 进入显式模式(显示其余全部);显式模式下
 * 勾全 → 恢复全显默认(清空 displayColumnIds,省下存储也与「默认即全显」口径一致)。
 * 分组列本身不参与显隐切换 —— 它由列头表达,在卡片里重复没有读法。
 */
function toggleField(column: DataColumn, checked: boolean): void {
  const allShown = props.block.displayColumnIds.length === 0
  if (checked) {
    if (allShown) return
    const next = [...props.block.displayColumnIds, column.id]
    const selectable = columns.value.filter((item) => item.id !== props.block.groupColumnId)
    updateKanbanBlock(
      props.block.id,
      next.length === selectable.length ? { displayColumnIds: [] } : { displayColumnIds: next },
    )
  } else {
    if (allShown) {
      const next = columns.value
        .filter((item) => item.id !== props.block.groupColumnId && item.id !== column.id)
        .map((item) => item.id)
      updateKanbanBlock(props.block.id, { displayColumnIds: next })
    } else {
      const next = props.block.displayColumnIds.filter((id) => id !== column.id)
      updateKanbanBlock(props.block.id, { displayColumnIds: next })
    }
  }
}

const MENU = "w-[196px] rounded-island p-1.5 shadow-pop ring-0"
const ITEM = "gap-2.5 rounded-[7px] px-2 py-1"

function openTable() {
  if (props.block.path === "") return
  openFile(props.block.path)
}
</script>

<template>
  <!-- 空指针:如实说没指定,而不是永远转圈。 -->
  <div
    v-if="props.block.path === ''"
    class="my-4 flex items-center gap-2.5 rounded-lg border border-dashed border-line bg-muted/40 px-3 py-2.5"
  >
    <DatabaseIcon class="size-3.5 shrink-0 text-muted-foreground" />
    <span class="text-[12px] text-muted-foreground">
      看板未指定数据表 —— 删掉这个块,用 / 菜单重新插入。
    </span>
  </div>

  <!-- 引用的文件读不到:提示态,不是错误态。 -->
  <div
    v-else-if="state === 'missing' || state === 'failed'"
    class="my-4 flex items-center gap-2.5 rounded-lg border border-dashed border-line bg-muted/40 px-3 py-2.5"
  >
    <DatabaseIcon class="size-3.5 shrink-0 text-muted-foreground" />
    <span class="text-[12px] text-muted-foreground">
      看板引用的数据表不存在:<span class="font-mono">{{ props.block.path }}</span>
    </span>
  </div>

  <!-- 还没读完。 -->
  <div
    v-else-if="table === null"
    class="my-4 flex items-center gap-2.5 rounded-lg border border-line bg-muted/30 px-3 py-2.5"
  >
    <DatabaseIcon class="size-3.5 shrink-0 animate-pulse text-muted-foreground" />
    <span class="text-[12px] text-muted-foreground">正在读取数据表…</span>
  </div>

  <div v-else class="group/kanban relative my-4">
    <!-- 块操作入口:右上角,悬停浮现。 -->
    <div class="absolute -top-2 right-0 z-20 flex items-center gap-1 opacity-0 transition-opacity group-hover/kanban:opacity-100 focus-within:opacity-100">
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
            <DropdownMenuLabel class="px-2 pb-1 pt-1.5 text-[11px] font-normal text-muted-foreground">
              卡片显示字段
            </DropdownMenuLabel>
            <DropdownMenuCheckboxItem
              v-for="column in columns"
              :key="column.id"
              v-show="column.id !== props.block.groupColumnId"
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
          <span class="shrink-0 rounded-full bg-muted px-1.5 text-[10px] text-muted-foreground">{{ group.rows.length }}</span>
        </div>
        <div class="flex flex-col gap-2">
          <article
            v-for="row in group.rows"
            :key="row.id"
            draggable="true"
            class="cursor-grab rounded-md border border-black/5 px-2 py-1.5 text-black shadow-sm transition-shadow hover:shadow-md active:cursor-grabbing"
            :style="{ backgroundColor: colorOf(row.id) }"
            @dragstart="onCardDragStart($event, row)"
          >
            <div v-for="column in displayColumns" :key="column.id" class="flex min-h-4 flex-col py-0.5">
              <span class="text-[10px] leading-tight text-black/50">{{ column.name }}</span>
              <span class="break-words text-[12px] leading-snug" :class="cellOf(row, column) === '' && 'text-black/30'">{{ cellOf(row, column) || "空" }}</span>
            </div>
          </article>
        </div>
      </section>
    </div>
  </div>
</template>

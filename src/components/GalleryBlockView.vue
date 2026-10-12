<script setup lang="ts">
import type { GalleryBlock } from "@/types/workspace"
import type { DataColumn, DataRow, DataTable } from "@/types/data-table"
import { computed, onBeforeUnmount, onMounted, ref, shallowRef, watch } from "vue"
import {
  ChevronDownIcon,
  ChevronUpIcon,
  DatabaseIcon,
  FoldVerticalIcon,
  LayoutGridIcon,
  Settings2Icon,
  UnfoldVerticalIcon,
} from "@lucide/vue"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import type { TableEntry } from "@/composables/useTables"
import { useTables } from "@/composables/useTables"
import { useWorkspace } from "@/composables/useWorkspace"
import * as dt from "@/lib/data-table"

/**
 * 画册块:把一张数据表渲染成海报卡片宫格。
 *
 * 数据链路与 `DataTableBlockView` 完全同源 —— 注册表取数、编辑直接写 `.tbl`、
 * 读不到是提示态不是错误(见那边注释的三条,这里不再复述)。不同的只有**展示**:
 *
 * 1. 每行一张卡片:上方是该行第一个非空图片格(海报位),下方是其余字段的值。
 * 2. 展示设置(列数、图片比例、图片填充、字段显隐)是**块的属性**,改动走笔记的保存流程,
 *    跟着笔记进盘上的 `data-*` —— 与 `.tbl` 无关,同一张表在两篇笔记里可以有
 *    两套完全不同的画册外观。
 * 3. 图片格在这里只读,字段值可以直接编辑:点值变输入框,失焦或 Enter 提交。
 */
const props = defineProps<{ block: GalleryBlock }>()

const { openFile, updateGalleryBlock } = useWorkspace()
const tables = useTables()

/**
 * 当前这张表的条目。**必须是 `shallowRef`**,理由见 `DataTableBlockView` ——
 * `ref` 的深度解包会把 `TableEntry` 里的 `Ref` 字段压扁,视图永远停在「正在读取」。
 */
const entry = shallowRef<TableEntry | null>(null)

/** 这张表被编辑时往哪儿写错误。挂在笔记的 fsError 上,与其它错误同一个出口。 */
const errorSink = ref("")

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

/** 所有数据编辑都走这一条:算出新表 → 注册表写盘。失败会回退并写 `errorSink`。 */
async function change(next: (table: DataTable) => DataTable): Promise<void> {
  await tables.mutate(props.block.path, next, errorSink)
}

/**
 * 卡片上的字段:排除图片列(它已经是海报位)和被块设置隐藏的列。
 * 删列后残留在 `hiddenFields` 里的失效 id 在这里自然过滤,不需要另行清洗。
 */
const visibleColumns = computed<readonly DataColumn[]>(() =>
  columns.value.filter((column) => column.type !== "image" && !props.block.hiddenFields.includes(column.id)),
)

/** 该行的海报:第一个非空图片格。没有图就渲染纯文字卡。 */
function posterOf(row: DataRow): string {
  for (const column of columns.value) {
    if (column.type !== "image") continue
    const value = dt.cellValue(row, column)
    if (typeof value === "string") return value
  }
  return ""
}

/** 宫格布局:响应式交给浏览器数列数,自定义则固定 N 列(写入时已夹到 1..12)。 */
const gridStyle = computed(() => ({
  gridTemplateColumns:
    props.block.columns === "auto"
      ? "repeat(auto-fill, minmax(180px, 1fr))"
      : `repeat(${props.block.columns}, minmax(0, 1fr))`,
}))

/** 图片区显示比例:宽:高直接交给 `aspect-ratio` —— 列宽是多少,高度就跟着算到多少。 */
const ratioStyle = computed(() => ({ aspectRatio: props.block.ratio.replace(":", " / ") }))

// ---- 聚合展示 ----

/** 聚合参考列。块设置指向的列被删后这里落空,整个画册退化为平铺,无需清洗块属性。 */
const groupColumn = computed<DataColumn | null>(() =>
  columns.value.find((column) => column.id === props.block.group) ?? null,
)

/** 分组展示的参考列。可与聚合叠加(不同字段);同字段时设置层保证只剩其一,渲染层再兜底退化为平铺。 */
const groupByColumn = computed<DataColumn | null>(() =>
  columns.value.find((column) => column.id === props.block.groupBy) ?? null,
)

/** 已展开的聚合组,键为参考列的原始值。运行时状态,不持久化 —— 重开回到默认聚合。 */
const expanded = ref(new Set<string>())

watch(
  () => [props.block.group, props.block.groupBy],
  () => expanded.value.clear(),
)

/** 宫格的渲染单元:一张平铺卡是一个单元,一个聚合组也是(聚合/展开由 `stacked` 区分)。 */
interface GalleryUnit {
  /** 稳定 key:聚合组用组值,平铺行用行 id。 */
  key: string
  /** true = 聚合态,整组画成一张叠卡;false = 组内逐张平铺。 */
  stacked: boolean
  /** 代表行:聚合卡画的是它;平铺时就是那一行自己。 */
  lead: DataRow
  rows: readonly DataRow[]
}

/**
 * 分组规则:按参考列的原始值归组,产出顺序跟行的首次出现序。空值行不聚合 ——
 * 「没有合集名」的行互相无关,聚到一起是错的;单行组也不聚合,一张卡配一叠
 * 骨架是在暗示「后面还有卡」,而那里没有。
 */
function buildUnits(list: readonly DataRow[], col: DataColumn | null): GalleryUnit[] {
  if (col === null) {
    return list.map((row) => ({ key: row.id, stacked: false, lead: row, rows: [row] }))
  }

  const buckets = new Map<string, DataRow[]>()
  for (const row of list) {
    const value = dt.cellValue(row, col)
    if (value === null || value === "") continue
    const key = String(value)
    const bucket = buckets.get(key)
    if (bucket === undefined) buckets.set(key, [row])
    else bucket.push(row)
  }

  const seen = new Set<string>()
  const out: GalleryUnit[] = []
  for (const row of list) {
    const value = dt.cellValue(row, col)
    if (value === null || value === "") {
      out.push({ key: row.id, stacked: false, lead: row, rows: [row] })
      continue
    }
    const key = String(value)
    if (seen.has(key)) continue
    seen.add(key)
    const bucket = buckets.get(key)
    if (bucket === undefined) continue
    const [lead] = bucket
    if (lead === undefined) continue
    if (bucket.length < 2) {
      // 单行组平铺:一张卡配一叠骨架是在暗示「后面还有卡」,而那里没有。
      out.push({ key: lead.id, stacked: false, lead, rows: bucket })
      continue
    }
    out.push({ key, stacked: !expanded.value.has(key), lead, rows: bucket })
  }
  return out
}

const units = computed<readonly GalleryUnit[]>(() => buildUnits(rows.value, groupColumn.value))

/**
 * 宫格的分节视图:不开分组时整表一节(标题不画);开了分组则按参考列的原始值
 * 切节,节序跟值的首次出现序,空值行收进末尾的「未分组」节。节内按聚合列归组
 * (不同字段叠加:如按「状态」分节、节内按「合集」堆叠);与分组同字段时节内
 * 平铺 —— 同一列又分节又堆叠没有读法。
 */
interface GallerySection {
  /** 稳定 key:整表节固定 "all",分组节带 "g:" 前缀避免与单元 key 混淆。 */
  key: string
  /** 组的原始值(select 列即选项 id),手排清单 groupOrder 以它为准;整表节与「未分组」节为空串。 */
  value: string
  /** 节标题;null = 不画标题行(未开分组)。 */
  title: string | null
  units: readonly GalleryUnit[]
}

const sections = computed<readonly GallerySection[]>(() => {
  const col = groupByColumn.value
  if (col === null) {
    return [{ key: "all", value: "", title: null, units: units.value }]
  }
  // 节内聚合列:与分组同字段时退化为平铺(同一列又分节又堆叠没有读法)。
  const aggCol = props.block.group === props.block.groupBy ? null : groupColumn.value

  const buckets = new Map<string, DataRow[]>()
  const loose: DataRow[] = []
  for (const row of rows.value) {
    const value = dt.cellValue(row, col)
    if (value === null || value === "") {
      loose.push(row)
      continue
    }
    const key = String(value)
    const bucket = buckets.get(key)
    if (bucket === undefined) buckets.set(key, [row])
    else bucket.push(row)
  }

  const out: GallerySection[] = []
  for (const [key, bucket] of buckets) {
    const [first] = bucket
    if (first === undefined) continue
    // 标题走文本投影:select 列的原始值是选项 id,直接显示等于把内部标识漏给用户。
    const title = dt.valueText(dt.cellValue(first, col), col) || key
    out.push({
      key: `g:${key}`,
      value: key,
      title,
      units: buildUnits(bucket, aggCol),
    })
  }

  // 手排:groupOrder 里记录的组按记录序靠前,没记录的跟首现序排在后面(JS sort 稳定,
  // 同为未记录的组之间保持原相对顺序)。
  const recorded = props.block.groupOrder
  const sorted = out
    .map((sec, index) => ({ sec, index, rank: recorded.indexOf(sec.value) }))
    .sort((a, b) => {
      const ra = a.rank === -1 ? recorded.length + a.index : a.rank
      const rb = b.rank === -1 ? recorded.length + b.index : b.rank
      return ra - rb
    })
    .map((item) => item.sec)

  if (loose.length > 0) {
    sorted.push({
      key: "g:",
      value: "",
      title: "未分组",
      units: buildUnits(loose, aggCol),
    })
  }
  return sorted
})

/** 聚合 ↔ 展开的切换。只动运行时态,不碰块属性。整体换新 Set 保证响应触发。 */
function toggleGroup(key: string): void {
  const next = new Set(expanded.value)
  if (next.has(key)) next.delete(key)
  else next.add(key)
  expanded.value = next
}

/** 聚合卡的海报:组内第一个有图的行;整组无图退化为纯文字卡。 */
function posterOfRows(rowsOfGroup: readonly DataRow[]): string {
  for (const row of rowsOfGroup) {
    const poster = posterOf(row)
    if (poster !== "") return poster
  }
  return ""
}

// ---- 卡片上的内联编辑 ----

/** 正在编辑的格:`rowId:columnId`,null 表示没有格在编辑。 */
const editing = ref("")

function cellKey(row: DataRow, column: DataColumn): string {
  return row.id + ":" + column.id
}

function cellOf(row: DataRow, column: DataColumn): string {
  return dt.valueText(dt.cellValue(row, column), column)
}

/** Enter 提交:失焦即触发写盘。卡片上按 Enter 的直觉与表格一致 ——「这个值填完了」。 */
function commitOnEnter(event: Event): void {
  const target = event.target
  if (target instanceof HTMLInputElement) target.blur()
}

/** 失焦提交。值没变就不写盘;解析口径与表格编辑页共用 `dt.parseCellInput`。 */
function commitOnBlur(row: DataRow, column: DataColumn, event: Event): void {
  const target = event.target
  if (!(target instanceof HTMLInputElement)) return
  const parsed = dt.parseCellInput(target.value, column.type)
  if (parsed === dt.cellValue(row, column)) return
  void change((current) => dt.replaceRow(current, dt.setCell(row, column.id, parsed)))
}

/** 勾选格直接切换,不需要「点进编辑」那一层。 */
function toggleCheck(row: DataRow, column: DataColumn, event: Event): void {
  const target = event.target
  if (!(target instanceof HTMLInputElement)) return
  void change((current) => dt.replaceRow(current, dt.setCell(row, column.id, target.checked)))
}

// ---- 块设置 ----

/** 展示设置的改动走块属性(笔记文档),不碰 `.tbl`。patch 只带改动的键。 */
function setColumns(value: "auto" | number) {
  updateGalleryBlock(props.block.id, { columns: value })
}

function setFit(value: "cover" | "contain") {
  updateGalleryBlock(props.block.id, { fit: value })
}

function setRatio(value: string) {
  updateGalleryBlock(props.block.id, { ratio: value })
}

/** 图片比例的下拉选择:把块的 ratio 字段映成 select 值。 */
const ratioSelection = computed({
  get: () => props.block.ratio,
  set: (value: string) => setRatio(value),
})

/** 聚合参考字段:空串 = 关闭聚合。与分组可叠加(不同字段),仅当撞上分组的同一字段时把分组关掉 —— 后设的赢。 */
function setGroup(value: string) {
  updateGalleryBlock(props.block.id, {
    group: value,
    groupBy: value === props.block.groupBy ? "" : props.block.groupBy,
  })
}

/** 分组展示的依据字段:空串 = 关闭分组。与聚合可叠加(不同字段),仅当撞上聚合的同一字段时把聚合关掉 —— 后设的赢。 */
function setGroupBy(value: string) {
  updateGalleryBlock(props.block.id, {
    groupBy: value,
    group: value === props.block.group ? "" : props.block.group,
  })
}

/** 聚合参考列的下拉选择:把块的 group 字段映成 select 值,空串即关闭。 */
const groupSelection = computed({
  get: () => props.block.group,
  set: (value: string) => setGroup(value),
})

/** 分组依据列的下拉选择:把块的 groupBy 字段映成 select 值,空串即关闭。 */
const groupBySelection = computed({
  get: () => props.block.groupBy,
  set: (value: string) => setGroupBy(value),
})

/**
 * 上移/下移分组节:按当前生效顺序整体重写 groupOrder。之后它就是全量清单 ——
 * 后续新增的组值不在列表里,照常按首现序排在末尾,无需清洗。
 */
function moveGroup(value: string, dir: -1 | 1): void {
  const values = sections.value.filter((sec) => sec.value !== "").map((sec) => sec.value)
  const i = values.indexOf(value)
  const j = i + dir
  if (i === -1 || j < 0 || j >= values.length) return
  const a = values[i]
  const b = values[j]
  if (a === undefined || b === undefined) return
  values[i] = b
  values[j] = a
  updateGalleryBlock(props.block.id, { groupOrder: values })
}

function toggleField(columnId: string, checked: boolean) {
  const next = checked
    ? props.block.hiddenFields.filter((id) => id !== columnId)
    : [...props.block.hiddenFields, columnId]
  updateGalleryBlock(props.block.id, { hiddenFields: next })
}

/** 自定义列数输入 → 1..12,非法输入退回 6(宫格在常见宽度下最不难看的列数)。 */
function commitColumnCount(event: Event): void {
  const target = event.target
  if (!(target instanceof HTMLInputElement)) return
  const parsed = Number(target.value)
  target.value = String(parsed)
  setColumns(Number.isFinite(parsed) ? Math.min(12, Math.max(1, Math.round(parsed))) : 6)
}

/** 菜单外框与菜单项,与块手柄的两套菜单同一套参数。 */
const MENU = "w-[196px] rounded-island p-1.5 shadow-pop ring-0"
const ITEM = "gap-2.5 rounded-[7px] px-2 py-1"

const FIT_ITEMS = [
  { value: "cover", label: "裁剪填充" },
  { value: "contain", label: "完整显示" },
] satisfies readonly { value: "cover" | "contain"; label: string }[]

/** 比例预设:海报(2:3)起步,竖横各两档,覆盖常见的方形 / 竖屏 / 宽屏诉求。 */
const RATIO_ITEMS = [
  { value: "1:1", label: "方形 1:1" },
  { value: "2:3", label: "海报 2:3" },
  { value: "3:4", label: "竖版 3:4" },
  { value: "9:16", label: "竖屏 9:16" },
  { value: "4:3", label: "横版 4:3" },
  { value: "16:9", label: "宽屏 16:9" },
] satisfies readonly { value: string; label: string }[]

function openTable() {
  if (props.block.path === "") return
  // 走工作区的打开入口 —— 标签、按需读都由它统一管。
  openFile(props.block.path)
}

/** 编辑态的输入框一挂载就聚焦:点值即编辑,焦点应已在框里,而不是再点一下。 */
function focusOnMount(el: unknown): void {
  if (el instanceof HTMLInputElement) el.focus()
}
</script>

<template>
  <!-- 空指针(转换流程修好前的遗留块 / 手工编辑):如实说没指定,而不是永远转圈。 -->
  <div
    v-if="props.block.path === ''"
    class="my-4 flex items-center gap-2.5 rounded-lg border border-dashed border-line bg-muted/40 px-3 py-2.5"
  >
    <DatabaseIcon class="size-3.5 shrink-0 text-muted-foreground" />
    <span class="text-[12px] text-muted-foreground">
      画册未指定数据表 —— 删掉这个块,用 / 菜单重新插入。
    </span>
  </div>

  <!-- 引用的文件读不到:提示态,不是错误态。与数据表引用块同一套观感。 -->
  <div
    v-else-if="state === 'missing' || state === 'failed'"
    class="my-4 flex items-center gap-2.5 rounded-lg border border-dashed border-line bg-muted/40 px-3 py-2.5"
  >
    <DatabaseIcon class="size-3.5 shrink-0 text-muted-foreground" />
    <span class="text-[12px] text-muted-foreground">
      画册引用的数据表不存在:<span class="font-mono">{{ props.block.path }}</span>
    </span>
  </div>

  <!-- 还没读完。占位高度避免读盘回来时页面跳一下。 -->
  <div
    v-else-if="table === null"
    class="my-4 flex items-center gap-2.5 rounded-lg border border-line bg-muted/30 px-3 py-2.5"
  >
    <DatabaseIcon class="size-3.5 shrink-0 animate-pulse text-muted-foreground" />
    <span class="text-[12px] text-muted-foreground">正在读取数据表…</span>
  </div>

  <div v-else class="group/gallery relative my-4">
    <!-- 块操作入口:右上角,悬停浮现。z-20 压过聚合卡的 z-10,否则首行最右的卡会盖住它。 -->
    <div class="absolute -top-2 right-0 z-20 flex items-center gap-1 opacity-0 transition-opacity group-hover/gallery:opacity-100 focus-within:opacity-100">
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
            布局
          </DropdownMenuLabel>
          <DropdownMenuCheckboxItem
            :class="ITEM"
            :model-value="props.block.columns === 'auto'"
            @update:model-value="(checked: boolean) => { if (checked) setColumns('auto') }"
          >
            <span>响应式列数</span>
          </DropdownMenuCheckboxItem>
          <DropdownMenuCheckboxItem
            :class="ITEM"
            :model-value="props.block.columns !== 'auto'"
            @update:model-value="(checked: boolean) => { if (!checked) return }"
            @select.prevent
          >
            <span>自定义列数</span>
            <input
              type="number"
              min="1"
              max="12"
              class="ml-auto w-10 rounded border border-line bg-transparent px-1 text-right text-[11px] outline-none"
              :value="props.block.columns === 'auto' ? 6 : props.block.columns"
              @click.stop
              @keydown.enter.prevent="commitOnEnter"
              @blur="commitColumnCount"
            >
          </DropdownMenuCheckboxItem>
          <DropdownMenuSeparator class="mx-2 my-1 bg-line" />
          <DropdownMenuLabel class="px-2 pb-1 pt-1.5 text-[11px] font-normal text-muted-foreground">
            图片填充
          </DropdownMenuLabel>
          <DropdownMenuCheckboxItem
            v-for="item in FIT_ITEMS"
            :key="item.value"
            :class="ITEM"
            :model-value="props.block.fit === item.value"
            @update:model-value="(checked: boolean) => { if (checked) setFit(item.value) }"
          >
            <span>{{ item.label }}</span>
          </DropdownMenuCheckboxItem>
          <DropdownMenuSeparator class="mx-2 my-1 bg-line" />
          <DropdownMenuLabel class="px-2 pb-1 pt-1.5 text-[11px] font-normal text-muted-foreground">
            图片比例
          </DropdownMenuLabel>
          <div class="px-2 pb-1.5">
            <select
              v-model="ratioSelection"
              class="w-full cursor-pointer rounded border border-line bg-transparent px-1.5 py-1 text-[12px] outline-none"
            >
              <option v-for="item in RATIO_ITEMS" :key="item.value" :value="item.value">
                {{ item.label }}
              </option>
            </select>
          </div>
          <template v-if="columns.some((column) => column.type !== 'image')">
            <DropdownMenuSeparator class="mx-2 my-1 bg-line" />
            <DropdownMenuLabel class="px-2 pb-1 pt-1.5 text-[11px] font-normal text-muted-foreground">
              聚合展示
            </DropdownMenuLabel>
            <div class="px-2 pb-1.5">
              <select
                v-model="groupSelection"
                class="w-full cursor-pointer rounded border border-line bg-transparent px-1.5 py-1 text-[12px] outline-none"
              >
                <option value="">关闭(平铺展示)</option>
                <option v-for="column in columns.filter((c) => c.type !== 'image')" :key="column.id" :value="column.id">
                  {{ column.name }}
                </option>
              </select>
            </div>
          </template>
          <template v-if="columns.some((column) => column.type !== 'image')">
            <DropdownMenuSeparator class="mx-2 my-1 bg-line" />
            <DropdownMenuLabel class="px-2 pb-1 pt-1.5 text-[11px] font-normal text-muted-foreground">
              分组展示
            </DropdownMenuLabel>
            <div class="px-2 pb-1.5">
              <select
                v-model="groupBySelection"
                class="w-full cursor-pointer rounded border border-line bg-transparent px-1.5 py-1 text-[12px] outline-none"
              >
                <option value="">关闭</option>
                <option v-for="column in columns.filter((c) => c.type !== 'image')" :key="column.id" :value="column.id">
                  {{ column.name }}
                </option>
              </select>
              <!-- 组序手排:开了分组才出现;按当前生效顺序列出各组,↑↓ 即时写回 groupOrder。
                   mt 与 select 拉开间距,px-1.5 对齐 select 的边框内文字。 -->
              <div v-if="props.block.groupBy !== ''" class="mt-1.5 space-y-0.5 px-1.5">
                <div v-for="sec in sections" v-show="sec.value !== ''" :key="sec.key" class="flex items-center gap-1">
                  <span class="min-w-0 flex-1 truncate text-[12px]" :class="sec.title === null && 'text-muted-foreground'">{{ sec.title }}</span>
                  <button
                    type="button"
                    aria-label="上移该组"
                    class="rounded p-0.5 text-muted-foreground hover:bg-muted hover:text-foreground"
                    @click="moveGroup(sec.value, -1)"
                  >
                    <ChevronUpIcon class="size-3" />
                  </button>
                  <button
                    type="button"
                    aria-label="下移该组"
                    class="rounded p-0.5 text-muted-foreground hover:bg-muted hover:text-foreground"
                    @click="moveGroup(sec.value, 1)"
                  >
                    <ChevronDownIcon class="size-3" />
                  </button>
                </div>
              </div>
            </div>
          </template>
          <template v-if="columns.some((column) => column.type !== 'image')">
            <DropdownMenuSeparator class="mx-2 my-1 bg-line" />
            <DropdownMenuLabel class="px-2 pb-1 pt-1.5 text-[11px] font-normal text-muted-foreground">
              字段
            </DropdownMenuLabel>
            <DropdownMenuCheckboxItem
              v-for="column in columns"
              :key="column.id"
              v-show="column.type !== 'image'"
              :class="ITEM"
              :model-value="!props.block.hiddenFields.includes(column.id)"
              @update:model-value="(checked: boolean) => toggleField(column.id, checked)"
              @select.prevent
            >
              <span class="truncate">{{ column.name }}</span>
            </DropdownMenuCheckboxItem>
          </template>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>

    <!-- 宫格。空表给一句说明,而不是留一片空白。 -->
    <p v-if="rows.length === 0" class="py-6 text-center text-[12px] text-muted-foreground">
      这张表还没有行 —— 到数据表里添加后,画册会自动出现。
    </p>
    <div v-else class="flex flex-col gap-3">
      <section v-for="sec in sections" :key="sec.key">
        <p v-if="sec.title !== null" class="pb-1 text-[12px] font-medium text-muted-foreground">{{ sec.title }}</p>
        <div class="grid gap-3" :style="gridStyle">
      <template v-for="unit in sec.units" :key="unit.key">
        <!-- 聚合态:一张代表卡 + 底部两叠收窄的骨架,hover 浮出展开按钮。
             代表卡只读 —— 在它上面编辑说不清「改的是哪一季」,展开后再改。 -->
        <div v-if="unit.stacked" class="group/gstack relative pb-3">
          <div class="absolute inset-x-4 bottom-0 h-1 rounded-b-lg bg-[#8080801f]" />
          <div class="absolute inset-x-2 bottom-1 h-2 rounded-b-lg bg-[#80808033]" />

          <div class="relative z-10 overflow-hidden rounded-lg border border-line bg-background">
            <img
              v-if="posterOfRows(unit.rows) !== ''"
              :src="posterOfRows(unit.rows)"
              alt=""
              class="w-full"
              :class="props.block.fit === 'cover' ? 'object-cover' : 'object-contain'"
              :style="ratioStyle"
            >
            <div v-else class="flex w-full items-center justify-center bg-muted/40" :style="ratioStyle">
              <LayoutGridIcon class="size-4 text-muted-foreground/40" />
            </div>

            <div class="px-2.5 py-1">
              <div v-for="column in visibleColumns" :key="column.id" class="flex min-h-6 items-center gap-2 py-0.5">
                <span class="shrink-0 whitespace-nowrap text-[11px] text-muted-foreground/70">{{ column.name }}</span>
                <span class="w-full min-w-0 truncate px-0.5 text-[12px]">{{ cellOf(unit.lead, column) || "空" }}</span>
              </div>
            </div>
          </div>

          <button
            type="button"
            class="absolute -bottom-3 left-1/2 z-20 flex h-6 -translate-x-1/2 items-center gap-1 rounded-full border border-line bg-background px-2 text-[12px] text-muted-foreground opacity-0 shadow-island transition-opacity pointer-events-none hover:text-foreground group-hover/gstack:pointer-events-auto group-hover/gstack:opacity-100"
            @click="toggleGroup(unit.key)"
          >
            <UnfoldVerticalIcon class="size-3" />展开
          </button>
        </div>

        <!-- 平铺态(未聚合 / 已展开 / 无聚合字段):逐行一张卡,编辑与从前一致。
             只有「展开的聚合组」才挂聚合按钮 —— 单行卡没有可聚合的同伴。 -->
        <template v-else>
          <div v-for="row in unit.rows" :key="row.id" class="group/gcard relative">
            <div class="overflow-hidden rounded-lg border border-line bg-background">
              <img
                v-if="posterOf(row) !== ''"
                :src="posterOf(row)"
                alt=""
                class="w-full"
                :class="props.block.fit === 'cover' ? 'object-cover' : 'object-contain'"
                :style="ratioStyle"
              >
              <div v-else class="flex w-full items-center justify-center bg-muted/40" :style="ratioStyle">
                <LayoutGridIcon class="size-4 text-muted-foreground/40" />
              </div>

              <div class="px-2.5 py-1">
                <div v-for="column in visibleColumns" :key="column.id" class="flex min-h-6 items-center gap-2 py-0.5">
                  <span class="shrink-0 whitespace-nowrap text-[11px] text-muted-foreground/70">{{ column.name }}</span>

                  <input
                    v-if="column.type === 'checkbox'"
                    type="checkbox"
                    class="size-3.5 accent-foreground"
                    :checked="dt.cellValue(row, column) === true"
                    @change="(event: Event) => toggleCheck(row, column, event)"
                  >

                  <input
                    v-else-if="editing === cellKey(row, column)"
                    :ref="focusOnMount"
                    class="w-full min-w-0 bg-transparent text-[12px] outline-none"
                    :value="cellOf(row, column)"
                    :placeholder="column.type === 'date' ? 'YYYY-MM-DD' : ''"
                    @keydown.enter.prevent="commitOnEnter"
                    @blur="(event: Event) => { commitOnBlur(row, column, event); editing = '' }"
                  >

                  <button
                    v-else
                    type="button"
                    class="w-full min-w-0 rounded px-0.5 text-left text-[12px] hover:bg-muted"
                    @click="editing = cellKey(row, column)"
                  >
                    <span class="break-words" :class="cellOf(row, column) === '' && 'text-muted-foreground/40'">{{ cellOf(row, column) || "空" }}</span>
                  </button>
                </div>
              </div>
            </div>

            <button
              v-if="unit.rows.length > 1"
              type="button"
              class="absolute -bottom-3 left-1/2 z-20 flex h-6 -translate-x-1/2 items-center gap-1 rounded-full border border-line bg-background px-2 text-[12px] text-muted-foreground opacity-0 shadow-island transition-opacity pointer-events-none hover:text-foreground group-hover/gcard:pointer-events-auto group-hover/gcard:opacity-100"
              @click="toggleGroup(unit.key)"
            >
              <FoldVerticalIcon class="size-3" />聚合
            </button>
          </div>
        </template>
      </template>
        </div>
      </section>
    </div>

  </div>
</template>

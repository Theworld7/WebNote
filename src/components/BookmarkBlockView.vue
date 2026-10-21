<script setup lang="ts">
import type { BookmarkBlock } from "@/types/workspace"
import type { DataColumn, DataRow } from "@/types/data-table"
import type { ComponentPublicInstance } from "vue"
import { computed, nextTick, ref, watch } from "vue"
import { DatabaseIcon, ImagePlusIcon, PencilIcon, PlusIcon, Settings2Icon, Trash2Icon, XIcon } from "@lucide/vue"
import { Button } from "@/components/ui/button"
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import TableRefNotice from "@/components/TableRefNotice.vue"
import { useWorkspace } from "@/composables/useWorkspace"
import { useTableEntry } from "@/composables/useTableEntry"
import { isImageFile, readImageFile } from "@/lib/image"
import { linkDomain, linkIcon } from "@/lib/inline"
import * as dt from "@/lib/data-table"

/**
 * 书签块:把一张数据表的每一行渲染成一张横向信息卡 —— 左图标,右侧名称与域名。
 * 与行内链接的书签磁贴(`data-link-shape="card"`)分开两套样式:磁贴是正文里的
 * 行内对象、固定 96px,这里是一块可伸缩的宫格卡片,共用一套会把两边都拧巴。
 *
 * 数据链路与 `GalleryBlockView` 完全同源,取数与改表走 `useTableEntry` 共用 seam,
 * 这里不再复述。不同的只有展示设置:名称列、链接列、列数,都是**块的属性**,
 * 同一张表在两篇笔记里可以各挑各的字段。
 *
 * 就地增删改与看板卡 / 账目行同一套口径(解析走 `dt.parseCellInput`,经 `change`
 * 记在当前笔记名下):卡片悬停出「编辑 / 删除」,编辑收进模态框 —— 表单按列类型
 * 铺开数据表的**全部字段**,块设置只决定哪几列拿来当名称/链接/图标,不限制可编辑的列。
 * 删除走确认框:删的是盘上数据表里的行,撤销不了。
 * 「添加书签」在块操作入口里,追加一行后弹同一个框,光标直接落进第一列。
 */
const props = defineProps<{ block: BookmarkBlock }>()

const { openFile, updateBlockSettings } = useWorkspace()

const { state, table, columns, rows, change } = useTableEntry(() => props.block.path)

/** 指向的列被删后这里落空,整块退化为「未设置」提示态,无需清洗块属性。 */
const nameColumn = computed<DataColumn | null>(() => columns.value.find((column) => column.id === props.block.nameColumn) ?? null)
const urlColumn = computed<DataColumn | null>(() => columns.value.find((column) => column.id === props.block.urlColumn) ?? null)
/** 图标列未设置(字段缺省)时按链接派生 —— 与行内链接的书签卡片同一规则。 */
const iconColumn = computed<DataColumn | null>(() => {
  if (props.block.iconColumn === undefined || props.block.iconColumn === "") return null
  return columns.value.find((column) => column.id === props.block.iconColumn) ?? null
})

/** 行 → (名称, 地址)。列未设置或值为空都落空串,由模板决定渲染成什么。 */
function fieldOf(row: DataRow, column: DataColumn | null): string {
  if (column === null) return ""
  return dt.valueText(dt.cellValue(row, column), column)
}

/** 行 → 图标字符。图标列设了以列值为准,空值逐行回退到链接派生(与序列化同一规则)。 */
function iconOf(row: DataRow): string {
  const fromColumn = fieldOf(row, iconColumn.value).trim().charAt(0).toUpperCase()
  return fromColumn === "" ? linkIcon(fieldOf(row, urlColumn.value)) : fromColumn
}

/** 行 → 副标题里的域名。与图标一样是地址的派生,空地址不画这一行。 */
function domainOf(row: DataRow): string {
  return linkDomain(fieldOf(row, urlColumn.value))
}

/**
 * 行 → 图片图标地址。图标列的值直接当图片地址用(data URI / URL 都行 —— image 列
 * 存的就是 data URI,text 列填 URL 也能显示),不走 `valueText`:图片列的文本投影
 * 恒为空串是数据表的既有立场。
 */
function iconSrcOf(row: DataRow): string {
  const column = iconColumn.value
  if (column === null) return ""
  const value = dt.cellValue(row, column)
  return typeof value === "string" && value !== "" ? value : ""
}

/**
 * 逐行记录图片加载结果:只有 `load` 成功的行才展示图片图标,加载中/失败/无值
 * 都回退到字符图标(伪元素),不会露出破图。换列或改值后 img 重新加载,事件
 * 会把状态修正,无需主动清洗。
 *
 * img 不能挂 `loading="lazy"`:它初始带着 `hidden`(display:none)等 load 触发,
 * 而懒加载图片没有布局盒就永远不进视口、永远不开始加载 —— 两边互等,死锁
 * (Chromium 实测:data URI + lazy + display:none,load 永不触发)。image 列的
 * 值是 data URI,没有网络成本,直接加载即可,懒加载在这里只有死锁没有收益。
 */
const loadedIcons = ref<Record<string, boolean>>({})
function onIconLoad(id: string) {
  loadedIcons.value[id] = true
}

function onIconError(id: string) {
  delete loadedIcons.value[id]
}

/** 行 → 展示中的图片图标地址;null 表示这一行走字符图标。 */
function shownIconOf(row: DataRow): string | null {
  const src = iconSrcOf(row)
  return src !== "" && loadedIcons.value[row.id] === true ? src : null
}

/** 宫格布局:响应式交给浏览器数列数,自定义则固定 N 列 —— 与画册同一套口径。 */
const gridStyle = computed(() => ({
  gridTemplateColumns:
    props.block.columns === "auto"
      ? "repeat(auto-fill, minmax(220px, 1fr))"
      : `repeat(${props.block.columns}, minmax(0, 1fr))`,
}))

// ---- 就地增删改 ----

/**
 * 正在编辑的书签(行 id);空串 = 没有模态框。表单按列类型铺开数据表的全部字段,
 * 卡片上放不下;进框拷一份草稿,保存时统一解析落盘,取消即丢弃。
 */
const editingId = ref("")
/** 模态框这次打开是「添加」还是「编辑」,只用来定标题。 */
const isAdding = ref(false)

/**
 * 模态框草稿:列 id → 表单里的值。
 *
 * 文本 / 数字 / 日期先存**输入框原串**,保存时统一走 `parseCellInput` —— 边输边解析
 * 会把「-」「2026-」这类中间态吞成空值。单选存选项 id,勾选存 boolean,图片存
 * data URI(清除后是 null)。
 */
type DraftCell = string | boolean | null
const draft = ref<Record<string, DraftCell>>({})

function draftFromRow(row: DataRow): Record<string, DraftCell> {
  const next: Record<string, DraftCell> = {}
  for (const column of columns.value) {
    const value = dt.cellValue(row, column)
    if (column.type === "checkbox") next[column.id] = value === true
    else if (column.type === "select") next[column.id] = typeof value === "string" ? value : ""
    else next[column.id] = value === null ? "" : String(value)
  }
  return next
}

function focusOnMount(el: unknown): void {
  if (el instanceof HTMLInputElement || el instanceof HTMLSelectElement) el.focus()
}

/** 表单第一列的 id —— 打开框时把焦点放进去,不用先点一下。 */
const firstFieldId = computed(() => columns.value[0]?.id ?? "")

function openEdit(row: DataRow): void {
  isAdding.value = false
  draft.value = draftFromRow(row)
  editingId.value = row.id
}

function closeEdit(): void {
  editingId.value = ""
}

/** 草稿里某一列的文本形态。单选格的选项 id、图片的 data URI 也走这里取显示值。 */
function draftTextOf(column: DataColumn): string {
  const value = draft.value[column.id]
  return typeof value === "string" ? value : ""
}

function setDraftText(column: DataColumn, event: Event): void {
  const target = event.target
  if (!(target instanceof HTMLInputElement)) return
  draft.value = { ...draft.value, [column.id]: target.value }
}

function setDraftOption(column: DataColumn, event: Event): void {
  const target = event.target
  if (!(target instanceof HTMLSelectElement)) return
  draft.value = { ...draft.value, [column.id]: target.value }
}

function setDraftChecked(column: DataColumn, event: Event): void {
  const target = event.target
  if (!(target instanceof HTMLInputElement)) return
  draft.value = { ...draft.value, [column.id]: target.checked }
}

/** 图片列:选图 / 预览 / 清除都只改草稿,点「保存」才落盘。 */
async function pickDraftImage(column: DataColumn, event: Event): Promise<void> {
  const target = event.target
  if (!(target instanceof HTMLInputElement) || target.files === null) return
  const file = target.files[0]
  // 先清空再读:清掉后重选同一个文件也能触发 change。
  target.value = ""
  if (file === undefined || !isImageFile(file)) return
  const uri = await readImageFile(file)
  draft.value = { ...draft.value, [column.id]: uri }
}

function clearDraftImage(column: DataColumn): void {
  draft.value = { ...draft.value, [column.id]: null }
}

/**
 * 保存:逐列把草稿解析成该列类型的原生值,与原来不同的合进一行、一次 `change`
 * 落盘(只记一次脏),然后关框。
 */
function saveEdit(): void {
  const row = rows.value.find((item) => item.id === editingId.value)
  if (row === undefined) return closeEdit()

  let working = row
  for (const column of columns.value) {
    const raw = draft.value[column.id] ?? ""
    const value =
      column.type === "checkbox"
        ? raw === true
        : column.type === "image"
          ? typeof raw === "string" && raw !== ""
            ? raw
            : null
          : dt.parseCellInput(typeof raw === "string" ? raw : "", column.type)
    if (value !== dt.cellValue(row, column)) working = dt.setCell(working, column.id, value)
  }
  if (working !== row) void change((current) => dt.replaceRow(current, working))
  closeEdit()
}

/** 输入框里回车 = 保存(表单语义)。 */
function saveOnEnter(event: Event): void {
  if (event.target instanceof HTMLInputElement) saveEdit()
}

/** 加一枚书签:表尾追加一行,随即弹模态框补全部字段,光标落在第一列。 */
async function addBookmark(): Promise<void> {
  await change((current) => dt.addRow(current))
  const added = rows.value[rows.value.length - 1]
  if (added === undefined) return
  isAdding.value = true
  draft.value = draftFromRow(added)
  editingId.value = added.id
}

/**
 * 待确认删除的行 id;空串 = 没有确认框。删的是盘上数据表里的一行,没有撤销 ——
 * 悬停按钮直接删太危险,先问一句。正在编辑这一张时先收掉编辑框,免得框跟着
 * 一个已消失的行。
 */
const deletingId = ref("")

const deletingName = computed(() => {
  const row = rows.value.find((item) => item.id === deletingId.value)
  const column = nameColumn.value
  if (row === undefined || column === null) return ""
  return fieldOf(row, column)
})

function requestDelete(row: DataRow): void {
  if (editingId.value === row.id) closeEdit()
  deletingId.value = row.id
}

function closeDelete(): void {
  deletingId.value = ""
}

function confirmDelete(): void {
  const row = rows.value.find((item) => item.id === deletingId.value)
  if (row === undefined) return closeDelete()
  void change((current) => dt.removeRow(current, row.id))
  closeDelete()
}

/** 分组字段的列。未设置或指向的列被删后落空,整块退化为平铺,无需清洗块属性。 */
const groupByColumn = computed<DataColumn | null>(() => {
  if (props.block.groupBy === undefined || props.block.groupBy === "") return null
  return columns.value.find((column) => column.id === props.block.groupBy) ?? null
})

/** 宫格的分节视图:不开分组时整表一节(标题不画),开了则按列值切节。 */
interface BookmarkSection {
  /** 稳定 key:整表节固定 "all",分组节带 "g:" 前缀。 */
  key: string
  /** 节标题;null = 不画标题行(未开分组)。 */
  title: string | null
  rows: readonly DataRow[]
}

/**
 * 分组规则收在 `dt.groupRows`(与看板列 / 画册节同一套):节序跟值的首次出现序,
 * 空值行收进末尾的「未分组」节 ——「没有这一项」的行互相无关,混进第一个组是错的。
 * 标题走文本投影:select 列的原始值是选项 id,直接显示等于把内部标识漏给用户。
 */
const sections = computed<readonly BookmarkSection[]>(() => {
  const column = groupByColumn.value
  if (column === null) return [{ key: "all", title: null, rows: rows.value }]

  const { groups: bucketed, loose } = dt.groupRows(rows.value, column)
  const out: BookmarkSection[] = bucketed.map((bucket) => ({
    key: `g:${bucket.key}`,
    title: bucket.title,
    rows: bucket.rows,
  }))
  if (loose.length > 0) out.push({ key: "g:", title: "未分组", rows: loose })
  return out
})

/** 逐行名称元素的引用表:只用来测截断,不参与渲染。 */
const nameEls = new Map<string, HTMLElement>()

function setNameEl(id: string, el: Element | ComponentPublicInstance | null) {
  if (el instanceof HTMLElement) nameEls.set(id, el)
  else nameEls.delete(id)
}

/**
 * 被截断的行集合 —— 名称完整时不该弹提示,那是噪音。
 *
 * 名称的可用宽度随宫格列数与窗口变化,所以重测挂在分节结果上之外,还要盯住
 * 容器尺寸(ResizeObserver):换列数、窗口变窄都可能让原先完整的名称变成截断。
 */
const truncatedNames = ref(new Set<string>())

function measureTruncation() {
  const next = new Set<string>()
  for (const [id, el] of nameEls) {
    if (el.scrollWidth > el.clientWidth) next.add(id)
  }
  truncatedNames.value = next
}

watch(sections, () => void nextTick(measureTruncation))

/** 容器的宽度变化(窗口缩放、侧栏开合)同样会改变截断,跟着重量一次。
    根节点是条件渲染的(表读完才出现),所以监听 ref 本身而不是在 onMounted 里拿。 */
const rootEl = ref<HTMLElement | null>(null)

watch(
  rootEl,
  (el, _previous, onCleanup) => {
    if (el === null) return
    const observer = new ResizeObserver(() => measureTruncation())
    observer.observe(el)
    onCleanup(() => observer.disconnect())
  },
  { immediate: true },
)

/** 菜单外框与下拉框,与画册设置菜单同一套参数。 */
const MENU = "w-48 rounded-island p-1.5 shadow-pop ring-0"
/** 下拉框观感照搬画册设置里的 select,两处菜单放一起看不出差别。 */
const SELECT = "w-full cursor-pointer rounded border border-line bg-transparent px-1.5 py-1 text-[12px] outline-none"
/** 编辑模态框的输入框(与 SELECT 同一套观感)与底部按钮(与关标签确认框同一体量)。 */
const FIELD = "w-full rounded border border-line bg-transparent px-1.5 py-1 text-[12px] outline-none"
const DIALOG_BTN = "h-7 px-3 text-[13px]"

const COLUMN_COUNTS = [1, 2, 3, 4, 5, 6] as const

function setColumns(value: "auto" | number) {
  updateBlockSettings(props.block.id, { columns: value })
}

/**
 * 四个设置项都是下拉框:值域有限、当前值要一眼看见 —— 这与画册设置的取舍一致
 * (勾选列表要点开菜单才知道选了什么,列名一多还容易看花)。
 *
 * 名称列 / 链接列的空串即「未设置」,渲染时走引导提示;图标列的空串对应
 * 「按链接派生」,与块字段缺省同一语义。
 */
const nameSelection = computed({
  get: () => props.block.nameColumn,
  set: (value: string) => updateBlockSettings(props.block.id, { nameColumn: value }),
})

const urlSelection = computed({
  get: () => props.block.urlColumn,
  set: (value: string) => updateBlockSettings(props.block.id, { urlColumn: value }),
})

const iconSelection = computed({
  get: () => props.block.iconColumn ?? "",
  set: (value: string) => updateBlockSettings(props.block.id, { iconColumn: value }),
})

/** 分组字段的下拉选择:空串 = 不分组(平铺)。图片列的值是 data URI,分组无意义,不列。 */
const groupSelection = computed({
  get: () => props.block.groupBy ?? "",
  set: (value: string) => updateBlockSettings(props.block.id, { groupBy: value }),
})

/** 列数的下拉选择:select 的值是字符串,"auto" 之外的映回数字。 */
const columnsSelection = computed({
  get: () => (props.block.columns === "auto" ? "auto" : String(props.block.columns)),
  set: (value: string) => setColumns(value === "auto" ? "auto" : Number(value)),
})
</script>

<template>
  <!-- 空指针:如实说没指定,而不是永远转圈。 -->
  <TableRefNotice v-if="props.block.path === ''" kind="unset" label="书签" />

  <!-- 引用的文件读不到:提示态,不是错误态。 -->
  <TableRefNotice
    v-else-if="state === 'missing' || state === 'failed'"
    kind="missing"
    label="书签"
    :path="props.block.path"
  />

  <!-- 还没读完。 -->
  <TableRefNotice v-else-if="table === null" kind="loading" label="书签" />

  <div v-else ref="rootEl" class="group/bookmark relative my-4">
    <!-- 块操作入口:右上角,悬停浮现。与画册的入口同一套;浅阴影把浮岛从正文上托起来。 -->
    <div class="absolute -top-2 right-0 z-20 flex items-center gap-1 opacity-0 transition-opacity group-hover/bookmark:opacity-100 focus-within:opacity-100">
      <!-- 添加书签 = 表尾追加一行并进编辑态;名称/链接列没挑时没有可写的字段,不给入口。 -->
      <Button
        v-if="nameColumn !== null && urlColumn !== null"
        variant="ghost"
        size="sm"
        class="h-6 gap-1 rounded-full bg-background px-2 text-[12px] text-muted-foreground shadow-sm hover:text-foreground"
        @click="addBookmark"
      >
        <PlusIcon class="size-3" />添加书签
      </Button>
      <Button
        variant="ghost"
        size="sm"
        class="h-6 gap-1 rounded-full bg-background px-2 text-[12px] text-muted-foreground shadow-sm hover:text-foreground"
        @click="openFile(props.block.path)"
      >
        <DatabaseIcon class="size-3" />打开数据表
      </Button>
      <DropdownMenu>
        <DropdownMenuTrigger as-child>
          <Button variant="ghost" size="sm" class="h-6 gap-1 rounded-full bg-background px-2 text-[12px] text-muted-foreground shadow-sm hover:text-foreground">
            <Settings2Icon class="size-3" />设置
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent :class="MENU" align="end">
          <DropdownMenuLabel class="px-2 pb-1 pt-1.5 text-[11px] font-normal text-muted-foreground">
            名称列
          </DropdownMenuLabel>
          <div class="px-2 pb-1.5">
            <select v-model="nameSelection" :class="SELECT">
              <option value="">未设置</option>
              <option v-for="column in columns" :key="`name-${column.id}`" :value="column.id">
                {{ column.name }}
              </option>
            </select>
          </div>

          <DropdownMenuSeparator class="mx-2 my-1 bg-line" />
          <DropdownMenuLabel class="px-2 pb-1 pt-1.5 text-[11px] font-normal text-muted-foreground">
            链接列
          </DropdownMenuLabel>
          <div class="px-2 pb-1.5">
            <select v-model="urlSelection" :class="SELECT">
              <option value="">未设置</option>
              <option v-for="column in columns" :key="`url-${column.id}`" :value="column.id">
                {{ column.name }}
              </option>
            </select>
          </div>

          <DropdownMenuSeparator class="mx-2 my-1 bg-line" />
          <DropdownMenuLabel class="px-2 pb-1 pt-1.5 text-[11px] font-normal text-muted-foreground">
            图标列
          </DropdownMenuLabel>
          <div class="px-2 pb-1.5">
            <select v-model="iconSelection" :class="SELECT">
              <option value="">按链接派生</option>
              <option v-for="column in columns" :key="`icon-${column.id}`" :value="column.id">
                {{ column.name }}
              </option>
            </select>
          </div>

          <DropdownMenuSeparator class="mx-2 my-1 bg-line" />
          <DropdownMenuLabel class="px-2 pb-1 pt-1.5 text-[11px] font-normal text-muted-foreground">
            分组
          </DropdownMenuLabel>
          <div class="px-2 pb-1.5">
            <select v-model="groupSelection" :class="SELECT">
              <option value="">不分组</option>
              <option v-for="column in columns.filter((c) => c.type !== 'image')" :key="`group-${column.id}`" :value="column.id">
                {{ column.name }}
              </option>
            </select>
          </div>

          <DropdownMenuSeparator class="mx-2 my-1 bg-line" />
          <DropdownMenuLabel class="px-2 pb-1 pt-1.5 text-[11px] font-normal text-muted-foreground">
            布局
          </DropdownMenuLabel>
          <div class="px-2 pb-1.5">
            <select v-model="columnsSelection" :class="SELECT">
              <option value="auto">响应式列数</option>
              <option v-for="count in COLUMN_COUNTS" :key="count" :value="String(count)">{{ count }} 列</option>
            </select>
          </div>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>

    <!-- 字段未挑全:引导去设置,而不是渲染一排空卡。 -->
    <p
      v-if="nameColumn === null || urlColumn === null"
      class="py-6 text-center text-[12px] text-muted-foreground"
    >
      在「设置」里挑选名称列和链接列后,每一行会变成一枚书签卡片。
    </p>

    <!-- 宫格。空表给一句说明,表尾的「添加书签」即入口。 -->
    <div v-else class="flex flex-col gap-3">
      <p v-if="rows.length === 0" class="py-2 text-center text-[12px] text-muted-foreground">
        这张表还没有书签 —— 点上方「添加书签」开始。
      </p>

      <!-- 分节宫格:不开分组时只有一节且不画标题,观感与平铺无差别。 -->
      <template v-if="rows.length > 0">
        <section v-for="sec in sections" :key="sec.key">
          <p v-if="sec.title !== null" class="pb-1 text-[12px] font-medium text-muted-foreground">{{ sec.title }}</p>
          <ul class="m-0 grid list-none gap-2.5 p-0" :style="gridStyle">
            <li v-for="row in sec.rows" :key="row.id" class="group/card relative min-w-0">
              <!-- 悬停操作:编辑 / 删除。锚在卡片右下角、向下半露 —— 不占卡片右侧宽度,
                   名称与域名可以用满整行。 -->
              <span class="absolute right-1 bottom-0 z-10 hidden translate-y-1/2 items-center gap-1.5 rounded-full border border-line bg-background p-0.5 shadow-sm group-hover/card:flex">
                <button
                  type="button"
                  aria-label="编辑书签"
                  class="rounded-full p-0.5 text-muted-foreground hover:text-foreground"
                  @click="openEdit(row)"
                >
                  <PencilIcon class="size-3" />
                </button>
                <button
                  type="button"
                  aria-label="删除书签"
                  class="rounded-full p-0.5 text-muted-foreground hover:text-destructive"
                  @click="requestDelete(row)"
                >
                  <Trash2Icon class="size-3" />
                </button>
              </span>

              <!-- 只有名称被截断的行才开 tooltip(disabled 绑定测量结果)—— 名称完整时
                   划过每张卡都弹一遍提示是噪音。 -->
              <Tooltip :disabled="!truncatedNames.has(row.id)">
                <TooltipTrigger as-child>
                  <!-- 横向信息卡:左图标、右侧名称与域名。图标列的值能加载成图片时挂
                       data-icon-image,伪元素字符退场,由 img 顶替(样式见 style.css 的
                       .note-bm-card 段);加载中或失败不带这个属性,照常显示字符。
                       没填链接的行不挂 href —— 锚点没有 href 就不是链接,点击不会跳转。 -->
                  <a
                    :href="fieldOf(row, urlColumn) || undefined"
                    target="_blank"
                    rel="noreferrer"
                    class="note-bm-card"
                    :data-icon="iconOf(row)"
                    :data-icon-image="shownIconOf(row) !== null ? '' : undefined"
                  ><img
                    v-if="iconSrcOf(row) !== ''"
                    :src="iconSrcOf(row)"
                    alt=""
                    decoding="async"
                    class="note-bookmark-icon"
                    :class="shownIconOf(row) !== null ? '' : 'hidden'"
                    @load="onIconLoad(row.id)"
                    @error="onIconError(row.id)"
                  ><span :ref="(el) => setNameEl(row.id, el)" class="note-bm-text"><span class="note-bm-name">{{ fieldOf(row, nameColumn) }}</span><span v-if="domainOf(row) !== ''" class="note-bm-domain">{{ domainOf(row) }}</span></span></a>
                </TooltipTrigger>
                <TooltipContent>{{ fieldOf(row, nameColumn) }}</TooltipContent>
              </Tooltip>
            </li>
          </ul>
        </section>
      </template>
    </div>

    <!-- 编辑书签的模态框:添加与编辑共用一个框,标题随 isAdding 摆。表单按列类型
         铺开数据表的全部字段 —— 块的名称/链接/图标设置只决定卡片怎么取字段,
         不限制这里能改哪些列。三个按钮用普通 Button —— reka 自带的「点击即关框」
         回调会先清状态,保存逻辑需要自己掌控关框时机(与关标签确认框同一手法)。
         Esc 走 onOpenChange(false)。 -->
    <AlertDialog :open="editingId !== ''" @update:open="(open: boolean) => !open && closeEdit()">
      <AlertDialogContent class="w-[360px] max-w-[calc(100vw-2rem)] rounded-[18px] p-5 shadow-pop ring-0">
        <AlertDialogHeader>
          <AlertDialogTitle>{{ isAdding ? "添加书签" : "编辑书签" }}</AlertDialogTitle>
        </AlertDialogHeader>
        <div class="flex max-h-[55vh] flex-col gap-2.5 overflow-y-auto pt-0.5 pr-0.5">
          <div v-for="column in columns" :key="column.id">
            <span class="block pb-1 text-[11px] text-muted-foreground">{{ column.name }}</span>

            <!-- 图片列:选图 / 预览 / 清除都只改草稿,点「保存」才落盘。 -->
            <div v-if="column.type === 'image'" class="flex items-center">
              <label
                v-if="draftTextOf(column) === ''"
                class="flex cursor-pointer items-center gap-1 rounded border border-line px-2 py-1 text-[12px] text-muted-foreground hover:bg-muted hover:text-foreground"
              >
                <ImagePlusIcon class="size-3.5" />选择图片
                <input type="file" accept="image/*" class="hidden" @change="(event: Event) => pickDraftImage(column, event)">
              </label>
              <div v-else class="group/img relative">
                <img :src="draftTextOf(column)" alt="" class="h-14 w-20 rounded object-cover">
                <button
                  type="button"
                  aria-label="清除图片"
                  class="absolute top-0.5 right-0.5 hidden rounded bg-background/80 p-1 text-muted-foreground hover:text-destructive group-hover/img:block"
                  @click="clearDraftImage(column)"
                >
                  <XIcon class="size-3" />
                </button>
              </div>
            </div>

            <input
              v-else-if="column.type === 'checkbox'"
              type="checkbox"
              class="size-3.5 accent-foreground"
              :checked="draft[column.id] === true"
              :ref="column.id === firstFieldId ? focusOnMount : undefined"
              @change="setDraftChecked(column, $event)"
            >

            <select
              v-else-if="column.type === 'select'"
              :class="FIELD"
              :value="draftTextOf(column)"
              :ref="column.id === firstFieldId ? focusOnMount : undefined"
              @change="setDraftOption(column, $event)"
            >
              <option value="">—</option>
              <option v-for="option in column.options" :key="option.id" :value="option.id">{{ option.name }}</option>
            </select>

            <!-- 文本 / 数字 / 日期:先存原串,保存时统一走 parseCellInput。 -->
            <input
              v-else
              :type="column.type === 'number' ? 'number' : column.type === 'date' ? 'date' : 'text'"
              :class="FIELD"
              :value="draftTextOf(column)"
              :ref="column.id === firstFieldId ? focusOnMount : undefined"
              @input="setDraftText(column, $event)"
              @keydown.enter.prevent="saveOnEnter"
            >
          </div>
        </div>
        <AlertDialogFooter class="mx-0 mb-0 gap-2 rounded-none border-t-0 bg-transparent p-0 pt-3">
          <Button variant="ghost" :class="DIALOG_BTN" @click="closeEdit">取消</Button>
          <Button :class="DIALOG_BTN" @click="saveEdit">保存</Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>

    <!-- 删除确认:删的是盘上数据表里的一行,没有撤销;表被多篇笔记共用时,
         别处也会跟着少一行,得先说清楚。 -->
    <AlertDialog :open="deletingId !== ''" @update:open="(open: boolean) => !open && closeDelete()">
      <AlertDialogContent class="w-[300px] rounded-[18px] p-5 shadow-pop ring-0">
        <AlertDialogHeader>
          <AlertDialogTitle>删除书签</AlertDialogTitle>
          <AlertDialogDescription class="text-[12px]">
            「{{ deletingName === "" ? "未命名书签" : deletingName }}」将从数据表中删除，此操作不可恢复。
            表被多篇笔记共用时，别处也会跟着少一行。
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter class="mx-0 mb-0 gap-2 rounded-none border-t-0 bg-transparent p-0 pt-3">
          <Button variant="ghost" :class="DIALOG_BTN" @click="closeDelete">取消</Button>
          <Button variant="destructive" :class="DIALOG_BTN" @click="confirmDelete">删除</Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  </div>
</template>

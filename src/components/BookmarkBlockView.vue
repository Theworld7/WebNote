<script setup lang="ts">
import type { BookmarkBlock } from "@/types/workspace"
import type { DataColumn, DataRow } from "@/types/data-table"
import type { ComponentPublicInstance } from "vue"
import { computed, nextTick, ref, watch } from "vue"
import { DatabaseIcon, Settings2Icon } from "@lucide/vue"
import { Button } from "@/components/ui/button"
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
import { linkIcon } from "@/lib/inline"
import * as dt from "@/lib/data-table"

/**
 * 书签块:把一张数据表的每一行渲染成一张书签卡片 —— 上图标下名称,与行内链接的
 * 书签卡片形态(`data-link-shape="card"`)同一套标记与样式,视觉由那一处 CSS 负责,
 * 这里只负责喂属性。
 *
 * 数据链路与 `GalleryBlockView` 完全同源,取数与改表走 `useTableEntry` 共用 seam,
 * 这里不再复述。不同的只有展示设置:名称列、链接列、列数,都是**块的属性**,
 * 同一张表在两篇笔记里可以各挑各的字段。
 */
const props = defineProps<{ block: BookmarkBlock }>()

const { openFile, updateBlockSettings } = useWorkspace()

const { state, table, columns, rows } = useTableEntry(() => props.block.path)

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
      ? "repeat(auto-fill, minmax(120px, 1fr))"
      : `repeat(${props.block.columns}, minmax(0, 1fr))`,
}))

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
 * 卡片宽度与字号都是固定的(卡片 96px,见 style.css),所以名称可用宽度不随窗口
 * 变化,截断与否只随文本变 —— 重测挂在分节结果上即可,不用盯着尺寸。
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

/** 菜单外框与下拉框,与画册设置菜单同一套参数。 */
const MENU = "w-48 rounded-island p-1.5 shadow-pop ring-0"
/** 下拉框观感照搬画册设置里的 select,两处菜单放一起看不出差别。 */
const SELECT = "w-full cursor-pointer rounded border border-line bg-transparent px-1.5 py-1 text-[12px] outline-none"

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

  <div v-else class="group/bookmark relative my-4">
    <!-- 块操作入口:右上角,悬停浮现。与画册的入口同一套。 -->
    <div class="absolute -top-2 right-0 z-20 flex items-center gap-1 opacity-0 transition-opacity group-hover/bookmark:opacity-100 focus-within:opacity-100">
      <Button
        variant="ghost"
        size="sm"
        class="h-6 gap-1 rounded-full bg-background px-2 text-[12px] text-muted-foreground hover:text-foreground"
        @click="openFile(props.block.path)"
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

    <!-- 宫格。空表给一句说明,而不是留一片空白。 -->
    <p v-else-if="rows.length === 0" class="py-6 text-center text-[12px] text-muted-foreground">
      这张表还没有行 —— 到数据表里添加后,书签会自动出现。
    </p>

    <!-- 分节宫格:不开分组时只有一节且不画标题,观感与平铺无差别。 -->
    <div v-else class="flex flex-col gap-3">
      <section v-for="sec in sections" :key="sec.key">
        <p v-if="sec.title !== null" class="pb-1 text-[12px] font-medium text-muted-foreground">{{ sec.title }}</p>
        <ul class="m-0 grid list-none gap-3 p-0" :style="gridStyle">
          <li v-for="row in sec.rows" :key="row.id" class="flex justify-center">
            <!-- 只有名称被截断的行才开 tooltip(disabled 绑定测量结果)—— 名称完整时
                 划过每张卡都弹一遍提示是噪音。 -->
            <Tooltip :disabled="!truncatedNames.has(row.id)">
              <TooltipTrigger as-child>
                <!-- 与行内链接的书签卡片同一套标记:data-link-shape + data-icon 驱动同一条 CSS。
                     图标列的值能加载成图片时挂 data-icon-image:伪元素字符退场,由 img 顶替
                     (样式见 style.css 的书签卡片段);加载中或失败不带这个属性,照常显示字符。 -->
                <a
                  :href="fieldOf(row, urlColumn)"
                  target="_blank"
                  rel="noreferrer"
                  data-link-shape="card"
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
                ><span :ref="(el) => setNameEl(row.id, el)" class="note-bookmark-name">{{ fieldOf(row, nameColumn) }}</span></a>
              </TooltipTrigger>
              <TooltipContent>{{ fieldOf(row, nameColumn) }}</TooltipContent>
            </Tooltip>
          </li>
        </ul>
      </section>
    </div>
  </div>
</template>

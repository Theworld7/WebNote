<script setup lang="ts">
import type { GalleryBlock } from "@/types/workspace"
import type { DataColumn, DataRow, DataTable } from "@/types/data-table"
import { computed, onBeforeUnmount, onMounted, ref, shallowRef, watch } from "vue"
import {
  DatabaseIcon,
  LayoutGridIcon,
  Settings2Icon,
} from "@lucide/vue"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
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
const MARKER = "w-5.5 shrink-0 text-center font-mono text-[11.5px] text-muted-foreground"

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
    <!-- 块设置入口:右上角,悬停浮现。 -->
    <div class="absolute -top-2 right-0 z-10 opacity-0 transition-opacity group-hover/gallery:opacity-100 focus-within:opacity-100">
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
          <DropdownMenuItem :class="ITEM" @select="setColumns('auto')">
            <span :class="MARKER">{{ props.block.columns === "auto" ? "✓" : "" }}</span>
            <span>响应式列数</span>
          </DropdownMenuItem>
          <DropdownMenuItem :class="ITEM" @select.prevent>
            <span :class="MARKER">{{ props.block.columns === "auto" ? "" : props.block.columns }}</span>
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
          </DropdownMenuItem>
          <DropdownMenuSeparator class="mx-2 my-1 bg-line" />
          <DropdownMenuLabel class="px-2 pb-1 pt-1.5 text-[11px] font-normal text-muted-foreground">
            图片填充
          </DropdownMenuLabel>
          <DropdownMenuItem v-for="item in FIT_ITEMS" :key="item.value" :class="ITEM" @select="setFit(item.value)">
            <span :class="MARKER">{{ props.block.fit === item.value ? "✓" : "" }}</span>
            <span>{{ item.label }}</span>
          </DropdownMenuItem>
          <DropdownMenuSeparator class="mx-2 my-1 bg-line" />
          <DropdownMenuLabel class="px-2 pb-1 pt-1.5 text-[11px] font-normal text-muted-foreground">
            图片比例
          </DropdownMenuLabel>
          <DropdownMenuItem v-for="item in RATIO_ITEMS" :key="item.value" :class="ITEM" @select="setRatio(item.value)">
            <span :class="MARKER">{{ props.block.ratio === item.value ? "✓" : "" }}</span>
            <span>{{ item.label }}</span>
          </DropdownMenuItem>
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
    <div v-else class="grid gap-3" :style="gridStyle">
      <div
        v-for="row in rows"
        :key="row.id"
        class="overflow-hidden rounded-lg border border-line bg-background"
      >
        <!-- 海报位。高度由比例设置算出(列宽 × 高/宽),没有图的行占同尺寸的空位,宫格节奏不乱。 -->
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

        <!-- 字段区:标签 + 值,点值进编辑。空值也给一行高度,点它就能填。 -->
        <div class="divide-y divide-line/60 px-2.5 py-1">
          <div v-for="column in visibleColumns" :key="column.id" class="flex min-h-6 items-center gap-2 py-0.5">
            <span class="w-16 shrink-0 truncate text-[11px] text-muted-foreground/70">{{ column.name }}</span>

            <input
              v-if="column.type === 'checkbox'"
              type="checkbox"
              class="size-3.5 accent-foreground"
              :checked="dt.cellValue(row, column) === true"
              @change="(event: Event) => toggleCheck(row, column, event)"
            >

            <!-- 点击值 → 内联输入框;失焦 / Enter 提交。编辑态只在当前格生效。 -->
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
              class="w-full min-w-0 truncate rounded px-0.5 text-left text-[12px] hover:bg-muted"
              @click="editing = cellKey(row, column)"
            >
              <span :class="cellOf(row, column) === '' && 'text-muted-foreground/40'">{{ cellOf(row, column) || "空" }}</span>
            </button>
          </div>
        </div>
      </div>
    </div>

    <!-- 浮岛:跳到数据表本身。行与列的增删在表格编辑页做,画册不重复那套入口。 -->
    <div
      class="absolute -bottom-3.5 left-1/2 flex -translate-x-1/2 items-center gap-0.5 rounded-full bg-background p-0.5 opacity-0 shadow-island transition-opacity group-hover/gallery:opacity-100 focus-within:opacity-100"
    >
      <Button
        variant="ghost"
        size="sm"
        class="h-6 gap-1 rounded-full px-2 text-[12px] text-muted-foreground hover:text-foreground"
        @click="openTable"
      >
        <DatabaseIcon class="size-3" />打开数据表
      </Button>
    </div>
  </div>
</template>

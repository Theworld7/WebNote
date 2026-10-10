<script setup lang="ts">
import type { DataTableBlock } from "@/types/workspace"
import type { DataCellValue, DataColumn, DataColumnType, DataRow, DataTable } from "@/types/data-table"
import type { TableEffectClasses } from "@/lib/typography"
import { computed, onBeforeUnmount, onMounted, ref, shallowRef, watch } from "vue"
import { DatabaseIcon, ExternalLinkIcon, PlusIcon } from "@lucide/vue"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { useSettings } from "@/composables/useSettings"
import type { TableEntry } from "@/composables/useTables"
import { useTables } from "@/composables/useTables"
import { useWorkspace } from "@/composables/useWorkspace"
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
 * 3. **读不到是正常状态**，不是错误（见 `CONTEXT.md` 的「Missing Data table」）。
 *    文件可能被移走或改名，用户也许正准备去找回来，所以给提示 + 重指定入口,而不是报错。
 */
const props = defineProps<{ block: DataTableBlock }>()

const { openFile } = useWorkspace()
const tables = useTables()
const { tableEffect } = useSettings()

/** 表格效果对引用块生效（它是笔记里的一张表），数据表**编辑视图**则不受它影响。 */
const frame = computed<TableEffectClasses>(() => tableEffectClasses(tableEffect.value))

/**
 * 当前这张表的条目。
 *
 * **必须是 `shallowRef`**：`ref()` 会深度解包嵌套的 ref，而 `TableEntry` 的三个字段
 * 本身就是 `Ref` —— 用 `ref` 装它，`entry.value.table` 会退化成 `DataTable | null`
 * 而不是 `Ref<DataTable | null>`，于是 `entry.value.table.value` 读到 `undefined`，
 * 视图永远停在「正在读取」。`shallowRef` 只做浅层响应，字段原样是 ref，
 * 而字段内部的更新由字段自己通知（这正是我们要的）。
 */
const entry = shallowRef<TableEntry | null>(null)

/** 这张表被编辑时往哪儿写错误。挂在笔记的 fsError 上，与其它错误同一个出口。 */
const errorSink = ref("")

const state = computed(() => entry.value?.state.value ?? "loading")
const table = computed(() => entry.value?.table.value ?? null)
const columns = computed<readonly DataColumn[]>(() => table.value?.columns ?? [])
const rows = computed<readonly DataRow[]>(() => table.value?.rows ?? [])

onMounted(() => {
  void mount()
})

/**
 * 路径变了要换一张表：引用块可以被「重新指定」到另一个文件。
 * 先释放旧路径的引用，再认领新的。
 */
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

/** 所有编辑动作都走这一条：算出新表 → 注册表写盘。失败会回退并写 `errorSink`。 */
async function change(next: (table: DataTable) => DataTable): Promise<void> {
  await tables.mutate(props.block.path, next, errorSink)
}

function cellOf(row: DataRow, column: DataColumn): string {
  return dt.valueText(dt.cellValue(row, column), column)
}

/** 提示态里显示的那个路径。 */
const pathLabel = computed(() => props.block.path)

/** 打开数据表本身：切到它的标签页。引用块的「深潜」入口。 */
function openTable() {
  if (props.block.path === "") return
  // 走工作区的打开入口 —— 标签、按需读都由它统一管。
  openFile(props.block.path)
}

/** 输入框文本 → 列类型对应的值。
 *
 * `text` 与 `select` 原样收下（`select` 这里暂时存字面量，选项系统是下一轮的事）；
 * 数字解析不出就给 `null` —— **不保留原字符串**，否则一列数字里混进一个 `"abc"`，
 * 排序与求和会静默出错，而错误本身看不见。用户输了非法值就应当看到它被拒绝。
 * 日期只认 `YYYY-MM-DD`，与模型里的存储口径一致。
 */
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
  const parsed = parseCellInput(target.value, column.type)
  if (parsed === dt.cellValue(row, column)) return
  void change((current) => dt.replaceRow(current, dt.setCell(row, column.id, parsed)))
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
] satisfies readonly { type: DataColumnType; label: string }[]

function setColumnType(columnId: string, type: DataColumnType) {
  void change((current) => dt.setColumnType(current, columnId, type))
}

function removeColumn(columnId: string) {
  void change((current) => dt.removeColumn(current, columnId))
}

/** 菜单外框与菜单项，与块手柄的两套菜单同一套参数。 */
const MENU = "w-[176px] rounded-island p-1.5 shadow-pop ring-0"
const ITEM = "gap-2.5 rounded-[7px] px-2 py-1"
const MARKER = "w-5.5 shrink-0 text-center font-mono text-[11.5px] text-muted-foreground"
</script>

<template>
  <!-- 引用的文件读不到：提示态，不是错误态。给「重新指定」的入口（下一轮做，
       现在先给「打开」——文件若还在树下，点开它自己就能确认）。 -->
  <div
    v-if="state === 'missing' || state === 'failed'"
    class="my-4 flex items-center gap-2.5 rounded-lg border border-dashed border-line bg-muted/40 px-3 py-2.5"
  >
    <DatabaseIcon class="size-3.5 shrink-0 text-muted-foreground" />
    <span class="text-[12px] text-muted-foreground">
      引用的数据表不存在：<span class="font-mono">{{ pathLabel }}</span>
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

  <div v-else class="group/ref relative my-4">
    <div :class="frame.container">
      <table :class="frame.table">
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
                    <span class="shrink-0 font-mono text-[10px] font-normal text-muted-foreground/70">
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
            <td v-for="column in columns" :key="column.id" :class="frame.cell">
              <!-- 勾选：一个真正的 checkbox，不走 contenteditable。 -->
              <input
                v-if="column.type === 'checkbox'"
                type="checkbox"
                class="size-3.5 align-middle accent-foreground"
                :checked="dt.cellValue(row, column) === true"
                @change="(event: Event) => toggleCheck(row, column, event)"
              >
              <!-- 其余类型都是文本外观。编辑用 contenteditable 太复杂（要处理富文本、
                   选区、非受控 DOM），这里用最朴素的输入：提交（blur / Enter）时写盘。
                   数据表的单元格本来就是数据，不是正文。 -->
              <input
                v-else
                class="w-full bg-transparent outline-none placeholder:text-muted-foreground/50"
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
      class="absolute -bottom-3.5 left-1/2 flex -translate-x-1/2 items-center gap-0.5 rounded-full bg-background p-0.5 opacity-0 shadow-island transition-opacity group-hover/ref:opacity-100 focus-within:opacity-100"
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

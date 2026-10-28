<script setup lang="ts">
import type { DataCellValue, DataColumn } from "@/types/data-table"
import { computed, nextTick, ref, watch } from "vue"
import { CalendarIcon } from "@lucide/vue"
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import DateCalendar from "@/components/DateCalendar.vue"
import { emptyValueOf, parseCellInput } from "@/lib/data-table"
import { todayKey } from "@/lib/date-key"

/**
 * 账目块的「记一笔」表单 —— 一次把一条流水填完，再一次性落盘。
 *
 * **为什么从行内逐格改成模态框**：行内那条路径要人从行首格一路 Tab 到末尾，中途金额格
 * 显示的是 `+1,234.00`、进编辑态才换回原始数字，日期格一聚焦又弹月历；更麻烦的是编辑期
 * 要钉住排序与分节（否则填日期的那一刻行会飞走，见 `LedgerBlockView` 的 `frozenOrder`）。
 * 那套机制是为「改已有的账」准备的，用来「记一笔新的」就过重了：新行还没有任何字段需要
 * 跟旧顺序对齐。模态框把「录一条记录」当成一次完整输入，退出表单即完成，不必与排序搏斗。
 *
 * **字段按表的列现生成**，与 `PlaylistAddDialog` 同一口径：只认固定几列的表单，表里多
 * 出来的列就永远录不进新记录。控件跟着列类型走，解析一律走 `dt.parseCellInput` —— 与
 * 单元格入口同一个解析器，否则「表单里能填、格子里被拒」这种分叉迟早被撞上。
 *
 * **只靠键盘走完**：Tab / Shift+Tab 换字段（原生焦点顺序，没有自绘的焦点环），回车提交，
 * Esc 取消；输入法合成中的回车不算提交（中文备注里选词的回车在这条路上）。日期格给两条
 * 互不干扰的路：键盘就是打字（`YYYY-MM-DD`），鼠标才用右侧那颗月历钮 —— **不**做成
 * 「一聚焦就弹月历」，那样每 Tab 过一次日期，表单就被一个 272px 的面板顶下去一次。
 *
 * 打开时**只**给第一个日期列预填今天：记一笔说的就是「现在这一笔」，日期通常是唯一不用
 * 动的字段；别的列一律留空，包括第二个日期列（起止日那种表，到期日不该跟着变今天）。
 * 图片列不进表单：它没有「打字」这种录法，一行小字指回数据表。
 */
const props = defineProps<{
  /** 打开中。由账目块给 —— 对话框自己不认识那张表。 */
  open: boolean
  /** 目标表的列，决定表单长什么样。 */
  columns: readonly DataColumn[]
  /** 收入 / 支出列：金额格在表单里右对齐、走等宽数字，跟表里那一列同一副样子。 */
  incomeColumnId: string
  expenseColumnId: string
}>()

const emit = defineEmits<{
  (event: "submit", values: Record<string, DataCellValue>): void
  (event: "close"): void
}>()

/** 表单里的字段。图片列没有录入方式，排除掉（下面留一行说明）。 */
const fields = computed(() => props.columns.filter((column) => column.type !== "image"))
const imageCount = computed(() => props.columns.length - fields.value.length)

/** 文本框里的原始字符串。解析留到提交那一刻，好把「输错了」原样指回是哪一格。 */
const draft = ref<Record<string, string>>({})
/** 打开时的初值快照 —— 「有没有填过」拿它做差：预填的今天不该算填过。 */
const initial = ref<Record<string, string>>({})
/** 勾选列的真实值（其余列都在 `draft` 的字符串里）。 */
const checks = ref<Record<string, boolean>>({})
/** 列 id → 提交时才发现的问题。 */
const errors = ref<Record<string, string>>({})
/** 展开着月历的那一列（列 id），空串 = 都收着。 */
const calendarOf = ref("")

const formEl = ref<HTMLElement | null>(null)

function seed(): void {
  const text: Record<string, string> = {}
  const bool: Record<string, boolean> = {}
  let dated = false
  for (const column of props.columns) {
    bool[column.id] = false
    if (column.type === "date" && !dated) {
      text[column.id] = todayKey()
      dated = true
      continue
    }
    text[column.id] = ""
  }
  draft.value = { ...text }
  initial.value = { ...text }
  checks.value = bool
  errors.value = {}
  calendarOf.value = ""
}

watch(
  () => props.open,
  (open) => {
    if (open) seed()
  },
  { immediate: true },
)

/**
 * 填过没有。跟初值做差而不是逐格判空：日期列预填了今天，逐格判空会让「一个字段都没动」
 * 的表单看起来已经填过，回车就往表里塞一条只有日期的空记录。
 */
const touched = computed(() =>
  fields.value.some((column) =>
    column.type === "checkbox"
      ? checks.value[column.id] === true
      : (draft.value[column.id] ?? "") !== (initial.value[column.id] ?? ""),
  ),
)

function isMoney(column: DataColumn): boolean {
  return column.id === props.incomeColumnId || column.id === props.expenseColumnId
}

function controlOf(column: DataColumn): HTMLElement | null {
  return formEl.value?.querySelector(`[data-field="${column.id}"]`) ?? null
}

function focusField(column: DataColumn): void {
  const control = controlOf(column)
  if (control instanceof HTMLInputElement || control instanceof HTMLSelectElement) control.focus()
}

/** 对话框把焦点交给我们之后（`open-auto-focus` 已 prevent）：落在第一个字段上。 */
async function focusFirstField(): Promise<void> {
  await nextTick()
  const first = fields.value[0]
  if (first !== undefined) focusField(first)
}

function onText(column: DataColumn, event: Event): void {
  const target = event.target
  if (!(target instanceof HTMLInputElement)) return
  draft.value = { ...draft.value, [column.id]: target.value }
  if (errors.value[column.id] !== undefined) errors.value = { ...errors.value, [column.id]: "" }
}

function onSelect(column: DataColumn, event: Event): void {
  const target = event.target
  if (!(target instanceof HTMLSelectElement)) return
  draft.value = { ...draft.value, [column.id]: target.value }
}

function onToggle(column: DataColumn, event: Event): void {
  const target = event.target
  if (!(target instanceof HTMLInputElement)) return
  checks.value = { ...checks.value, [column.id]: target.checked }
}

function toggleCalendar(column: DataColumn): void {
  calendarOf.value = calendarOf.value === column.id ? "" : column.id
}

/** 点中一天（或「清除」）。写进草稿就收起 —— 表单里的月历是录入的辅助，不是一块常驻区域。 */
function pickDate(column: DataColumn, value: string): void {
  draft.value = { ...draft.value, [column.id]: value }
  calendarOf.value = ""
  focusField(column)
}

/**
 * 提交。校验只做两件与类型有关的事（数字 / 日期），失败时**不关闭**、把错指回那一格。
 *
 * 数量上先拦「一处都没填」：一条什么都没有的记录进表只会让人以为记漏了。
 */
function submit(): void {
  if (!touched.value) return

  const values: Record<string, DataCellValue> = {}
  const next: Record<string, string> = {}
  for (const column of props.columns) {
    if (column.type === "image") {
      values[column.id] = emptyValueOf(column.type)
      continue
    }
    if (column.type === "checkbox") {
      values[column.id] = checks.value[column.id] === true
      continue
    }
    const raw = (draft.value[column.id] ?? "").trim()
    if (column.type === "number" && raw !== "" && parseCellInput(raw, "number") === null) {
      next[column.id] = "只收数字，别加千分位"
      continue
    }
    if (column.type === "date" && raw !== "" && parseCellInput(raw, "date") === null) {
      next[column.id] = "写成 2026-10-28 这样"
      continue
    }
    values[column.id] = parseCellInput(raw, column.type)
  }

  errors.value = next
  const firstError = props.columns.find((column) => next[column.id] !== undefined)
  if (firstError !== undefined) {
    focusField(firstError)
    return
  }
  emit("submit", values)
}

/**
 * 表单里的键盘。回车 = 提交（这一格填完就是这条记完，提交后对话框关掉、行落在表里），
 * Esc = 取消；焦点在按钮上时回车归按钮自己（那颗月历钮要靠它展开）。
 */
function onKeydown(event: KeyboardEvent): void {
  if (event.key === "Escape") {
    event.preventDefault()
    emit("close")
    return
  }
  if (event.key !== "Enter" || event.isComposing) return
  const target = event.target
  if (target instanceof HTMLElement && target.closest("button") !== null) return
  event.preventDefault()
  submit()
}
</script>

<template>
  <Dialog :open="props.open" @update:open="(next: boolean) => { if (!next) emit('close') }">
    <!-- 点遮罩**不关**：这是表单，填了一半被一次误点清空比「点外面没反应」更糟。关窗的
         路只有两条 —— Esc 或底部的「取消」（与项目里其它用 alert-dialog 的表单同一习惯）。 -->
    <DialogContent
      class="max-w-md"
      @open-auto-focus.prevent="focusFirstField"
      @pointer-down-outside.prevent="() => {}"
      @interact-outside.prevent="() => {}"
      @keydown="onKeydown"
    >
      <div class="grid gap-1.5">
        <DialogTitle class="text-[14px]">记一笔</DialogTitle>
        <DialogDescription class="text-[12px]">
          字段跟这张表的列走 —— 只填想填的，其余留空。Tab 换格、回车记账、Esc 取消。
        </DialogDescription>
      </div>

      <div ref="formEl" class="max-h-[52vh] space-y-2.5 overflow-y-auto px-0.5 pr-1">
        <div v-for="column in fields" :key="column.id">
          <label :for="`ledger-entry-${column.id}`" class="mb-1 block text-[11px] text-muted-foreground">
            {{ column.name }}
          </label>

          <label
            v-if="column.type === 'checkbox'"
            class="flex cursor-pointer items-center gap-2 text-[13px]"
          >
            <input
              :id="`ledger-entry-${column.id}`"
              :data-field="column.id"
              type="checkbox"
              class="size-3.5 accent-brand"
              :checked="checks[column.id] === true"
              @change="onToggle(column, $event)"
            >
            <span class="text-muted-foreground">勾选</span>
          </label>

          <select
            v-else-if="column.type === 'select'"
            :id="`ledger-entry-${column.id}`"
            :data-field="column.id"
            class="h-8 w-full cursor-pointer rounded-lg border border-input bg-transparent px-2 text-[13px] outline-none focus-visible:border-ring"
            :value="draft[column.id] ?? ''"
            @change="onSelect(column, $event)"
          >
            <option value="">（空）</option>
            <option v-for="option in column.options" :key="option.id" :value="option.id">{{ option.name }}</option>
          </select>

          <!--
            日期格：文本框 + 右侧月历钮。输入框不用 `type="date"` —— 原生控件的样式与字体
            随平台走（Windows 上是系统日历），和这套界面放一起像贴纸（`DateCalendar` 那段
            注释里已有同样的判断）。键盘路径就是打字，月历是鼠标用的。
          -->
          <div v-else-if="column.type === 'date'" class="relative">
            <Input
              :id="`ledger-entry-${column.id}`"
              :data-field="column.id"
              class="h-8 pr-8 text-[13px] tabular-nums"
              placeholder="YYYY-MM-DD"
              :aria-invalid="errors[column.id] !== undefined && errors[column.id] !== ''"
              :model-value="draft[column.id] ?? ''"
              @input="onText(column, $event)"
            />
            <button
              type="button"
              class="absolute inset-y-0 right-1 my-auto flex size-6 items-center justify-center rounded text-muted-foreground hover:bg-muted hover:text-foreground"
              :aria-label="`选择${column.name}`"
              :aria-expanded="calendarOf === column.id"
              data-calendar-toggle
              @click="toggleCalendar(column)"
            >
              <CalendarIcon class="size-3.5" />
            </button>
          </div>

          <Input
            v-else
            :id="`ledger-entry-${column.id}`"
            :data-field="column.id"
            class="h-8 text-[13px]"
            :class="isMoney(column) && 'text-right tabular-nums'"
            :inputmode="column.type === 'number' ? 'decimal' : undefined"
            :placeholder="isMoney(column) ? '0.00' : ''"
            :aria-invalid="errors[column.id] !== undefined && errors[column.id] !== ''"
            :model-value="draft[column.id] ?? ''"
            @input="onText(column, $event)"
          />

          <div
            v-if="column.type === 'date' && calendarOf === column.id"
            class="mt-1.5 flex justify-center rounded-lg border border-line bg-popover p-0.5"
            @keydown.enter.stop
          >
            <DateCalendar
              :value="draft[column.id] ?? ''"
              focus=""
              @pick="pickDate(column, $event)"
              @clear="pickDate(column, '')"
            />
          </div>

          <p v-if="errors[column.id] !== undefined && errors[column.id] !== ''" class="mt-1 text-[11px] text-destructive">
            {{ errors[column.id] }}
          </p>
        </div>
      </div>

      <p v-if="imageCount > 0" class="text-[11px] text-muted-foreground">
        图片列不在这里填 —— 记完去表里点那一格。
      </p>

      <!-- 页脚与 alert-dialog 同一副样子：浅底 + 一条分隔线，按钮靠右。 -->
      <div class="-mx-4 -mb-4 flex justify-end gap-2 rounded-b-xl border-t border-line bg-muted/50 p-3">
        <Button variant="ghost" size="sm" class="text-[13px]" @click="emit('close')">取消</Button>
        <Button size="sm" class="text-[13px]" :disabled="!touched" @click="submit">记下</Button>
      </div>
    </DialogContent>
  </Dialog>
</template>

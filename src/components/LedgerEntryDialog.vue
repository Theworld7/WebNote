<script setup lang="ts">
import type { DataCellValue, DataColumn } from "@/types/data-table"
import { computed, nextTick, ref, watch } from "vue"
import { CalendarIcon, CheckIcon, ChevronDownIcon } from "@lucide/vue"
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import DateCalendar from "@/components/DateCalendar.vue"
import { emptyValueOf, parseCellInput } from "@/lib/data-table"
import {
  parseDateKey,
  shiftDays,
  shiftMonths,
  todayKey,
  weekEnd,
  weekStart,
} from "@/lib/date-key"

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
 * Esc 取消；输入法合成中的回车不算提交（中文备注里选词的回车在这条路上）。
 *
 * **日期与选项：Tab 一落到字段上，面板就展开**（`panelOf`）—— 这是与 `OptionCell`
 * 同一套判断：原生 `<select>` 的模型是「Tab 只是选中它，再按一次回车或空格才展开」，
 * 展开后方向键 / Esc / Tab 全交给系统控件，页面无处插手；日期这块原先要人先点右侧那颗
 * 月历钮，纯键盘根本够不着。两道口头规矩换成一个动作：**Tab 进来就有面板，方向键移高亮，
 * 回车确认**。打开对话框时那一次自动聚焦不算「进来」，不展开（见 `skipFocusOpen`）。
 * 面板全部内联在字段下方（不是浮层）—— 对话框里再挂一个 `fixed` 浮层，要和 reka 的
 * 焦点陷阱、遮罩的 `interact-outside`、表单一滚动就脱落这三件事同时商量，而月历本来就
 * 是内联的；两者同一副外壳，观感也不分裂。
 *
 * 焦点**从不进面板**：面板里所有可点元素都不在 Tab 序列里（`tabindex="-1"` / `div`），
 * 所以一次 Tab 直接落到下一个字段，面板随失焦收起。键盘高亮是 `panelFocus`，靠它
 * 「还没确认」的那一格能被看见 —— 手敲日期时两者会分叉，所以回车得看 `panelBase`。
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
/**
 * 展开着面板的字段（列 id），空串 = 都收着。日期与选项**共用一份**：同一时刻只有一个
 * 面板，规则也就只有一条 —— Tab 落到哪个字段，哪个字段的面板展开。
 */
const panelOf = ref("")
/** 面板里的键盘高亮。日期面板是 `YYYY-MM-DD`，选项面板是选项 id（空串 = 「（空）」那项）。 */
const panelFocus = ref("")
/**
 * 展开那一刻输入框里的字。用户手敲过日期之后，回车该提交他敲的字，而不是高亮那一天 ——
 * 两者的分叉只有在「面板开着 + 值变了」时出现，拿它做差比记一个 `moved` 标志更直接。
 */
const panelBase = ref("")
/**
 * 打开对话框时那一次自动聚焦不展开面板。
 *
 * 「Tab 进来就有面板」是给**切换字段**准备的；一进门焦点就被塞进日期字段，那不是切换，
 * 却会让表单第一眼就是一块 250px 高的月历 —— 想直接填金额的人得先滚过去。反差是：
 * 打开时紧凑，手一动（Tab / ↓ / 点击）面板立刻出现。
 */
let skipFocusOpen = false

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
  panelOf.value = ""
  panelFocus.value = ""
  panelBase.value = ""
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

/** 提交校验失败时把焦点指回出错那一格。选项字段的「控件」是一颗按钮，所以两种都要认。 */
function focusField(column: DataColumn): void {
  const control = controlOf(column)
  if (control instanceof HTMLInputElement || control instanceof HTMLButtonElement) control.focus()
}

/** 对话框把焦点交给我们之后（`open-auto-focus` 已 prevent）：落在第一个字段上，不展开面板。 */
async function focusFirstField(): Promise<void> {
  await nextTick()
  const first = fields.value[0]
  if (first === undefined) return
  // `focus()` 同步派发 focusin，所以这行之后标志已经用掉了；再置一次是兜底 ——
  // 万一那一格不可聚焦（没派发事件），也别让标志挂到下一次 Tab 上。
  skipFocusOpen = true
  focusField(first)
  skipFocusOpen = false
}

function onText(column: DataColumn, event: Event): void {
  const target = event.target
  if (!(target instanceof HTMLInputElement)) return
  draft.value = { ...draft.value, [column.id]: target.value }
  if (errors.value[column.id] !== undefined) errors.value = { ...errors.value, [column.id]: "" }
  // 手敲到一个能认的日期时，高亮跟着走 —— 否则面板停在上一个日子上，眼睛得在两个
  // 「哪天」之间做选择。半截的输入（`2026-10-`）不认，高亮原地不动。
  if (column.type === "date" && panelOf.value === column.id && parseDateKey(target.value) !== null) {
    panelFocus.value = target.value
    scrollPanelActive()
  }
}

function onToggle(column: DataColumn, event: Event): void {
  const target = event.target
  if (!(target instanceof HTMLInputElement)) return
  checks.value = { ...checks.value, [column.id]: target.checked }
}

/** 选项面板的条目：空值**占一项** —— 清空是一个真实的选择，不该藏在面板外面。 */
function optionItems(column: DataColumn): { id: string; label: string }[] {
  return [
    { id: "", label: "（空）" },
    ...column.options.map((option) => ({ id: option.id, label: option.name })),
  ]
}

/** 选项字段在收起态显示的文案。值指向已删选项时退回空 —— 与 `valueText` 同一口径。 */
function optionLabel(column: DataColumn): string {
  const current = draft.value[column.id] ?? ""
  if (current === "") return ""
  return column.options.find((option) => option.id === current)?.name ?? ""
}

/**
 * 展开某个字段的面板。**幂等** —— `focus` 与点击两条入口都会走到这里，重复调用不该关掉它。
 *
 * 高亮起点：日期落在格里的值上（空格子落在今天，方向键立刻有落点），选项落在当前值上。
 * 面板贴着字段下方展开，字段本身可能已经在表单可视区底部，所以展开后要把它滚进来。
 */
function openPanel(column: DataColumn): void {
  if (skipFocusOpen) {
    skipFocusOpen = false
    return
  }
  if (panelOf.value === column.id) return
  if (column.type === "date") {
    const value = draft.value[column.id] ?? ""
    panelBase.value = value
    panelFocus.value = parseDateKey(value) === null ? todayKey() : value
  } else if (column.type === "select") {
    panelFocus.value = draft.value[column.id] ?? ""
  } else {
    return
  }
  panelOf.value = column.id
  scrollPanel()
}

function closePanel(): void {
  panelOf.value = ""
  panelFocus.value = ""
  panelBase.value = ""
}

function toggleCalendar(column: DataColumn): void {
  if (panelOf.value === column.id) closePanel()
  else openPanel(column)
}

/**
 * 选项字段的点击。`mousedown.prevent` 挡住了「点一下就聚焦」，所以这里补上聚焦 ——
 * 聚焦是展开的另一条入口（Tab 走的同一条），补完面板自己会开。已经展开时再点一次才是收起。
 */
function onOptionClick(column: DataColumn): void {
  const control = controlOf(column)
  if (control !== null && control.ownerDocument.activeElement !== control) {
    control.focus()
    return
  }
  if (panelOf.value === column.id) closePanel()
  else openPanel(column)
}

/** 选中一项：写进草稿就收起。焦点没离开过，不用搬回来。 */
function pickOption(column: DataColumn, value: string): void {
  draft.value = { ...draft.value, [column.id]: value }
  closePanel()
  focusField(column)
}

/**
 * 点中一天（或「清除」）。写进草稿就收起 —— 表单里的月历是录入的辅助，不是一块常驻区域。
 * 「清除」写空串，于是日期字段可以真的留空（预填的今天不是锁死的）。
 */
function pickDate(column: DataColumn, value: string): void {
  draft.value = { ...draft.value, [column.id]: value }
  closePanel()
  focusField(column)
}

/** 展开面板时把它滚进视野。`nearest` —— 本来就看得见就不动，免得每 Tab 一次表单跳一下。 */
function scrollPanel(): void {
  void nextTick(() => {
    formEl.value?.querySelector("[data-entry-panel]")?.scrollIntoView({ block: "nearest" })
    scrollPanelActive()
  })
}

/** 高亮在面板里挪出可视区时（选项多到要滚）把它带回来。 */
function scrollPanelActive(): void {
  void nextTick(() => {
    formEl.value
      ?.querySelector("[data-panel-active='true']")
      ?.scrollIntoView({ block: "nearest" })
  })
}

/**
 * 日期面板的按键，挂在输入框上。焦点一直在输入框里，所以这条链是完整的：
 * 方向键移高亮 → 回车确认 → Esc 收起 → Tab 才走。
 *
 * 方向键在这儿不挪光标 —— 不 `preventDefault` 的话两种「移动」会同时发生。
 */
function onDateKeydown(column: DataColumn, event: KeyboardEvent): void {
  if (panelOf.value !== column.id) {
    // 面板收着时（Esc 之后）方向键负责把它叫回来 —— 收了面板不该只剩下鼠标一条路。
    // 左右键不在列：那两下在输入框里是挪光标，抢走比面板缺席更烦人。
    if (["ArrowDown", "ArrowUp", "PageDown", "PageUp"].includes(event.key)) {
      event.preventDefault()
      openPanel(column)
    }
    return
  }

  if (event.key === "Escape") {
    // 只收面板。不 stopPropagation 的话，外层会把它当成「关掉整个对话框」。
    event.preventDefault()
    event.stopPropagation()
    closePanel()
    return
  }

  const next = stepDay(panelFocus.value, event.key)
  if (next !== null) {
    event.preventDefault()
    panelFocus.value = next
    scrollPanelActive()
    return
  }

  if (event.key !== "Enter" || event.isComposing) return
  // 手敲过日期了 —— 回车归提交，别把输入框里的字换成高亮那天。
  if ((draft.value[column.id] ?? "") !== panelBase.value) return
  event.preventDefault()
  event.stopPropagation()
  pickDate(column, panelFocus.value)
}

/** 方向键在月历上挪一格 / 一周 / 一月，与 `useDateCellPanel` 同一套换算（越界自己跨月跨年）。 */
function stepDay(focus: string, key: string): string | null {
  switch (key) {
    case "ArrowLeft":
      return shiftDays(focus, -1)
    case "ArrowRight":
      return shiftDays(focus, 1)
    case "ArrowUp":
      return shiftDays(focus, -7)
    case "ArrowDown":
      return shiftDays(focus, 7)
    case "PageUp":
      return shiftMonths(focus, -1)
    case "PageDown":
      return shiftMonths(focus, 1)
    case "Home":
      return weekStart(focus)
    case "End":
      return weekEnd(focus)
    default:
      return null
  }
}

/** 选项面板的按键，挂在触发按钮上。到顶 / 到底就停住，不绕回 —— 绕回让「已经到底了」没手感。 */
function onOptionKeydown(column: DataColumn, event: KeyboardEvent): void {
  if (panelOf.value !== column.id) {
    // 与 `OptionCell` 同一条：面板收着时，回车 / 空格 / 方向键都把它叫回来。
    if (event.key === "Enter" || event.key === " " || event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault()
      openPanel(column)
      if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        moveOption(column, event.key === "ArrowDown" ? 1 : -1)
      }
    }
    return
  }

  if (event.key === "Escape") {
    event.preventDefault()
    event.stopPropagation()
    closePanel()
    return
  }

  if (event.key === "Enter" || event.key === " ") {
    event.preventDefault()
    pickOption(column, panelFocus.value)
    return
  }

  if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return
  event.preventDefault()
  moveOption(column, event.key === "ArrowDown" ? 1 : -1)
}

function moveOption(column: DataColumn, step: number): void {
  const items = optionItems(column)
  const index = items.findIndex((item) => item.id === panelFocus.value)
  const next = Math.min(items.length - 1, Math.max(0, (index === -1 ? 0 : index) + step))
  panelFocus.value = items[next].id
  scrollPanelActive()
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
 * Esc = 取消；焦点在按钮上时回车归按钮自己（选项字段靠它确认），面板里的按键已经在
 * 字段那一层处理掉并 `stopPropagation` 了 —— 开头那道 `defaultPrevented` 是双保险。
 */
function onKeydown(event: KeyboardEvent): void {
  if (event.defaultPrevented) return
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
    <!-- `flex` 覆盖掉 content 自带的 `grid`：表单区要能吃掉「对话框到达视口上限之后的
         剩余高度」，滚动条长在字段区里，而不是让整个对话框顶出屏幕。 -->
    <DialogContent
      class="flex max-h-[85vh] max-w-md flex-col"
      @open-auto-focus.prevent="focusFirstField"
      @pointer-down-outside.prevent="() => {}"
      @interact-outside.prevent="() => {}"
      @keydown="onKeydown"
    >
      <div class="grid flex-none gap-1.5">
        <DialogTitle class="text-[14px]">记一笔</DialogTitle>
        <DialogDescription class="text-[12px]">
          字段跟这张表的列走 —— 只填想填的，其余留空。Tab 换格、回车记账、Esc 取消。
        </DialogDescription>
      </div>

      <!-- `min-h-0` 是给 flex 子项用的：不写它，内容会把这一块撑开、`flex-1` 也就滚不起来。 -->
      <div ref="formEl" class="min-h-0 flex-1 space-y-2.5 overflow-y-auto px-0.5 pr-1">
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

          <!--
            选项字段：一颗按钮 + 字段下方内联展开的列表。**不用原生 `<select>`** ——
            它的键盘模型是「Tab 只是选中它，还得再按一次回车或空格才展开」，展不展开、
            Esc 归谁全由系统控件说了算，页面无处插手。这里要的是「Tab 进来就有面板」，
            与 `OptionCell` 同一套判断；区别是那边的浮层要 `Teleport` 到 body，对话框里
            会和焦点陷阱、遮罩的 `interact-outside` 互相掰扯，所以改成字段下方内联展开。
          -->
          <div v-else-if="column.type === 'select'">
            <button
              :id="`ledger-entry-${column.id}`"
              :data-field="column.id"
              type="button"
              class="flex h-8 w-full cursor-pointer items-center rounded-lg border border-input bg-transparent px-2 text-left text-[13px] outline-none focus-visible:border-ring"
              aria-haspopup="listbox"
              :aria-expanded="panelOf === column.id"
              @mousedown.prevent
              @focus="openPanel(column)"
              @blur="closePanel"
              @click="onOptionClick(column)"
              @keydown="onOptionKeydown(column, $event)"
            >
              <span
                class="truncate"
                :class="optionLabel(column) === '' && 'text-muted-foreground'"
              >{{ optionLabel(column) === '' ? "（空）" : optionLabel(column) }}</span>
              <ChevronDownIcon class="ml-auto size-3.5 shrink-0 opacity-50" />
            </button>

            <!-- 宽度贴合最长的那一项（`min-w` 兜住「有 / 无」这种两个字的选择），
                 与月历面板同一条规矩：面板是附着在字段上的一小块，不跟着表单撑满。 -->
            <div
              v-if="panelOf === column.id"
              class="mt-1.5 w-fit max-w-full overflow-hidden rounded-lg border border-line bg-popover"
              data-entry-panel
              @mousedown.prevent
            >
              <div role="listbox" class="max-h-[168px] min-w-[140px] overflow-y-auto p-0.5">
                <div
                  v-for="item in optionItems(column)"
                  :key="item.id"
                  role="option"
                  :aria-selected="item.id === panelFocus"
                  :data-panel-active="item.id === panelFocus"
                  class="flex cursor-pointer items-center gap-1.5 whitespace-nowrap rounded-[6px] px-1.5 py-[5px] text-[12px]"
                  :class="[
                    item.id === panelFocus ? 'bg-selection' : 'hover:bg-muted/60',
                    item.id === '' && 'text-muted-foreground',
                  ]"
                  @mouseenter="panelFocus = item.id"
                  @click="pickOption(column, item.id)"
                >
                  <span>{{ item.label }}</span>
                  <CheckIcon v-if="item.id === panelFocus" class="ml-4 size-3 shrink-0 opacity-70" />
                </div>
                <div
                  v-if="column.options.length === 0"
                  class="px-1.5 py-1 text-[11px] whitespace-nowrap text-muted-foreground"
                >
                  这一列还没有选项 —— 去数据表里加。
                </div>
              </div>
            </div>
          </div>

          <!--
            日期字段：文本框 + 右侧月历钮。输入框不用 `type="date"` —— 原生控件的样式与字体
            随平台走（Windows 上是系统日历），和这套界面放一起像贴纸（`DateCalendar` 那段
            注释里已有同样的判断）。**聚焦就展开月历**，键盘路径是「方向键移高亮、回车确认」；
            想手敲 `YYYY-MM-DD` 也行，敲过的字优先于高亮（见 `onDateKeydown`）。
          -->
          <div
            v-else-if="column.type === 'date'"
            class="relative"
            @focusin="openPanel(column)"
            @focusout="closePanel"
          >
            <Input
              :id="`ledger-entry-${column.id}`"
              :data-field="column.id"
              class="h-8 pr-8 text-[13px] tabular-nums"
              placeholder="YYYY-MM-DD"
              :aria-invalid="errors[column.id] !== undefined && errors[column.id] !== ''"
              :model-value="draft[column.id] ?? ''"
              @input="onText(column, $event)"
              @keydown="onDateKeydown(column, $event)"
            />
            <button
              type="button"
              tabindex="-1"
              class="absolute inset-y-0 right-1 my-auto flex size-6 items-center justify-center rounded text-muted-foreground hover:bg-muted hover:text-foreground"
              :aria-label="`选择${column.name}`"
              :aria-expanded="panelOf === column.id"
              data-calendar-toggle
              @mousedown.prevent
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

          <!-- 宽度贴合月历自己的 216px（`w-fit`），不跟着表单撑满 —— 否则 405px 的框里
               只有中间一小块有用。靠左对齐，读起来就像一个下拉列表。
               `mousedown.prevent` 是命门：点日期时输入框不失焦，否则 `focusout` 先把面板
               收掉、`click` 再回来，中间闪一下；焦点不动也让 `pickDate` 之后的回焦成为空操作。 -->
          <div
            v-if="column.type === 'date' && panelOf === column.id"
            class="mt-1.5 w-fit rounded-lg border border-line bg-popover p-0.5"
            data-entry-panel
            @mousedown.prevent
          >
            <DateCalendar
              :value="draft[column.id] ?? ''"
              :focus="panelFocus"
              @pick="pickDate(column, $event)"
              @clear="pickDate(column, '')"
            />
          </div>

          <p v-if="errors[column.id] !== undefined && errors[column.id] !== ''" class="mt-1 text-[11px] text-destructive">
            {{ errors[column.id] }}
          </p>
        </div>
      </div>

      <p v-if="imageCount > 0" class="flex-none text-[11px] text-muted-foreground">
        图片列不在这里填 —— 记完去表里点那一格。
      </p>

      <!-- 页脚与 alert-dialog 同一副样子：浅底 + 一条分隔线，按钮靠右。 -->
      <div class="-mx-4 -mb-4 flex flex-none justify-end gap-2 rounded-b-xl border-t border-line bg-muted/50 p-3">
        <Button variant="ghost" size="sm" class="text-[13px]" @click="emit('close')">取消</Button>
        <Button size="sm" class="text-[13px]" :disabled="!touched" @click="submit">记下</Button>
      </div>
    </DialogContent>
  </Dialog>
</template>

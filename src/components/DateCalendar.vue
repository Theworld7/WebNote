<script setup lang="ts">
import { computed, ref, watch } from "vue"
import { ChevronLeftIcon, ChevronRightIcon } from "@lucide/vue"

/**
 * 月历面板 —— 给日期格当「下拉选日期」用，本身不管定位与开合（外面套 Popover）。
 *
 * 为什么不拉 `@internationalized/date` 或原生 `<input type="date">`：
 * 原生控件的样式与字体随平台走（Windows 上是系统日历），和这套界面放一起像贴纸；
 * 项目只为这一个面板装一个日期库也不划算。四周的算术只有三件：这个月有几天、
 * 一号是周几、跨月的格往哪补 —— 都在这里，二十行。
 *
 * 网格固定 42 格（6 行）：月份切换时高度不跳，Popover 不会跟着上下弹一下。
 * 周一起头，跟国内日历的习惯一致。
 *
 * `value` 是上层的 `YYYY-MM-DD`（与表的 date 口径同一个字符串），本组件不改它 ——
 * 点哪天就 `pick` 出去，由调用方决定提交。
 */
const props = defineProps<{ value: string }>()
const emit = defineEmits<{ pick: [value: string]; clear: [] }>()

const WEEKDAYS = ["一", "二", "三", "四", "五", "六", "日"]

function pad(value: number): string {
  return String(value).padStart(2, "0")
}

function keyOf(date: Date): string {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

/** 严格按 `YYYY-MM-DD` 读 —— 与 `dt.parseCellInput` 的 date 口径一致，别的形状当没有。 */
function parse(value: string): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value)
  if (match === null) return null
  const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]))
  if (Number.isNaN(date.getTime())) return null
  // 2 月 31 日这种会被 Date 顺延成 3 月，回读一次确认不是编出来的日期。
  return keyOf(date) === value ? date : null
}

const TODAY = keyOf(new Date())

const view = ref({ year: new Date().getFullYear(), month: new Date().getMonth() })

// 值一变(点选 / 上一格换过来)就把视图翻到它那一月;值不合法就留在原地。
watch(
  () => props.value,
  (next) => {
    const date = parse(next)
    if (date === null) return
    view.value = { year: date.getFullYear(), month: date.getMonth() }
  },
  { immediate: true },
)

const monthLabel = computed(() => `${view.value.year} 年 ${view.value.month + 1} 月`)

const cells = computed(() => {
  const first = new Date(view.value.year, view.value.month, 1)
  // getDay() 周日是 0;换算成「周一 = 0」的列号。
  const offset = (first.getDay() + 6) % 7
  const start = new Date(view.value.year, view.value.month, 1 - offset)
  return Array.from({ length: 42 }, (_, index) => {
    const date = new Date(start.getFullYear(), start.getMonth(), start.getDate() + index)
    return { key: keyOf(date), day: date.getDate(), inMonth: date.getMonth() === view.value.month }
  })
})

function shift(delta: number): void {
  const date = new Date(view.value.year, view.value.month + delta, 1)
  view.value = { year: date.getFullYear(), month: date.getMonth() }
}

const NAV = "flex size-5 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
const FOOT = "rounded px-1.5 py-0.5 text-[12px] text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
</script>

<template>
  <!-- `mousedown.prevent` 由外层浮层统一处理：点面板不把焦点从输入框抢走，
       否则输入框一失焦就提交并退出编辑态，面板跟着消失，日期根本点不到。 -->
  <div class="w-[216px] select-none p-2" data-date-calendar>
    <div class="mb-1 flex items-center justify-between">
      <button type="button" :class="NAV" aria-label="上个月" @click="shift(-1)">
        <ChevronLeftIcon class="size-3.5" />
      </button>
      <span class="text-[12px] font-medium">{{ monthLabel }}</span>
      <button type="button" :class="NAV" aria-label="下个月" @click="shift(1)">
        <ChevronRightIcon class="size-3.5" />
      </button>
    </div>

    <div class="grid grid-cols-7 gap-0.5">
      <span v-for="weekday in WEEKDAYS" :key="weekday" class="py-0.5 text-center text-[11px] text-muted-foreground">
        {{ weekday }}
      </span>
      <button
        v-for="cell in cells"
        :key="cell.key"
        :data-day="cell.key"
        type="button"
        class="h-6 rounded text-[12px] tabular-nums transition-colors"
        :class="[
          cell.key === value
            ? 'bg-brand font-medium text-background'
            : cell.inMonth
              ? 'text-foreground hover:bg-muted-strong'
              : 'text-muted-foreground/50 hover:bg-muted',
          cell.key === TODAY && cell.key !== value ? 'ring-1 ring-inset ring-brand/45' : '',
        ]"
        @click="emit('pick', cell.key)"
      >
        {{ cell.day }}
      </button>
    </div>

    <div class="mt-1.5 flex items-center justify-between border-t border-line pt-1.5">
      <button type="button" :class="FOOT" @click="emit('pick', TODAY)">今天</button>
      <button type="button" :class="FOOT" @click="emit('clear')">清除</button>
    </div>
  </div>
</template>

<script setup lang="ts">
import type { DataCellValue, DataColumn, DataRow } from "@/types/data-table"
import type { WorktimeBlock } from "@/types/workspace"
import type { WorktimeReport } from "@/lib/worktime"
import { computed, nextTick, ref, watch } from "vue"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import * as dt from "@/lib/data-table"
import {
  formatQuantity,
  WORKTIME_ROLES,
  WORKTIME_UNIT_LABELS,
  worktimePolicy,
  worktimeReport,
  worktimeRoles,
} from "@/lib/worktime"

/**
 * 「记一笔」表单。
 *
 * 早先的做法是往表尾加一行空行、光标落进第一格 —— 用户得自己找日期格、自己在数字格里
 * 敲负号。负号敲错就是把一笔使用记成了额度,余额静默偏一边;跨池扣减更是只能等提交后
 * 看余额格才知道扣的是谁。表单把这两件事提到**录入时**:
 *
 * - 「用掉 / 得到」是按钮,不是负号。符号由块决定,不由用户手输。
 * - 底部给出这一笔**会怎么摊**:扣自哪几个池、各扣多少、之后剩多少。算法与余额卡同一份
 *   (`worktimeReport`),所以预览与提交后的结果不可能不一致。
 *
 * 表单只写**值**,不碰表 —— 加行与落格由调用方经 `change` 走同一条写入路径,块外的
 * 编辑(数据表页、别处的引用)照旧看见同一次变更。
 */
const props = defineProps<{
  open: boolean
  block: WorktimeBlock
  columns: readonly DataColumn[]
  rows: readonly DataRow[]
  /** 报表口径的「今天」,与余额卡同一天 —— 预览才有意义。 */
  today: string
}>()

const emit = defineEmits<{
  close: []
  submit: [values: Record<string, DataCellValue>]
}>()

const roles = computed(() => worktimeRoles(props.columns, props.block))

/** 「用掉」记负数、「得到」记正数。默认用掉:误记成获得比误记成使用更危险(凭空多出额度)。 */
type Direction = "use" | "gain"

const date = ref(props.today)
const person = ref("")
const kindId = ref("")
const note = ref("")
const statusId = ref("")
const direction = ref<Direction>("use")
/**
 * 时长用 `type="text"` + `inputmode="decimal"` 而不是 `type="number"`:
 * number 框的 spinner 在窄框里会压着数字,而 `v-model` 遇到 `type="number"` 会**自动
 * `looseToNumber`** —— 输入第一个字符后 `amount` 变成 number,任何 `trim()` 都当场抛错,
 * 表现是整个表单停在上一次渲染。取值一律 `String(...)`,类型系统也就守得住。
 */
const amount = ref("")
const extras = ref<Record<string, DataCellValue>>({})

const DRAFT_ID = "worktime-draft-row"

const kindOptions = computed(() => roles.value.kind?.options ?? [])

/** 只有一个类别时直接选上 —— 大部分表就是这么用的,不该逼人每次都点一下。 */
function pickOnlyKind(): string {
  return kindOptions.value.length === 1 ? (kindOptions.value[0]?.id ?? "") : ""
}

const kindSelect = ref<HTMLSelectElement | null>(null)
const amountInput = ref<HTMLInputElement | null>(null)

const kindOption = computed(() => kindOptions.value.find((option) => option.id === kindId.value) ?? null)

/** 类别决定单位:「加班 8 小时」与「年假 1 天」写在同一张表里。 */
const unitLabel = computed(() => {
  const option = kindOption.value
  if (option === null) return ""
  return WORKTIME_UNIT_LABELS[worktimePolicy(props.block, option.id).unit]
})

/** 已有人员,给输入框挂 datalist —— 手打名字最容易出现「张三 / 张 三」两个池。 */
const personOptions = computed<readonly string[]>(() => {
  const column = roles.value.person
  if (column === null) return []
  const seen = new Set<string>()
  for (const row of props.rows) {
    const value = dt.cellValue(row, column)
    if (typeof value === "string" && value !== "") seen.add(value)
  }
  return [...seen].sort((left, right) => left.localeCompare(right))
})

const personListId = computed(() => `worktime-persons-${props.block.id}`)

/** 列映射之外的列:照旧可以填,不必为了补一个「审批人」再打开数据表。 */
const extraColumns = computed<readonly DataColumn[]>(() => {
  const used = new Set<string>()
  for (const role of WORKTIME_ROLES) {
    const column = roles.value[role]
    if (column !== null) used.add(column.id)
  }
  return props.columns.filter((column) => !used.has(column.id) && column.type !== "image")
})

/**
 * 每次打开都从一张干净的表单开始,并把「只统计」那个状态带上 —— 新记的一笔默认进当前口径。
 *
 * 位置必须在 `personOptions` / `kindOptions` 之后：`immediate` 会当场执行一次,
 * 提到前面就是 TDZ 报错,而那个错误只表现为「弹窗空白」。
 */
watch(
  () => props.open,
  async (open) => {
    if (!open) return
    date.value = props.today
    // 单人表直接填上那个人:空人员的一笔不进任何池,而单人表里根本没有第二个选项。
    person.value = personOptions.value.length === 1 ? (personOptions.value[0] ?? "") : ""
    kindId.value = pickOnlyKind()
    note.value = ""
    statusId.value = props.block.statusValue
    direction.value = "use"
    amount.value = ""
    extras.value = {}
    await nextTick()
    // 类别是唯一必须动脑的字段,焦点先给它;已预选就直接跳去填时长。
    if (kindId.value === "") kindSelect.value?.focus()
    else amountInput.value?.focus()
  },
  { immediate: true },
)

const amountNumber = computed<number | null>(() => {
  const raw = String(amount.value).trim()
  if (raw === "") return null
  const value = Number(raw)
  return Number.isFinite(value) && value > 0 ? value : null
})

/** 提交前的拦路条件。空串 = 可以提交。 */
const problem = computed<string>(() => {
  if (roles.value.date !== null && !/^\d{4}-\d{2}-\d{2}$/.test(date.value)) return "给这一笔一个日期。"
  // 人员已分池的表里留空,这一笔会落在无人认领的池外 —— 报表按人建桶,空人名进不去。
  if (roles.value.person !== null && personOptions.value.length > 0 && person.value.trim() === "") {
    return "选一个人 —— 这张表按人分池,没有人员的一笔不进任何池。"
  }
  if (roles.value.kind !== null && kindId.value === "") {
    return kindOptions.value.length === 0 ? "类别列还没有选项 —— 去数据表里加一项再来。" : "选一个类别,它决定这笔进哪个池。"
  }
  if (roles.value.amount !== null && amountNumber.value === null) return "时长要填一个大于 0 的数。"
  return ""
})

/** 表单内容 → 一行。提交与预览共用,预览的数字就是提交后的数字。 */
function draftValues(): Record<string, DataCellValue> {
  const values: Record<string, DataCellValue> = {}
  const dateColumn = roles.value.date
  if (dateColumn !== null) values[dateColumn.id] = date.value
  const personColumn = roles.value.person
  if (personColumn !== null) values[personColumn.id] = person.value.trim() === "" ? null : person.value.trim()
  const kindColumn = roles.value.kind
  if (kindColumn !== null) values[kindColumn.id] = kindId.value === "" ? null : kindId.value
  const amountColumn = roles.value.amount
  if (amountColumn !== null) {
    const magnitude = amountNumber.value
    values[amountColumn.id] = magnitude === null ? null : direction.value === "use" ? -magnitude : magnitude
  }
  const noteColumn = roles.value.note
  if (noteColumn !== null) values[noteColumn.id] = note.value.trim() === "" ? null : note.value.trim()
  const statusColumn = roles.value.status
  if (statusColumn !== null) values[statusColumn.id] = statusId.value === "" ? null : statusId.value
  for (const column of extraColumns.value) {
    const value = extras.value[column.id]
    values[column.id] = value === undefined ? dt.emptyValueOf(column.type) : value
  }
  return values
}

/**
 * 预览报表:把草稿行接在现有行后面跑一遍 `worktimeReport`。
 *
 * 接在**后面**而不是按日期插进正确位置是对的 —— 报表内部按日期排序后从头重算,
 * 草稿落在数组哪个位置都不影响结果,而今天的视角与余额卡一致。
 */
const draftReport = computed<WorktimeReport | null>(() => {
  if (!props.open || problem.value !== "") return null
  return worktimeReport(
    [...props.rows, { id: DRAFT_ID, values: draftValues() }],
    roles.value,
    props.block,
    props.today,
  )
})

const preview = computed(() => draftReport.value?.rows.get(DRAFT_ID) ?? null)

function poolName(key: string): string {
  return draftReport.value?.pools.find((pool) => pool.key === key)?.name ?? "?"
}

function poolUnit(key: string): string {
  const policy = draftReport.value?.pools.find((pool) => pool.key === key)?.policy
  return policy === undefined ? "" : WORKTIME_UNIT_LABELS[policy.unit]
}

/**
 * 底部那行「这笔会怎么摊」。
 *
 * 四种结果各说各的:进池(获得)、摊到几个池(跨池使用)、从自己池里扣(自成一池)、
 * 没有可扣的额度(超支)。最后一种要显眼 —— 它意味着提交后余额变负,而用户多半是
 * 日期或类别填错了。
 */
const previewText = computed<string>(() => {
  const info = preview.value
  if (info === null) return ""
  if (direction.value === "gain") {
    const expires = info.expiresOn === "" ? "不过期" : `${info.expiresOn} 到期`
    return `进 ${poolName(info.poolKey)} 池 · ${expires}`
  }
  const rest = info.chainBalance ?? info.balance
  const restText =
    rest === null
      ? ""
      : `,之后${info.chainBalance === null ? "池里" : "链上合计"}剩 ${formatQuantity(rest)}${info.chainBalance === null ? ` ${poolUnit(info.poolKey)}` : " 小时"}`
  if (info.draws.length > 0) {
    const parts = info.draws.map((draw) => `${poolName(draw.poolKey)} ${formatQuantity(draw.amount)} ${poolUnit(draw.poolKey)}`)
    return `扣自 ${parts.join(" + ")}${restText}`
  }
  // 一次使用却一笔都没扣到 —— 链上和自己的池都是空的,提交后余额为负。
  return `${poolName(info.poolKey)} 池没有可扣的额度,这一笔会记成超支${restText}`
})

const previewWarn = computed<boolean>(() => {
  const info = preview.value
  if (info === null || direction.value === "gain") return false
  const rest = info.chainBalance ?? info.balance
  return rest !== null && rest < 0
})

function onExtra(column: DataColumn, event: Event): void {
  const target = event.target
  if (target instanceof HTMLInputElement) {
    const value = target.type === "checkbox" ? target.checked : dt.parseCellInput(target.value, column.type)
    extras.value = { ...extras.value, [column.id]: value }
    return
  }
  if (target instanceof HTMLSelectElement) {
    extras.value = { ...extras.value, [column.id]: target.value === "" ? null : target.value }
  }
}

function extraValue(column: DataColumn): string {
  const value = extras.value[column.id]
  if (value === undefined || value === null) return ""
  if (typeof value === "boolean") return value ? "1" : ""
  return String(value)
}

function extraChecked(column: DataColumn): boolean {
  return extras.value[column.id] === true
}

function submit(): void {
  if (problem.value !== "") return
  emit("submit", draftValues())
}

/** 只认「关」:reka 的 `update:open` 传的是新状态,false 才是请求关闭。 */
function onOpenChange(value: boolean): void {
  if (!value) emit("close")
}

const FIELD = "flex min-w-0 flex-col gap-1"
const LABEL = "text-[11px] text-muted-foreground"
const CONTROL = "h-8 w-full rounded-md border border-line bg-transparent px-2 text-[13px] outline-none transition-colors focus:border-ring"

/** 两个方向与它们的文案。「用掉」在前:它才是这个块里更常记的一笔。 */
const DIRECTIONS: readonly { value: Direction; label: string }[] = [
  { value: "use", label: "用掉" },
  { value: "gain", label: "得到" },
]
</script>

<template>
  <Dialog :open="props.open" @update:open="onOpenChange">
    <DialogContent class="sm:max-w-[420px]" @pointer-down-outside.prevent @open-auto-focus.prevent>
      <DialogHeader>
        <DialogTitle>记一笔</DialogTitle>
        <DialogDescription>
          填入这一笔工时变动。「用掉」记负数、「得到」记正数 —— 符号由块决定。
        </DialogDescription>
      </DialogHeader>

      <div class="grid grid-cols-2 gap-2.5">
        <label :class="FIELD">
          <span :class="LABEL">日期</span>
          <input v-model="date" type="date" :class="CONTROL">
        </label>

        <label :class="FIELD">
          <span :class="LABEL">类别</span>
          <select ref="kindSelect" v-model="kindId" :class="CONTROL">
            <option value="">选择类别</option>
            <option v-for="option in kindOptions" :key="option.id" :value="option.id">{{ option.name }}</option>
          </select>
        </label>

        <label v-if="roles.person !== null" :class="FIELD">
          <span :class="LABEL">人员</span>
          <input v-model="person" :list="personListId" :placeholder="personOptions.length === 0 ? '本人可留空' : '选择或输入人员'" :class="CONTROL">
          <datalist :id="personListId">
            <option v-for="name in personOptions" :key="name" :value="name" />
          </datalist>
        </label>

        <label v-if="roles.status !== null" :class="FIELD">
          <span :class="LABEL">状态</span>
          <select v-model="statusId" :class="CONTROL">
            <option value="">不填</option>
            <option v-for="option in roles.status.options" :key="option.id" :value="option.id">{{ option.name }}</option>
          </select>
        </label>

        <div class="col-span-2">
          <span :class="LABEL">这一笔是</span>
          <div class="mt-1 flex gap-1.5">
            <!-- 分段控件而不是两个独立按钮:两者互斥,放在同一个边框里才看得出「二选一」。 -->
            <div class="flex h-8 shrink-0 items-center gap-0.5 rounded-md border border-line p-0.5">
              <button
                v-for="item in DIRECTIONS"
                :key="item.value"
                type="button"
                class="h-full w-12 rounded-[4px] text-[12px] transition-colors"
                :class="direction === item.value ? 'bg-muted text-foreground' : 'text-muted-foreground hover:text-foreground'"
                @click="direction = item.value"
              >
                {{ item.label }}
              </button>
            </div>
            <div class="flex min-w-0 flex-1 items-center gap-1.5">
              <input
                ref="amountInput"
                v-model="amount"
                type="text"
                inputmode="decimal"
                placeholder="0"
                class="h-8 w-full min-w-0 rounded-md border border-line bg-transparent px-2 text-right tabular-nums text-[13px] outline-none transition-colors focus:border-ring"
                @keydown.enter.prevent="submit"
              >
              <span class="w-6 shrink-0 text-[11px] text-muted-foreground">{{ unitLabel }}</span>
            </div>
          </div>
        </div>

        <label v-if="roles.note !== null" class="col-span-2" :class="FIELD">
          <span :class="LABEL">事由</span>
          <input v-model="note" :class="CONTROL" @keydown.enter.prevent="submit">
        </label>

        <template v-if="extraColumns.length > 0">
          <div class="col-span-2 mt-0.5 border-t border-line/60 pt-2 text-[10px] text-muted-foreground">
            其他列（可留空）
          </div>
          <label
            v-for="column in extraColumns"
            :key="column.id"
            :class="[FIELD, column.type === 'checkbox' ? 'flex-row items-center gap-1.5' : '']"
          >
            <template v-if="column.type === 'checkbox'">
              <input type="checkbox" class="size-3.5" :checked="extraChecked(column)" @change="onExtra(column, $event)">
              <span class="text-[12px]">{{ column.name }}</span>
            </template>
            <template v-else-if="column.type === 'select'">
              <span :class="LABEL">{{ column.name }}</span>
              <select :class="CONTROL" :value="extraValue(column)" @change="onExtra(column, $event)">
                <option value="">不填</option>
                <option v-for="option in column.options" :key="option.id" :value="option.id">{{ option.name }}</option>
              </select>
            </template>
            <template v-else>
              <span :class="LABEL">{{ column.name }}</span>
              <input
                :type="column.type === 'date' ? 'date' : column.type === 'number' ? 'number' : 'text'"
                :class="CONTROL"
                :value="extraValue(column)"
                @input="onExtra(column, $event)"
              >
            </template>
          </label>
        </template>
      </div>

      <!-- 这条提示兼作表单状态行:缺什么先说缺什么,填全了就报这一笔会怎么摊。 -->
      <p v-if="problem !== ''" class="px-0.5 text-[11px] text-muted-foreground">{{ problem }}</p>
      <p
        v-else-if="previewText !== ''"
        class="rounded-md border-l-2 px-2 py-1.5 text-[11px]"
        :class="previewWarn ? 'border-destructive bg-destructive/5 text-destructive' : 'border-line bg-muted/40 text-muted-foreground'"
      >
        {{ previewText }}
      </p>

      <DialogFooter>
        <Button variant="ghost" size="sm" class="text-[13px]" @click="emit('close')">取消</Button>
        <Button size="sm" class="text-[13px]" @click="submit">记下</Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>
</template>

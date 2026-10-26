<script setup lang="ts">
import type { BlockSettingsPatch, WorktimeBlock, WorktimePolicy, WorktimeTier, WorktimeUnit } from "@/types/workspace"
import type { DataCellValue, DataColumn, DataRow } from "@/types/data-table"
import type { WorktimeChain, WorktimeLot, WorktimePool, WorktimeRole, WorktimeRowInfo } from "@/lib/worktime"
import { computed, nextTick, ref } from "vue"
import { DatabaseIcon, PlusIcon, Settings2Icon, Trash2Icon } from "@lucide/vue"
import { Button } from "@/components/ui/button"
import { DropdownMenu, DropdownMenuContent, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import WorktimeEntryDialog from "@/components/WorktimeEntryDialog.vue"
import TableRefNotice from "@/components/TableRefNotice.vue"
import OptionCell from "@/components/OptionCell.vue"
import { useWorkspace } from "@/composables/useWorkspace"
import { useTableEntry } from "@/composables/useTableEntry"
import { useCellEditing } from "@/composables/useCellEditing"
import * as dt from "@/lib/data-table"
import {
  formatQuantity,
  localToday,
  quantityWithUnit,
  tierDays,
  WORKTIME_ACCRUAL_LABELS,
  WORKTIME_RESET_LABELS,
  WORKTIME_ROLES,
  WORKTIME_ROLE_FIELDS,
  WORKTIME_ROLE_LABELS,
  WORKTIME_UNIT_LABELS,
  worktimePolicy,
  worktimeReport,
  worktimeRoles,
} from "@/lib/worktime"

/**
 * 工时块:把一张数据表按人事口径渲染成工时台账 —— 每类假期一张余额卡、一条带余额与
 * 有效期至的变动明细、可按池摊开的额度批次。
 *
 * 数据链路与账目 / 订阅 / 歌单完全同源,取数走 `useTableEntry` 共用 seam;
 * 余额 / 已用 / 应享 / 作废量全部在 `lib/worktime`,与导出快照共用一份 —— 这里不重复公式。
 *
 * 就地编辑与账目块同一套口径(解析走 `dt.parseCellInput`):点格值即编辑,回车提交并跳到
 * **下一行同列**,select 用共享的 `OptionCell`(Tab 到即展开),行号悬停变 ✕ 删行。
 * 日期格用原生 `<input type="date">` —— 这个块天天录日期,浏览器自带的月历省掉一层自绘
 * 浮层的焦点陷阱;而这里没有账目块「编辑一行期间钉住排序」的需求(明细按日期倒序,
 * 改完日期自然就位)。
 */
const props = defineProps<{ block: WorktimeBlock }>()

const { openFile, updateBlockSettings } = useWorkspace()

const { state, table, columns, rows, change } = useTableEntry(() => props.block.path)

/** 报表的「今天」。开一整天不刷新是可以接受的:余额按日变,不按秒变。 */
const today = localToday()

const roles = computed(() => worktimeRoles(columns.value, props.block))

const report = computed(() => worktimeReport(rows.value, roles.value, props.block, today))

/** 人员筛选。空串 = 全部;多人表才显示那一排标签。 */
const personFilter = ref("")

const visiblePools = computed<readonly WorktimePool[]>(() =>
  personFilter.value === "" ? report.value.pools : report.value.pools.filter((pool) => pool.person === personFilter.value),
)

const poolByKey = computed(() => new Map(report.value.pools.map((pool) => [pool.key, pool])))

function poolPerson(poolKey: string): string {
  return poolByKey.value.get(poolKey)?.person ?? ""
}

/** 链合计卡:一条链一张,恒按小时。链上的成员卡照旧显示各自的额度,两者互补。 */
const visibleChains = computed<readonly WorktimeChain[]>(() =>
  personFilter.value === "" ? report.value.chains : report.value.chains.filter((chain) => chain.person === personFilter.value),
)

function chainLabel(chain: WorktimeChain): string {
  return chain.person === "" ? chain.name : `${chain.person} · ${chain.name}`
}

/** 链上成员的名字,按取额度顺序 —— 「先扣加班、再扣年假」这件事得让人看得见。 */
function chainMembers(chain: WorktimeChain): string {
  return chain.members
    .map((key) => poolByKey.value.get(key)?.name ?? "")
    .filter((name) => name !== "")
    .join(" → ")
}

function unitOf(poolKey: string): WorktimeUnit {
  return poolByKey.value.get(poolKey)?.policy.unit ?? "day"
}

/** 池卡片的标题:多人表带人名,单人表只有假期名。 */
function poolLabel(pool: WorktimePool): string {
  return pool.person === "" ? pool.name : `${pool.person} · ${pool.name}`
}

/**
 * 卡片下方的第二行:应享 / 已用,以及结转与作废 —— 只在有值时出现,空话不上卡。
 *
 * 「应享」把结转算进去(结转是上期攒下来的额度,当前周期确实可以用),但单独标出结转量,
 * 免得「应享 15 天」看起来像公司多发了 5 天。
 */
function poolDetail(pool: WorktimePool): string {
  const parts: string[] = []
  // 「应享」只装规则自动发的那一份,「补入」装人记的正数行 —— 合成一个数会把
  // 「公司按工龄发了 5 天」和「人事手工补了 10 天」说成同一件事。
  if (pool.granted !== 0) parts.push(`应享 ${formatQuantity(pool.granted)}`)
  if (pool.carryIn !== 0) parts.push(`含结转 ${formatQuantity(pool.carryIn)}`)
  if (pool.added !== 0) parts.push(`补入 ${formatQuantity(pool.added)}`)
  parts.push(`已用 ${formatQuantity(pool.used)}`)
  if (pool.expired !== 0) parts.push(`作废 ${formatQuantity(pool.expired)}`)
  return parts.join(" · ")
}

/** 即将到期的一句话。日期放这里而不是卡片角标 —— 角标放不下「哪天 + 多少」。 */
function soonText(pool: WorktimePool): string {
  if (pool.soon <= 0) return ""
  return `${pool.soonOn.slice(5)} 到期 ${formatQuantity(pool.soon)} ${WORKTIME_UNIT_LABELS[pool.policy.unit]}`
}

// ---- 列 ----

/** 表格里露面的列:先按人事口径排(日期 / 人员 / 类别 / 事由 / 状态),其余可编列跟上。 */
interface ColumnSlot {
  column: DataColumn
  role: WorktimeRole | ""
}

const VISIBLE_ROLES: readonly WorktimeRole[] = ["date", "person", "kind", "note", "status"]

const columnSlots = computed<readonly ColumnSlot[]>(() => {
  const slots: ColumnSlot[] = []
  const used = new Set<string>()
  for (const role of VISIBLE_ROLES) {
    const column = roles.value[role]
    if (column === null || used.has(column.id)) continue
    used.add(column.id)
    slots.push({ column, role })
  }
  // 入职日期是「每人一个常数」,摊进明细只会每天重复同一个值 —— 不露面。
  const hire = roles.value.hire
  if (hire !== null) used.add(hire.id)
  for (const column of columns.value) {
    if (used.has(column.id) || column.type === "image") continue
    slots.push({ column, role: "" })
  }
  return slots
})

// ---- 明细行 ----

interface DisplayRow {
  row: DataRow
  /** 报表里的行信息。null = 这一行还没分类(无日期 / 无时长 / 类别对不上选项)。 */
  info: WorktimeRowInfo | null
  date: string
}

function dateOf(row: DataRow): string {
  const column = roles.value.date
  if (column === null) return ""
  const value = dt.cellValue(row, column)
  return typeof value === "string" ? value : ""
}

/**
 * 展示序:日期倒序(最近一笔在最上),空日期的行沉底 —— 与账目块「先看见最近一笔」同一读法。
 * 多人筛选按行所属池的人名走;还没进池的行退回读它自己的人员格。
 */
const displayRows = computed<readonly DisplayRow[]>(() => {
  const list: DisplayRow[] = rows.value.map((row) => ({
    row,
    info: report.value.rows.get(row.id) ?? null,
    date: dateOf(row),
  }))
  const personColumn = roles.value.person
  const filtered =
    personFilter.value === ""
      ? list
      : list.filter((item) => {
          if (item.info !== null) return poolPerson(item.info.poolKey) === personFilter.value
          if (personColumn === null) return true
          return String(dt.cellValue(item.row, personColumn) ?? "") === personFilter.value
        })
  return [...filtered].sort((left, right) => right.date.localeCompare(left.date))
})

function cellText(row: DataRow, column: DataColumn): string {
  return dt.valueText(dt.cellValue(row, column), column)
}

/** 时长格:带符号 + 该行所属池的单位(同一个表里天与小时可以并存)。 */
function amountText(row: DataRow): string {
  const column = roles.value.amount
  if (column === null) return ""
  const value = dt.cellValue(row, column)
  if (typeof value !== "number") return ""
  const info = report.value.rows.get(row.id)
  return quantityWithUnit(value, info === undefined ? "day" : unitOf(info.poolKey))
}

/**
 * 余额格。在链上时显示**链合计**(小时)—— 一笔「调休 -8 小时」发生在这个池上,池自己的余额
 * 恒为 0,值钱的是链上所有人加起来还剩多少。
 */
function balanceText(info: DisplayRow["info"]): string {
  if (info === null) return "—"
  if (info.chainBalance !== null) return formatQuantity(info.chainBalance)
  return info.balance === null ? "—" : formatQuantity(info.balance)
}

/** 这一笔拆到了哪几个池。挂在余额格的 title 上 —— 拆分明细不该挤占表格列。 */
function drawsText(info: DisplayRow["info"]): string {
  if (info === null || info.draws.length === 0) return ""
  const parts = info.draws.map((draw) => {
    const name = poolByKey.value.get(draw.poolKey)?.name ?? "?"
    return `${name} ${formatQuantity(draw.amount)}`
  })
  return `扣自 ${parts.join(" + ")}`
}

function expiresText(info: DisplayRow["info"]): string {
  return info === null || info.expiresOn === "" ? "—" : info.expiresOn
}

// ---- 就地编辑 ----

const { editing, cellKey, commit, commitOnBlur, toggleCheck, focusOnMount } = useCellEditing(change)

/** 编辑态初值。数字取原始值 —— 显示的是「+3 小时」,回填进去会解析成 null。 */
function editText(row: DataRow, column: DataColumn): string {
  const value = dt.cellValue(row, column)
  if (typeof value === "number") return String(value)
  return dt.valueText(value, column)
}

/** 回车:提交 + 跳到展示序的下一行同列;已是最后一行就退出编辑态。 */
function commitOnEnter(row: DataRow, column: DataColumn, event: Event): void {
  const target = event.target
  if (!(target instanceof HTMLInputElement)) return
  commit(row, column, target.value)
  const index = displayRows.value.findIndex((item) => item.row.id === row.id)
  const next = displayRows.value[index + 1]
  editing.value = next === undefined ? "" : cellKey(next.row, column)
}

function pickOption(row: DataRow, column: DataColumn, value: string): void {
  const freshRow = rows.value.find((item) => item.id === row.id)
  const freshColumn = columns.value.find((item) => item.id === column.id)
  if (freshRow === undefined || freshColumn === undefined) return
  commit(freshRow, freshColumn, value)
}

const rootEl = ref<HTMLElement | null>(null)

/** 记一笔:开表单。值在表单里填齐再落表 —— 空行 + 就地编辑会让「负号」这种关键信息靠手输。 */
const entryOpen = ref(false)

function addEntry(): void {
  // 没有类别列就没有池可分 —— 块上方已说清缺什么,这里不开一张填不出池的表单。
  if (roles.value.kind === null) return
  entryOpen.value = true
}

/** 表单交上来的值:加一行、落格,一次 `change` 提交 —— 别处的引用照旧看见同一次变更。 */
async function submitEntry(values: Record<string, DataCellValue>): Promise<void> {
  let addedId = ""
  await change((current) => {
    const withRow = dt.addRow(current)
    const added = withRow.rows[withRow.rows.length - 1]
    if (added === undefined) return withRow
    addedId = added.id
    const filled = Object.entries(values).reduce((row, [columnId, value]) => dt.setCell(row, columnId, value), added)
    return dt.replaceRow(withRow, filled)
  })
  entryOpen.value = false
  if (addedId === "") return
  await nextTick()
  rootEl.value?.querySelector(`[data-row-id="${addedId}"]`)?.scrollIntoView({ block: "nearest" })
}

function removeEntry(row: DataRow): void {
  if (editing.value.startsWith(row.id + ":")) editing.value = ""
  void change((current) => dt.removeRow(current, row.id))
}

// ---- 块设置 ----

/**
 * 改一个列映射。动态键会丢掉字段名的字面量类型,所以逐个赋值 —— 七行换一份可编译的
 * patch,比写一个 `as` 便宜。
 */
function setRole(role: WorktimeRole, columnId: string): void {
  const patch: BlockSettingsPatch = {}
  if (role === "date") patch.dateColumnId = columnId
  else if (role === "person") patch.personColumnId = columnId
  else if (role === "kind") patch.kindColumnId = columnId
  else if (role === "amount") patch.amountColumnId = columnId
  else if (role === "note") patch.noteColumnId = columnId
  else if (role === "status") patch.statusColumnId = columnId
  else patch.hireColumnId = columnId
  // 换掉类别列之后,旧的池规则与状态过滤都指着别的列的选项,一并清掉 —— 留着只会静默错位。
  if (role === "kind") {
    patch.policies = {}
    patch.statusValue = ""
  }
  updateBlockSettings(props.block.id, patch)
}

function onRoleChange(role: WorktimeRole, event: Event): void {
  const target = event.target
  if (!(target instanceof HTMLSelectElement)) return
  setRole(role, target.value)
}

/** 可映射的列:按角色限类型,免得把「事由」指到日期列上去。 */
function roleColumns(role: WorktimeRole): readonly DataColumn[] {
  if (role === "date" || role === "hire") return columns.value.filter((column) => column.type === "date")
  if (role === "kind" || role === "status") return columns.value.filter((column) => column.type === "select")
  if (role === "amount") return columns.value.filter((column) => column.type === "number")
  return columns.value.filter((column) => column.type === "text")
}

function roleId(role: WorktimeRole): string {
  return props.block[WORKTIME_ROLE_FIELDS[role]]
}

const statusColumn = computed(() => roles.value.status)

function setStatusValue(event: Event): void {
  const target = event.target
  if (!(target instanceof HTMLSelectElement)) return
  updateBlockSettings(props.block.id, { statusValue: target.value })
}

function setSoonDays(event: Event): void {
  const target = event.target
  if (!(target instanceof HTMLInputElement)) return
  const value = Number(target.value)
  updateBlockSettings(props.block.id, { soonDays: Number.isFinite(value) && value >= 0 ? Math.round(value) : 30 })
}

function toggleLots(event: Event): void {
  const target = event.target
  if (!(target instanceof HTMLInputElement)) return
  updateBlockSettings(props.block.id, { showLots: target.checked })
}

/** 池规则的一条改动。存的是完整策略(缺项先按缺省补齐),解析端才不用猜哪些字段在场。 */
function setPolicy(optionId: string, patch: Partial<WorktimePolicy>): void {
  updateBlockSettings(props.block.id, {
    policies: { ...props.block.policies, [optionId]: { ...worktimePolicy(props.block, optionId), ...patch } },
  })
}

function onValidity(optionId: string, event: Event): void {
  const target = event.target
  if (!(target instanceof HTMLInputElement)) return
  const value = Number(target.value)
  if (Number.isFinite(value)) setPolicy(optionId, { validityMonths: Math.max(0, value) })
}

function onFixedDays(optionId: string, event: Event): void {
  const target = event.target
  if (!(target instanceof HTMLInputElement)) return
  const value = Number(target.value)
  if (Number.isFinite(value)) setPolicy(optionId, { fixedDays: Math.max(0, value) })
}

function onCarryMax(optionId: string, event: Event): void {
  const target = event.target
  if (!(target instanceof HTMLInputElement)) return
  const raw = target.value.trim()
  if (raw === "") {
    setPolicy(optionId, { carryOverMax: null })
    return
  }
  const value = Number(raw)
  if (Number.isFinite(value)) setPolicy(optionId, { carryOverMax: Math.max(0, value) })
}

function onResetChange(optionId: string, event: Event): void {
  const target = event.target
  if (!(target instanceof HTMLSelectElement)) return
  const value = target.value
  if (value !== "none" && value !== "calendar" && value !== "fiscal" && value !== "anniversary") return
  setPolicy(optionId, { reset: value })
}

function onAccrualChange(optionId: string, event: Event): void {
  const target = event.target
  if (!(target instanceof HTMLSelectElement)) return
  const value = target.value
  if (value !== "fixed" && value !== "seniority") return
  setPolicy(optionId, { accrual: value })
}

function onUnitChange(optionId: string, event: Event): void {
  const target = event.target
  if (!(target instanceof HTMLSelectElement)) return
  const value = target.value
  if (value !== "day" && value !== "hour") return
  setPolicy(optionId, { unit: value })
}

/**
 * 四个枚举字段共用一个入口。按 key 分派,每个分支里收窄到合法值 —— 一个 select 一个 handler
 * 会让这段设置菜单再多出四个几乎一样的函数。
 */
function setPolicyChoice(optionId: string, key: "expiryAlign" | "consume" | "scope" | "lapse", event: Event): void {
  const target = event.target
  if (!(target instanceof HTMLSelectElement)) return
  const value = target.value
  if (key === "expiryAlign") {
    if (value === "none" || value === "monthEnd") setPolicy(optionId, { expiryAlign: value })
    return
  }
  if (key === "consume") {
    if (value === "expiry" || value === "latest") setPolicy(optionId, { consume: value })
    return
  }
  if (key === "scope") {
    if (value !== "standalone" && value !== "chain") return
    // 刚接入链时给一个默认链名 —— 空链名的池不算在链上,填完这个名字才开始真的合池。
    const current = worktimePolicy(props.block, optionId).chain
    setPolicy(optionId, { scope: value, chain: value === "chain" ? current === "" ? "调休" : current : "" })
    return
  }
  if (value === "writeoff" || value === "retain") setPolicy(optionId, { lapse: value })
}

function onChainName(optionId: string, event: Event): void {
  const target = event.target
  if (!(target instanceof HTMLInputElement)) return
  setPolicy(optionId, { chain: target.value.trim() })
}

/** 链序与折算比共用:都是正数输入,只是一个取整、一个保留小数。 */
function onChainNumber(optionId: string, key: "chainOrder" | "hoursPerDay", event: Event): void {
  const target = event.target
  if (!(target instanceof HTMLInputElement)) return
  const value = Number(target.value)
  if (!Number.isFinite(value)) return
  if (key === "chainOrder") {
    setPolicy(optionId, { chainOrder: Math.round(value) })
    return
  }
  if (value > 0) setPolicy(optionId, { hoursPerDay: value })
}

/** 两个 MM-DD 字段共用一个入口:格式不对就清空,而不是把半截字符串存进去。 */
function onMonthDay(optionId: string, key: "resetMonthDay" | "carryOverDeadline", event: Event): void {
  const target = event.target
  if (!(target instanceof HTMLInputElement)) return
  const value = target.value.trim()
  const normalized = /^\d{2}-\d{2}$/.test(value) ? value : ""
  if (key === "resetMonthDay") setPolicy(optionId, { resetMonthDay: normalized })
  else setPolicy(optionId, { carryOverDeadline: normalized })
}

function onAutoGrant(optionId: string, event: Event): void {
  const target = event.target
  if (!(target instanceof HTMLInputElement)) return
  setPolicy(optionId, { autoGrant: target.checked })
}

/** 起算日:完整日期。格式不对就清空 —— 半截字符串存进去,周期循环会从错误的一期开始跑。 */
function onGrantFrom(optionId: string, event: Event): void {
  const target = event.target
  if (!(target instanceof HTMLInputElement)) return
  const value = target.value.trim()
  setPolicy(optionId, { grantFrom: /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : "" })
}

/** 最多发放几期。`0` = 不限,负数与小数都收进来再归一。 */
function onPeriodLimit(optionId: string, event: Event): void {
  const target = event.target
  if (!(target instanceof HTMLInputElement)) return
  const value = Number(target.value)
  if (Number.isFinite(value)) setPolicy(optionId, { periodLimit: Math.max(0, Math.round(value)) })
}

function onProrate(optionId: string, event: Event): void {
  const target = event.target
  if (!(target instanceof HTMLInputElement)) return
  setPolicy(optionId, { prorate: target.checked })
}

function setTier(optionId: string, index: number, patch: Partial<WorktimeTier>): void {
  const policy = worktimePolicy(props.block, optionId)
  const tiers = policy.tiers.map((tier, position) => (position === index ? { ...tier, ...patch } : tier))
  setPolicy(optionId, { tiers })
}

function onTierYears(optionId: string, index: number, event: Event): void {
  const target = event.target
  if (!(target instanceof HTMLInputElement)) return
  const value = Number(target.value)
  if (Number.isFinite(value) && value >= 0) setTier(optionId, index, { minYears: value })
}

function onTierDays(optionId: string, index: number, event: Event): void {
  const target = event.target
  if (!(target instanceof HTMLInputElement)) return
  const value = Number(target.value)
  if (Number.isFinite(value) && value >= 0) setTier(optionId, index, { days: value })
}

function addTier(optionId: string): void {
  const policy = worktimePolicy(props.block, optionId)
  const last = policy.tiers[policy.tiers.length - 1]
  setPolicy(optionId, { tiers: [...policy.tiers, { minYears: (last?.minYears ?? 0) + 10, days: last?.days ?? 5 }] })
}

function removeTier(optionId: string, index: number): void {
  const policy = worktimePolicy(props.block, optionId)
  if (policy.tiers.length <= 1) return
  setPolicy(optionId, { tiers: policy.tiers.filter((_, position) => position !== index) })
}

// ---- 批次 ----

/** 批次此刻还在不在有效期内 —— 判断用报表的 `today`,与余额同一口径。 */
function lotAlive(lot: WorktimeLot): boolean {
  return lot.expiresOn === "" || lot.expiresOn >= today
}

function lotRemaining(lot: WorktimeLot): number {
  return lot.amount - lot.used
}

const kindOptions = computed(() => roles.value.kind?.options ?? [])

/** 工龄阶梯的一句话摘要,免得用户对着几行数字猜它算出来是多少。 */
function tierHint(policy: WorktimePolicy): string {
  const first = policy.tiers[0]
  if (first === undefined) return ""
  return `按今天的工龄,最低一档是 ${tierDays(policy.tiers, 0)} 天`
}

const MENU = "w-[340px] max-h-[70vh] overflow-y-auto rounded-island p-1.5 shadow-pop ring-1 ring-line/70"
const SELECT = "w-full cursor-pointer rounded border border-line bg-transparent px-1.5 py-1 text-[12px] outline-none"
const FIELD = "flex min-w-0 flex-col gap-0.5"
const LABEL = "text-[10px] text-muted-foreground"

function openTable(): void {
  if (props.block.path === "") return
  openFile(props.block.path)
}
</script>

<template>
  <!-- 空指针:如实说没指定。 -->
  <TableRefNotice v-if="props.block.path === ''" kind="unset" label="工时" />

  <!-- 引用的文件读不到:提示态,不是错误态。 -->
  <TableRefNotice
    v-else-if="state === 'missing' || state === 'failed'"
    kind="missing"
    label="工时"
    :path="props.block.path"
  />

  <TableRefNotice v-else-if="table === null" kind="loading" label="工时" />

  <div v-else ref="rootEl" class="group/worktime relative my-4">
    <!-- 块操作入口:右上角,悬停浮现。「记一笔」在前,它是这块的主要动作。 -->
    <div
      class="absolute -top-2 right-0 z-20 flex items-center gap-1 opacity-0 transition-opacity group-hover/worktime:opacity-100 focus-within:opacity-100"
    >
      <Button
        variant="ghost"
        size="sm"
        class="h-6 gap-1 rounded-full bg-popover px-2 text-[12px] text-muted-foreground hover:text-foreground"
        @click="addEntry"
      >
        <PlusIcon class="size-3" />记一笔
      </Button>
      <Button
        variant="ghost"
        size="sm"
        class="h-6 gap-1 rounded-full bg-popover px-2 text-[12px] text-muted-foreground hover:text-foreground"
        @click="openTable"
      >
        <DatabaseIcon class="size-3" />打开数据表
      </Button>
      <DropdownMenu>
        <DropdownMenuTrigger as-child>
          <Button
            variant="ghost"
            size="sm"
            class="h-6 gap-1 rounded-full bg-popover px-2 text-[12px] text-muted-foreground hover:text-foreground"
          >
            <Settings2Icon class="size-3" />设置
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent :class="MENU" align="end">
          <DropdownMenuLabel class="px-2 pb-1 pt-1.5 text-[11px] font-normal text-muted-foreground">列映射</DropdownMenuLabel>
          <div class="grid grid-cols-2 gap-1.5 px-2 pb-1.5">
            <label v-for="role in WORKTIME_ROLES" :key="role" :class="FIELD">
              <span :class="LABEL">{{ WORKTIME_ROLE_LABELS[role] }}</span>
              <select :class="SELECT" :value="roleId(role)" @change="onRoleChange(role, $event)">
                <option value="">未设置</option>
                <option v-for="column in roleColumns(role)" :key="column.id" :value="column.id">{{ column.name }}</option>
              </select>
            </label>
          </div>

          <DropdownMenuSeparator class="mx-2 my-1 bg-line" />
          <DropdownMenuLabel class="px-2 pb-1 pt-1.5 text-[11px] font-normal text-muted-foreground">显示</DropdownMenuLabel>
          <div class="grid grid-cols-2 gap-1.5 px-2 pb-1.5">
            <label :class="FIELD">
              <span :class="LABEL">即将到期提醒（天）</span>
              <input type="number" min="0" :class="SELECT" :value="props.block.soonDays" @change="setSoonDays">
            </label>
            <label v-if="statusColumn !== null" :class="FIELD">
              <span :class="LABEL">只统计</span>
              <select :class="SELECT" :value="props.block.statusValue" @change="setStatusValue">
                <option value="">全部记录</option>
                <option v-for="option in statusColumn.options" :key="option.id" :value="option.id">{{ option.name }}</option>
              </select>
            </label>
          </div>
          <label class="flex items-center gap-1.5 px-2 pb-1.5 text-[12px]">
            <input type="checkbox" class="size-3.5" :checked="props.block.showLots" @change="toggleLots">
            <span>显示额度批次</span>
          </label>

          <template v-if="kindOptions.length > 0">
            <DropdownMenuSeparator class="mx-2 my-1 bg-line" />
            <DropdownMenuLabel class="px-2 pb-1 pt-1.5 text-[11px] font-normal text-muted-foreground">
              每类假期的规则
            </DropdownMenuLabel>

            <!-- 每池一节,原生 details 折叠:策略字段多,平铺会把这一个菜单撑成一整页。 -->
            <details v-for="option in kindOptions" :key="option.id" class="px-2 pb-1">
              <summary class="cursor-pointer list-none py-1 text-[12px]">
                <span class="mr-1 text-muted-foreground">▸</span>{{ option.name }}
              </summary>
              <div class="grid grid-cols-2 gap-1.5 pb-2 pl-2">
                <label :class="FIELD">
                  <span :class="LABEL">单位</span>
                  <select :class="SELECT" :value="worktimePolicy(props.block, option.id).unit" @change="onUnitChange(option.id, $event)">
                    <option value="day">天</option>
                    <option value="hour">小时</option>
                  </select>
                </label>
                <label :class="FIELD">
                  <span :class="LABEL">每笔有效（月，0 = 不过期）</span>
                  <input
                    type="number"
                    min="0"
                    :class="SELECT"
                    :value="worktimePolicy(props.block, option.id).validityMonths"
                    @change="onValidity(option.id, $event)"
                  >
                </label>
                <label :class="FIELD">
                  <span :class="LABEL">到期日对齐</span>
                  <select
                    :class="SELECT"
                    :value="worktimePolicy(props.block, option.id).expiryAlign"
                    @change="setPolicyChoice(option.id, 'expiryAlign', $event)"
                  >
                    <option value="none">原样加月</option>
                    <option value="monthEnd">收到月末</option>
                  </select>
                </label>
                <label :class="FIELD">
                  <span :class="LABEL">先扣哪一笔</span>
                  <select
                    :class="SELECT"
                    :value="worktimePolicy(props.block, option.id).consume"
                    @change="setPolicyChoice(option.id, 'consume', $event)"
                  >
                    <option value="expiry">快过期的先扣</option>
                    <option value="latest">最新一笔先扣</option>
                  </select>
                </label>
                <label :class="FIELD">
                  <span :class="LABEL">过期怎么算</span>
                  <select
                    :class="SELECT"
                    :value="worktimePolicy(props.block, option.id).lapse"
                    @change="setPolicyChoice(option.id, 'lapse', $event)"
                  >
                    <option value="writeoff">作废</option>
                    <option value="retain">只标记、不作废</option>
                  </select>
                </label>
                <label :class="FIELD">
                  <span :class="LABEL">重置节点</span>
                  <select :class="SELECT" :value="worktimePolicy(props.block, option.id).reset" @change="onResetChange(option.id, $event)">
                    <option v-for="(label, value) in WORKTIME_RESET_LABELS" :key="value" :value="value">{{ label }}</option>
                  </select>
                </label>
                <label v-if="worktimePolicy(props.block, option.id).reset === 'fiscal'" :class="FIELD">
                  <span :class="LABEL">财年起始（MM-DD）</span>
                  <input
                    type="text"
                    placeholder="04-01"
                    :class="SELECT"
                    :value="worktimePolicy(props.block, option.id).resetMonthDay"
                    @change="onMonthDay(option.id, 'resetMonthDay', $event)"
                  >
                </label>
                <label :class="FIELD">
                  <span :class="LABEL">结转上限（空 = 不限）</span>
                  <input
                    type="text"
                    placeholder="不限"
                    :class="SELECT"
                    :value="worktimePolicy(props.block, option.id).carryOverMax ?? ''"
                    @change="onCarryMax(option.id, $event)"
                  >
                </label>
                <label :class="FIELD">
                  <span :class="LABEL">结转失效（MM-DD）</span>
                  <input
                    type="text"
                    placeholder="03-31"
                    :class="SELECT"
                    :value="worktimePolicy(props.block, option.id).carryOverDeadline"
                    @change="onMonthDay(option.id, 'carryOverDeadline', $event)"
                  >
                </label>
                <label class="col-span-2 flex items-center gap-1.5 text-[12px]">
                  <input
                    type="checkbox"
                    class="size-3.5"
                    :checked="worktimePolicy(props.block, option.id).autoGrant"
                    @change="onAutoGrant(option.id, $event)"
                  >
                  <span>每期自动发放额度</span>
                </label>
                <!-- 起算日与期数上限只在周期口径下有意义:逐笔有效期的池不看重置,也就没有"发几期"。 -->
                <template v-if="worktimePolicy(props.block, option.id).reset !== 'none'">
                  <label :class="FIELD">
                    <span :class="LABEL">起算日（YYYY-MM-DD）</span>
                    <input
                      type="text"
                      placeholder="首条记录"
                      :class="SELECT"
                      :value="worktimePolicy(props.block, option.id).grantFrom"
                      @change="onGrantFrom(option.id, $event)"
                    >
                  </label>
                  <label :class="FIELD">
                    <span :class="LABEL">共发几期（0 = 不限）</span>
                    <input
                      type="number"
                      min="0"
                      :class="SELECT"
                      :value="worktimePolicy(props.block, option.id).periodLimit"
                      @change="onPeriodLimit(option.id, $event)"
                    >
                  </label>
                </template>
                <label :class="FIELD">
                  <span :class="LABEL">发放方式</span>
                  <select
                    :class="SELECT"
                    :value="worktimePolicy(props.block, option.id).accrual"
                    @change="onAccrualChange(option.id, $event)"
                  >
                    <option v-for="(label, value) in WORKTIME_ACCRUAL_LABELS" :key="value" :value="value">{{ label }}</option>
                  </select>
                </label>
                <label v-if="worktimePolicy(props.block, option.id).accrual === 'fixed'" :class="FIELD">
                  <span :class="LABEL">每期天数</span>
                  <input
                    type="number"
                    min="0"
                    :class="SELECT"
                    :value="worktimePolicy(props.block, option.id).fixedDays"
                    @change="onFixedDays(option.id, $event)"
                  >
                </label>

                <div v-if="worktimePolicy(props.block, option.id).accrual === 'seniority'" class="col-span-2">
                  <div class="mb-0.5 flex items-center justify-between">
                    <span :class="LABEL">工龄阶梯</span>
                    <button type="button" class="text-[11px] text-muted-foreground hover:text-foreground" @click="addTier(option.id)">
                      + 加一档
                    </button>
                  </div>
                  <div
                    v-for="(tier, index) in worktimePolicy(props.block, option.id).tiers"
                    :key="index"
                    class="mb-1 flex items-center gap-1"
                  >
                    <span class="text-[11px] text-muted-foreground">满</span>
                    <input
                      type="number"
                      min="0"
                      class="w-12 rounded border border-line bg-transparent px-1 py-0.5 text-[11px] outline-none"
                      :value="tier.minYears"
                      @change="onTierYears(option.id, index, $event)"
                    >
                    <span class="text-[11px] text-muted-foreground">年 →</span>
                    <input
                      type="number"
                      min="0"
                      class="w-12 rounded border border-line bg-transparent px-1 py-0.5 text-[11px] outline-none"
                      :value="tier.days"
                      @change="onTierDays(option.id, index, $event)"
                    >
                    <span class="text-[11px] text-muted-foreground">天</span>
                    <button
                      type="button"
                      class="ml-auto text-muted-foreground hover:text-destructive"
                      aria-label="删除这一档"
                      @click="removeTier(option.id, index)"
                    >
                      <Trash2Icon class="size-3" />
                    </button>
                  </div>
                  <p class="text-[10px] text-muted-foreground">{{ tierHint(worktimePolicy(props.block, option.id)) }}</p>
                </div>

                <label class="col-span-2 flex items-center gap-1.5 text-[12px]">
                  <input
                    type="checkbox"
                    class="size-3.5"
                    :checked="worktimePolicy(props.block, option.id).prorate"
                    @change="onProrate(option.id, $event)"
                  >
                  <span>入职当年按剩余月份折算</span>
                </label>

                <!--
                  扣减链:这一类假期是从自己的额度里扣,还是和别的假期合成一个池一起扣。
                  链名相同才合池 —— 名字是唯一的连接方式,不靠「同表就同链」这种隐含约定。
                -->
                <div class="col-span-2 mt-1 border-t border-line/60 pt-1.5">
                  <span :class="LABEL">扣减链</span>
                  <div class="mt-1 grid grid-cols-2 gap-1.5">
                    <label :class="FIELD">
                      <span :class="LABEL">自成一池 / 入链</span>
                      <select
                        :class="SELECT"
                        :value="worktimePolicy(props.block, option.id).scope"
                        @change="setPolicyChoice(option.id, 'scope', $event)"
                      >
                        <option value="standalone">自成一池</option>
                        <option value="chain">和别的假期合用</option>
                      </select>
                    </label>
                    <template v-if="worktimePolicy(props.block, option.id).scope === 'chain'">
                      <label :class="FIELD">
                        <span :class="LABEL">链名</span>
                        <input
                          type="text"
                          placeholder="调休"
                          :class="SELECT"
                          :value="worktimePolicy(props.block, option.id).chain"
                          @change="onChainName(option.id, $event)"
                        >
                      </label>
                      <label :class="FIELD">
                        <span :class="LABEL">先扣顺序（小的先）</span>
                        <input
                          type="number"
                          :class="SELECT"
                          :value="worktimePolicy(props.block, option.id).chainOrder"
                          @change="onChainNumber(option.id, 'chainOrder', $event)"
                        >
                      </label>
                      <label v-if="worktimePolicy(props.block, option.id).unit === 'day'" :class="FIELD">
                        <span :class="LABEL">1 天 = 几小时</span>
                        <input
                          type="number"
                          min="0.5"
                          step="0.5"
                          :class="SELECT"
                          :value="worktimePolicy(props.block, option.id).hoursPerDay"
                          @change="onChainNumber(option.id, 'hoursPerDay', $event)"
                        >
                      </label>
                    </template>
                  </div>
                  <p v-if="worktimePolicy(props.block, option.id).scope === 'chain'" class="mt-1 text-[10px] text-muted-foreground">
                    同链名的池合并成一条:一笔使用先扣顺序靠前的池,扣光了才轮到下一个。链上那个从不发额度的池(比如调休)用「自成一池 + 不发额度」配出来即可。
                  </p>
                </div>
              </div>
            </details>
          </template>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>

    <!-- 没有类别列:说清缺什么,而不是渲染一张空台账。 -->
    <p
      v-if="roles.kind === null"
      class="mb-2 rounded-lg border border-dashed border-line bg-muted/30 px-3 py-2.5 text-[12px] text-muted-foreground"
    >
      工时块要一列「类别」（选择列）才能分池 —— 点右上角「设置」选一列。加一个新假期只是给
      这一列的选项里加一项,不用改块。
    </p>

    <template v-else>
      <!-- 多人表:按人切换。单人表不显示这一排。 -->
      <div v-if="report.persons.length > 1" class="mb-2 flex flex-wrap items-center gap-1">
        <button
          type="button"
          class="rounded-full border px-2 py-0.5 text-[11px]"
          :class="personFilter === '' ? 'border-line bg-muted text-foreground' : 'border-transparent text-muted-foreground hover:text-foreground'"
          @click="personFilter = ''"
        >
          全部
        </button>
        <button
          v-for="person in report.persons"
          :key="person"
          type="button"
          class="rounded-full border px-2 py-0.5 text-[11px]"
          :class="personFilter === person ? 'border-line bg-muted text-foreground' : 'border-transparent text-muted-foreground hover:text-foreground'"
          @click="personFilter = person"
        >
          {{ person }}
        </button>
      </div>

      <!-- 链合计:一条扣减链一张。成员按取额度顺序排,「先扣谁」不用猜。 -->
      <div v-if="visibleChains.length > 0" class="mb-1.5 grid gap-1.5" style="grid-template-columns: repeat(auto-fit, minmax(180px, 1fr))">
        <div v-for="chain in visibleChains" :key="chain.key" class="rounded-lg border border-line bg-muted/40 px-3 py-2">
          <div class="truncate text-[11px] text-muted-foreground">{{ chainLabel(chain) }}合计</div>
          <div class="mt-0.5 flex items-baseline gap-1">
            <span class="text-[20px] font-semibold tabular-nums" :class="chain.available < 0 && 'text-destructive'">
              {{ formatQuantity(chain.available) }}
            </span>
            <span class="text-[11px] text-muted-foreground">小时</span>
          </div>
          <div class="truncate text-[11px] text-muted-foreground">{{ chainMembers(chain) }}</div>
        </div>
      </div>

      <!-- 余额卡:每池一张。余额为负(超支)标红 —— 那正是需要被看见的那一格。 -->
      <div class="mb-3 grid gap-1.5" style="grid-template-columns: repeat(auto-fit, minmax(136px, 1fr))">
        <div v-for="pool in visiblePools" :key="pool.key" class="rounded-lg border border-line bg-card px-3 py-2">
          <div class="truncate text-[11px] text-muted-foreground">{{ poolLabel(pool) }}</div>
          <div class="mt-0.5 flex items-baseline gap-1">
            <span class="text-[20px] font-semibold tabular-nums" :class="pool.available < 0 && 'text-destructive'">
              {{ formatQuantity(pool.available) }}
            </span>
            <span class="text-[11px] text-muted-foreground">{{ WORKTIME_UNIT_LABELS[pool.policy.unit] }}</span>
          </div>
          <div class="text-[11px] text-muted-foreground">{{ poolDetail(pool) }}</div>
          <div v-if="pool.soon > 0" class="text-[11px] text-muted-foreground">{{ soonText(pool) }}</div>
        </div>
      </div>

      <div class="table-scrollbar overflow-x-auto rounded-lg border border-line pb-2">
        <table class="w-max min-w-full whitespace-nowrap border-collapse text-[12px]">
          <thead>
            <tr class="border-b border-line bg-muted/40 text-left text-muted-foreground">
              <th class="w-7 px-2 py-1.5 font-normal"></th>
              <th v-for="slot in columnSlots" :key="slot.column.id" class="px-2.5 py-1.5 font-normal" :class="slot.role === 'amount' && 'text-right'">
                {{ slot.column.name }}
              </th>
              <th class="px-2.5 py-1.5 text-right font-normal">余额</th>
              <th class="px-2.5 py-1.5 text-right font-normal">有效期至</th>
            </tr>
          </thead>
          <tbody>
            <tr
              v-for="(item, rowIndex) in displayRows"
              :key="item.row.id"
              :data-row-id="item.row.id"
              class="group/wtrow border-b border-line last:border-b-0"
            >
              <th class="relative w-7 px-2 py-1 text-right align-top font-mono text-[11px] font-normal text-muted-foreground/60">
                <span class="group-hover/wtrow:hidden">{{ rowIndex + 1 }}</span>
                <button
                  type="button"
                  class="absolute inset-y-0 right-1 hidden items-center text-muted-foreground hover:text-destructive group-hover/wtrow:flex"
                  aria-label="删除本行"
                  @click="removeEntry(item.row)"
                >
                  <Trash2Icon class="size-3" />
                </button>
              </th>

              <td
                v-for="slot in columnSlots"
                :key="slot.column.id"
                class="px-2.5 py-1 align-top"
                :class="slot.role === 'amount' && 'text-right tabular-nums'"
              >
                <!-- 勾选格直接切,不需要「点进编辑」那一层。 -->
                <input
                  v-if="slot.column.type === 'checkbox'"
                  type="checkbox"
                  class="size-3.5 align-middle"
                  :checked="dt.cellValue(item.row, slot.column) === true"
                  @change="(event: Event) => toggleCheck(item.row, slot.column, event)"
                >

                <!-- 选择格:自绘下拉(Tab 到就展开、↑↓ 移、回车选、Esc 收而焦点不丢)。 -->
                <OptionCell
                  v-else-if="slot.column.type === 'select'"
                  class="rounded px-0.5 hover:bg-muted/60"
                  :class="cellText(item.row, slot.column) === '' && 'text-muted-foreground'"
                  :model-value="String(dt.cellValue(item.row, slot.column) ?? '')"
                  :options="slot.column.options"
                  @pick="pickOption(item.row, slot.column, $event)"
                />

                <!--
                  格值按钮始终留在文档流里,输入框绝对定位浮在它上面 —— 与账目块同一手法:
                  表格是 auto 布局,换成输入框会把列撑宽,点一下整张表横向抖一次。
                -->
                <span v-else class="relative block min-h-[18px] w-full min-w-0">
                  <button
                    type="button"
                    class="block min-h-[18px] w-full min-w-0 rounded px-0.5 hover:bg-muted/60"
                    :class="[slot.role === 'amount' ? 'text-right' : 'cursor-text text-left', editing === cellKey(item.row, slot.column) && 'invisible']"
                    @mousedown.prevent
                    @click="editing = cellKey(item.row, slot.column)"
                    @focus="editing = cellKey(item.row, slot.column)"
                  >
                    {{ slot.role === "amount" ? amountText(item.row) : cellText(item.row, slot.column) }}
                  </button>

                  <input
                    v-if="editing === cellKey(item.row, slot.column)"
                    :ref="focusOnMount"
                    :type="slot.column.type === 'date' ? 'date' : 'text'"
                    class="absolute inset-0 rounded bg-transparent px-0.5 text-[12px] outline-none"
                    :class="slot.role === 'amount' ? 'text-right tabular-nums' : 'text-left'"
                    :value="editText(item.row, slot.column)"
                    @keydown.enter.prevent="commitOnEnter(item.row, slot.column, $event)"
                    @blur="commitOnBlur(item.row, slot.column, $event)"
                  >
                </span>
              </td>

              <td
                class="px-2.5 py-1 text-right tabular-nums text-muted-foreground"
                :title="drawsText(item.info)"
              >{{ balanceText(item.info) }}</td>
              <td class="px-2.5 py-1 text-right text-[11px] tabular-nums text-muted-foreground">{{ expiresText(item.info) }}</td>
            </tr>

            <tr v-if="rows.length === 0">
              <td :colspan="columnSlots.length + 3" class="px-2.5 py-4 text-center text-muted-foreground">
                这张表还没有工时记录 —— 点右上角「记一笔」开始记。
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <!-- 批次明细:每笔额度从哪来、还剩多少、什么时候到期。默认收起,设置里打开。 -->
      <div v-if="props.block.showLots" class="mt-3 space-y-3">
        <div v-for="pool in visiblePools" :key="pool.key">
          <template v-if="pool.lots.length > 0">
            <div class="mb-1 text-[11px] text-muted-foreground">{{ poolLabel(pool) }} · {{ pool.lots.length }} 笔额度</div>
            <div class="table-scrollbar overflow-x-auto rounded-lg border border-line">
              <table class="w-full border-collapse text-[12px]">
                <thead>
                  <tr class="border-b border-line bg-muted/30 text-left text-muted-foreground">
                    <th class="px-2.5 py-1 font-normal">产生日</th>
                    <th class="px-2.5 py-1 font-normal">说明</th>
                    <th class="px-2.5 py-1 text-right font-normal">额度</th>
                    <th class="px-2.5 py-1 text-right font-normal">已用</th>
                    <th class="px-2.5 py-1 text-right font-normal">剩余</th>
                    <th class="px-2.5 py-1 text-right font-normal">到期日</th>
                  </tr>
                </thead>
                <tbody>
                  <tr
                    v-for="lot in pool.lots"
                    :key="lot.key"
                    class="border-b border-line last:border-b-0"
                    :class="!lotAlive(lot) && 'opacity-45'"
                  >
                    <td class="px-2.5 py-1 tabular-nums text-muted-foreground">{{ lot.date }}</td>
                    <td class="px-2.5 py-1">{{ lot.label }}</td>
                    <td class="px-2.5 py-1 text-right tabular-nums">{{ formatQuantity(lot.amount) }}</td>
                    <td class="px-2.5 py-1 text-right tabular-nums text-muted-foreground">{{ formatQuantity(lot.used) }}</td>
                    <td class="px-2.5 py-1 text-right tabular-nums">{{ formatQuantity(lotRemaining(lot)) }}</td>
                    <td class="px-2.5 py-1 text-right text-[11px] tabular-nums text-muted-foreground">
                      {{ lot.expiresOn === "" ? "不过期" : lot.expiresOn }}
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          </template>
        </div>
      </div>
    </template>

    <!-- 记一笔表单。挂在块内,读的是同一份 rows —— 预览用的就是提交后要跑的同一套报表。 -->
    <WorktimeEntryDialog
      :open="entryOpen"
      :block="props.block"
      :columns="columns"
      :rows="rows"
      :today="today"
      @close="entryOpen = false"
      @submit="submitEntry"
    />
  </div>
</template>

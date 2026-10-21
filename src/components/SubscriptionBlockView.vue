<script setup lang="ts">
import type { DataRow } from "@/types/data-table"
import type { SubscriptionBlock } from "@/types/workspace"
import type { SubscriptionRole, SubscriptionState, SubscriptionStatus } from "@/lib/subscription"
import { computed } from "vue"
import { DatabaseIcon, Settings2Icon } from "@lucide/vue"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import TableRefNotice from "@/components/TableRefNotice.vue"
import { useWorkspace } from "@/composables/useWorkspace"
import { useTableEntry } from "@/composables/useTableEntry"
import * as dt from "@/lib/data-table"
import {
  SUBSCRIPTION_ROLE_FIELDS,
  SUBSCRIPTION_ROLE_LABELS,
  SUBSCRIPTION_ROLES,
  cycleProgress,
  daysBetween,
  formatPrice,
  localToday,
  sortSubscriptions,
  subscriptionDate,
  subscriptionFlag,
  subscriptionIcon,
  subscriptionIsEmpty,
  subscriptionName,
  subscriptionNumber,
  subscriptionRoles,
  subscriptionStatus,
  subscriptionText,
  summarizeSubscriptions,
} from "@/lib/subscription"

/**
 * 订阅块:一张数据表 → 一墙订阅卡。
 *
 * 每行回答一组固定问题:是什么(名称 / 图标)、多少钱(金额 / 周期)、什么时候
 * 开始与到期、试用到哪天、是否自动续费 / 已取消、累计付了多少。十列的角色由
 * `lib/subscription` 的字段映射解析(显式设置优先,留空按列名与类型识别),这里只
 * 负责把参数排开。
 *
 * 状态、剩余天数、月均 / 年均支出都是**视图派生值** —— 随「今天」变化,不写盘。
 * 汇总条与卡片上的支出口径和导出快照共用 `summarizeSubscriptions`,两边不会算出
 * 两个数。取消的行沉底并降饱和,不藏起来:取消记录本身也是订阅管理要看到的信息。
 *
 * 就地管理只开放两个布尔位(自动续费 / 已取消),其余字段去数据表改 —— 金额、日期、
 * 周期都有各自的编辑几何,塞进卡片比打开表更费解。改动走 `change`,与笔记共用保存出口。
 */
const props = defineProps<{ block: SubscriptionBlock }>()

const { openFile, updateBlockSettings } = useWorkspace()

const { state, table, columns, rows, change } = useTableEntry(() => props.block.path)

/** 页面打开时的本机日期。跨零点不自动翻页 —— 订阅状态不需要秒级刷新。 */
const today = localToday()

const roles = computed(() => subscriptionRoles(columns.value, props.block))

const orderedRows = computed(() =>
  sortSubscriptions(rows.value, roles.value).filter((row) => !subscriptionIsEmpty(row, roles.value)),
)

const summary = computed(() => summarizeSubscriptions(rows.value, roles.value, today))

function nameOf(row: DataRow): string {
  return subscriptionName(row, roles.value)
}

function iconOf(row: DataRow): string {
  return subscriptionIcon(row, roles.value)
}

function initialOf(row: DataRow): string {
  return Array.from(nameOf(row).trim())[0] ?? "?"
}

function amountText(row: DataRow): string {
  const value = subscriptionNumber(row, roles.value.amount)
  return value === null ? "" : formatPrice(value)
}

function paidText(row: DataRow): string {
  const value = subscriptionNumber(row, roles.value.paid)
  return value === null ? "" : formatPrice(value)
}

function cycleText(row: DataRow): string {
  return subscriptionText(row, roles.value.cycle)
}

function startText(row: DataRow): string {
  return subscriptionDate(row, roles.value.start)
}

function trialText(row: DataRow): string {
  return subscriptionDate(row, roles.value.trialEnd)
}

function endText(row: DataRow): string {
  return subscriptionDate(row, roles.value.end)
}

function cancelledOf(row: DataRow): boolean {
  return subscriptionFlag(row, roles.value.cancelled)
}

function autoRenewOf(row: DataRow): boolean {
  return subscriptionFlag(row, roles.value.autoRenew)
}

function statusOf(row: DataRow): SubscriptionStatus {
  return subscriptionStatus(row, roles.value, today)
}

/** 距某日期还有多久。已取消的行不显示 —— 倒计时对取消记录没有意义。 */
function remainingFor(date: string, row: DataRow): string {
  if (date === "" || cancelledOf(row)) return ""
  const days = daysBetween(today, date)
  if (days === null) return ""
  if (days < 0) return `已过 ${Math.abs(days)} 天`
  if (days === 0) return "今天"
  return `剩 ${days} 天`
}

/** 当前周期进度。试用行按试用期量,其余按正式周期量。 */
function progressValue(row: DataRow): number | null {
  if (cancelledOf(row)) return null
  const start = startText(row)
  if (start === "") return null
  const end = statusOf(row).kind === "trial" ? trialText(row) : endText(row)
  return end === "" ? null : cycleProgress(start, end, today)
}

function progressTone(row: DataRow): string {
  return PROGRESS_TONES[statusOf(row).kind]
}

const STATUS_TONES: Record<SubscriptionState, string> = {
  active: "bg-[#e8f5ec] text-[#1c7a3e] dark:bg-[#163a26] dark:text-[#7ed3a0]",
  trial: "bg-selection text-selection-foreground",
  soon: "bg-[#fdf2d0] text-[#8a5a00] dark:bg-[#3a2d12] dark:text-[#e8b45a]",
  expired: "bg-destructive/10 text-destructive",
  cancelled: "bg-muted text-muted-foreground",
}

const PROGRESS_TONES: Record<SubscriptionState, string> = {
  active: "bg-[#3aa55d] dark:bg-[#65c98a]",
  trial: "bg-brand",
  soon: "bg-[#d99a22] dark:bg-[#e8b45a]",
  expired: "bg-destructive",
  cancelled: "bg-muted-foreground",
}

/** 取消的卡降饱和;七天内到期的加一圈很淡的暖色,扫一眼就能捞出来。 */
function cardTone(row: DataRow): string {
  const status = statusOf(row)
  if (status.kind === "cancelled") return "opacity-65"
  const urgent = status.kind === "soon" || (status.kind === "trial" && status.days !== null && status.days <= 7)
  return urgent ? "ring-1 ring-[#d99a22]/30" : ""
}

function progressWidth(row: DataRow): string {
  const value = progressValue(row)
  return `${Math.round((value ?? 0) * 100)}%`
}

// ---- 就地勾选 ----

function toggleFlag(row: DataRow, role: SubscriptionRole, event: Event): void {
  const column = roles.value[role]
  if (column === null) return
  const target = event.target
  if (!(target instanceof HTMLInputElement)) return
  void change((current) => dt.replaceRow(current, dt.setCell(row, column.id, target.checked)))
}

// ---- 字段映射设置 ----

const ROLE_ITEMS = SUBSCRIPTION_ROLES.map((role) => ({ role, label: SUBSCRIPTION_ROLE_LABELS[role] }))

/** 下拉里展示的值。空串 = 自动识别。 */
function roleValue(role: SubscriptionRole): string {
  return props.block[SUBSCRIPTION_ROLE_FIELDS[role]]
}

function setRole(role: SubscriptionRole, event: Event): void {
  const target = event.target
  if (!(target instanceof HTMLSelectElement)) return
  const value = target.value
  switch (role) {
    case "name":
      updateBlockSettings(props.block.id, { nameColumnId: value })
      break
    case "icon":
      updateBlockSettings(props.block.id, { iconColumnId: value })
      break
    case "amount":
      updateBlockSettings(props.block.id, { amountColumnId: value })
      break
    case "cycle":
      updateBlockSettings(props.block.id, { cycleColumnId: value })
      break
    case "autoRenew":
      updateBlockSettings(props.block.id, { autoRenewColumnId: value })
      break
    case "trialEnd":
      updateBlockSettings(props.block.id, { trialEndColumnId: value })
      break
    case "start":
      updateBlockSettings(props.block.id, { startColumnId: value })
      break
    case "end":
      updateBlockSettings(props.block.id, { endColumnId: value })
      break
    case "cancelled":
      updateBlockSettings(props.block.id, { cancelledColumnId: value })
      break
    case "paid":
      updateBlockSettings(props.block.id, { paidColumnId: value })
      break
  }
}

const MENU = "w-[224px] rounded-island p-1.5 shadow-pop ring-0"
const SELECT = "w-full cursor-pointer rounded border border-line bg-transparent px-1.5 py-1 text-[12px] outline-none"

function openTable() {
  if (props.block.path === "") return
  openFile(props.block.path)
}
</script>

<template>
  <!-- 空指针:如实说没指定,而不是永远转圈。 -->
  <TableRefNotice v-if="props.block.path === ''" kind="unset" label="订阅" />

  <!-- 引用的文件读不到:提示态,不是错误态。 -->
  <TableRefNotice
    v-else-if="state === 'missing' || state === 'failed'"
    kind="missing"
    label="订阅"
    :path="props.block.path"
  />

  <!-- 还没读完。 -->
  <TableRefNotice v-else-if="table === null" kind="loading" label="订阅" />

  <div v-else class="group/subs relative my-4">
    <!-- 块操作入口:右上角,悬停浮现。 -->
    <div class="absolute -top-2 right-0 z-20 flex items-center gap-1 opacity-0 transition-opacity group-hover/subs:opacity-100 focus-within:opacity-100">
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
        <DropdownMenuContent :class="[MENU, 'max-h-[72vh] overflow-y-auto']" align="end">
          <DropdownMenuLabel class="px-2 pb-1 pt-1.5 text-[11px] font-normal text-muted-foreground">字段映射</DropdownMenuLabel>
          <div v-for="item in ROLE_ITEMS" :key="item.role" class="px-2 pb-1.5">
            <div class="mb-0.5 text-[10.5px] text-muted-foreground">{{ item.label }}</div>
            <select :class="SELECT" :value="roleValue(item.role)" @change="setRole(item.role, $event)">
              <option value="">自动识别</option>
              <option v-for="column in columns" :key="column.id" :value="column.id">{{ column.name }}</option>
            </select>
          </div>
          <DropdownMenuSeparator class="mx-2 my-1 bg-line" />
          <div class="px-2 py-1 text-[10.5px] leading-relaxed text-muted-foreground">
            留「自动识别」时按列名与列类型找；表里的列改名或删除后也会自动退让。
          </div>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>

    <!-- 名称列都没认出来:卡片照常列参数,但先说明缺的是哪一环。 -->
    <p
      v-if="roles.name === null"
      class="mb-2 rounded-lg border border-dashed border-line bg-muted/30 px-3 py-2.5 text-[12px] text-muted-foreground"
    >
      没有认出名称列 —— 点右上角「设置」指定一列,卡片标题才会有名字。
    </p>

    <!-- 顶部汇总:在订数量、按周期折算的月 / 年支出、最近的到期日。 -->
    <div
      v-if="orderedRows.length > 0"
      class="mb-3 flex flex-wrap items-center gap-x-5 gap-y-1.5 rounded-xl border border-line bg-muted/30 px-3.5 py-2.5"
    >
      <span class="text-[13px] font-medium">{{ summary.live }} 项订阅</span>
      <span v-if="summary.monthly > 0" class="text-[12px] text-muted-foreground">
        每月约 <span class="font-medium tabular-nums text-foreground/85">{{ formatPrice(summary.monthly) }}</span>
      </span>
      <span v-if="summary.yearly > 0" class="text-[12px] text-muted-foreground">
        每年约 <span class="font-medium tabular-nums text-foreground/85">{{ formatPrice(summary.yearly) }}</span>
      </span>
      <span v-if="summary.cancelled > 0" class="text-[12px] text-muted-foreground">已取消 {{ summary.cancelled }}</span>
      <span v-if="summary.nextEnd !== ''" class="ml-auto text-[12px] text-muted-foreground">
        最近到期 <span class="tabular-nums text-foreground/85">{{ summary.nextEnd }}</span>
        <span class="ml-1 text-foreground/70">{{ summary.nextName }}</span>
      </span>
    </div>

    <p v-if="summary.unknownCycle > 0" class="mb-2 text-[11px] text-muted-foreground">
      另有 {{ summary.unknownCycle }} 项认不出周期，未计入月 / 年支出。
    </p>

    <!-- 空表:与账目同一句引导。 -->
    <div
      v-if="orderedRows.length === 0"
      class="rounded-xl border border-dashed border-line px-4 py-8 text-center text-[12px] text-muted-foreground"
    >
      这张表还没有订阅 —— 点右上角「打开数据表」添加一条。
    </div>

    <div v-else class="grid gap-3" style="grid-template-columns: repeat(auto-fill, minmax(216px, 1fr))">
      <article
        v-for="row in orderedRows"
        :key="row.id"
        class="rounded-xl border border-line bg-muted/20 p-3.5 transition-colors hover:border-foreground/20"
        :class="cardTone(row)"
      >
        <div class="flex items-start gap-3">
          <div class="flex size-9 shrink-0 items-center justify-center overflow-hidden rounded-[9px] bg-muted/60 text-[15px] font-semibold text-muted-foreground">
            <img
              v-if="iconOf(row)"
              :src="iconOf(row)"
              alt=""
              loading="lazy"
              decoding="async"
              class="size-full object-cover"
            >
            <span v-else>{{ initialOf(row) }}</span>
          </div>

          <div class="min-w-0 flex-1">
            <div class="flex items-start justify-between gap-2">
              <h4 class="truncate text-[13px] font-medium leading-snug">{{ nameOf(row) }}</h4>
              <span class="shrink-0 rounded-full px-2 py-0.5 text-[10px] font-medium" :class="STATUS_TONES[statusOf(row).kind]">
                {{ statusOf(row).label }}
              </span>
            </div>
            <div v-if="amountText(row)" class="mt-1 flex items-baseline gap-1">
              <span class="text-[20px] font-semibold leading-none tabular-nums">{{ amountText(row) }}</span>
              <span v-if="cycleText(row)" class="text-[11px] text-muted-foreground">/ {{ cycleText(row) }}</span>
            </div>
            <div v-else-if="cycleText(row)" class="mt-1 text-[12px] text-muted-foreground">{{ cycleText(row) }}</div>
          </div>
        </div>

        <div class="mt-3 grid gap-0.5 text-[11.5px] text-muted-foreground">
          <div v-if="startText(row)" class="flex justify-between gap-2">
            <span>开始</span>
            <span class="tabular-nums text-foreground/75">{{ startText(row) }}</span>
          </div>
          <!-- 试用到期与正式到期同一天时只留一行 —— 参考表的试用记录就是这样,不必重复。 -->
          <div v-if="trialText(row) && trialText(row) !== endText(row)" class="flex justify-between gap-2">
            <span>试用到期</span>
            <span class="tabular-nums text-foreground/75">
              {{ trialText(row) }}<span v-if="remainingFor(trialText(row), row)" class="ml-1 text-[10.5px]">{{ remainingFor(trialText(row), row) }}</span>
            </span>
          </div>
          <div v-if="endText(row)" class="flex justify-between gap-2">
            <span>到期</span>
            <span class="tabular-nums text-foreground/75">
              {{ endText(row) }}<span v-if="remainingFor(endText(row), row)" class="ml-1 text-[10.5px]">{{ remainingFor(endText(row), row) }}</span>
            </span>
          </div>
          <div v-if="paidText(row)" class="flex justify-between gap-2">
            <span>累计支付</span>
            <span class="tabular-nums text-foreground/75">{{ paidText(row) }}</span>
          </div>
        </div>

        <div v-if="progressValue(row) !== null" class="mt-2.5 h-[3px] overflow-hidden rounded-full bg-muted-strong">
          <div class="h-full rounded-full" :class="progressTone(row)" :style="{ width: progressWidth(row) }"></div>
        </div>

        <div
          v-if="roles.autoRenew !== null || roles.cancelled !== null"
          class="mt-3 flex items-center gap-3 border-t border-line pt-2 text-[11px] text-muted-foreground"
        >
          <label v-if="roles.autoRenew !== null" class="flex cursor-pointer items-center gap-1.5">
            <input
              type="checkbox"
              class="size-3 accent-brand"
              :checked="autoRenewOf(row)"
              @change="toggleFlag(row, 'autoRenew', $event)"
            >
            自动续费
          </label>
          <label v-if="roles.cancelled !== null" class="flex cursor-pointer items-center gap-1.5">
            <input
              type="checkbox"
              class="size-3 accent-brand"
              :checked="cancelledOf(row)"
              @change="toggleFlag(row, 'cancelled', $event)"
            >
            已取消
          </label>
        </div>
      </article>
    </div>
  </div>
</template>

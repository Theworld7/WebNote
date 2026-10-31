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
import { markImageBroken, usableImage } from "@/lib/broken-images"
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
  subscriptionCardAccent,
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

const { openFile, updateBlockSettings, rebindTable, tablePaths } = useWorkspace()

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
  return usableImage(subscriptionIcon(row, roles.value))
}

/** 图标列的原始地址（不过滤失败过的）。`@error` 拿它记账，图一坏就退回首字母。 */
function iconSourceOf(row: DataRow): string {
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
  active: "bg-status-ok text-status-ok-foreground",
  trial: "bg-tint text-tint-foreground",
  soon: "bg-status-warn text-status-warn-foreground",
  expired: "bg-destructive/10 text-destructive",
  cancelled: "bg-muted text-muted-foreground",
}

/** 进度条只画色块不写字，直接用同一支状态前景色（图形级只需 3:1，实测远超）。
    原来另取了两支更亮的 hex —— 同一件事两套值，深色下还得各调一次。 */
const PROGRESS_TONES: Record<SubscriptionState, string> = {
  active: "bg-status-ok-foreground",
  trial: "bg-brand",
  soon: "bg-status-warn-foreground",
  expired: "bg-destructive",
  cancelled: "bg-muted-foreground",
}

/** 七天内到期的加一圈很淡的暖色,扫一眼就能捞出来;取消态单独降饱和。 */
function cardTone(row: DataRow): string {
  const status = statusOf(row)
  const urgent = status.kind === "soon" || (status.kind === "trial" && status.days !== null && status.days <= 7)
  return urgent ? "is-urgent" : ""
}

/** 卡片色相由行 id 哈希得出,只作装饰;可在浅色与深色下共用。 */
function cardStyle(row: DataRow): Record<string, string> {
  return { "--sub-accent": subscriptionCardAccent(row.id) }
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

const MENU = "w-[224px] rounded-island p-1.5 shadow-pop ring-1 ring-line/70"
const SELECT = "w-full cursor-pointer rounded border border-line bg-transparent px-1.5 py-1 text-[12px] outline-none"

function openTable() {
  if (props.block.path === "") return
  openFile(props.block.path)
}
</script>

<template>
  <!-- 空指针:如实说没指定,而不是永远转圈。 -->
  <TableRefNotice v-if="props.block.path === ''" kind="unset" label="订阅" />

  <!-- 引用的文件读不到:提示态,不是错误态 —— 提示条自带一条重新指向的出路。 -->
  <TableRefNotice
    v-else-if="state === 'missing' || state === 'failed'"
    kind="missing"
    label="订阅"
    :path="props.block.path"
    :tables="tablePaths"
    @reselect="(path: string) => rebindTable(props.block.id, path)"
  />

  <!-- 还没读完。 -->
  <TableRefNotice v-else-if="table === null" kind="loading" label="订阅" />

  <div v-else class="group/subs relative my-4">
    <!-- 块操作入口:右上角,悬停浮现。 -->
    <div class="absolute -top-2 right-0 z-20 flex items-center gap-1 opacity-0 transition-opacity group-hover/subs:opacity-100 focus-within:opacity-100">
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
          <Button variant="ghost" size="sm" class="h-6 gap-1 rounded-full bg-popover px-2 text-[12px] text-muted-foreground hover:text-foreground">
            <Settings2Icon class="size-3" />设置
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent :class="[MENU, 'max-h-[72vh] overflow-y-auto']" align="end">
          <DropdownMenuLabel class="px-2 pb-1 pt-1.5 text-[11px] font-normal text-muted-foreground">字段映射</DropdownMenuLabel>
          <div v-for="item in ROLE_ITEMS" :key="item.role" class="px-2 pb-1.5">
            <div class="mb-0.5 text-[11px] text-muted-foreground">{{ item.label }}</div>
            <select :class="SELECT" :value="roleValue(item.role)" @change="setRole(item.role, $event)">
              <option value="">自动识别</option>
              <option v-for="column in columns" :key="column.id" :value="column.id">{{ column.name }}</option>
            </select>
          </div>
          <DropdownMenuSeparator class="mx-2 my-1 bg-line" />
          <div class="px-2 py-1 text-[11px] leading-relaxed text-muted-foreground">
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

    <!-- 顶部汇总:一块平面白卡,内嵌分隔线分栏,数字比标签先被看到。 -->
    <div v-if="orderedRows.length > 0" class="subs-summary">
      <div class="subs-stat">
        <span class="subs-stat-label">有效订阅</span>
        <span class="subs-stat-value">{{ summary.live }}<small>项</small></span>
      </div>
      <div v-if="summary.monthly > 0" class="subs-stat">
        <span class="subs-stat-label">月均支出</span>
        <span class="subs-stat-value">
          {{ formatPrice(summary.monthly) }}
          <small v-if="summary.yearly > 0">每年 {{ formatPrice(summary.yearly) }}</small>
        </span>
      </div>
      <div v-if="summary.cancelled > 0" class="subs-stat">
        <span class="subs-stat-label">已取消</span>
        <span class="subs-stat-value">{{ summary.cancelled }}<small>项</small></span>
      </div>
      <div v-if="summary.nextEnd !== ''" class="subs-stat">
        <!-- 名称跟着标签走:数字行只放日期,四栏挤在一起时不会截成「微信…」。 -->
        <span class="subs-stat-label">
          最近到期<span v-if="summary.nextName !== ''" class="subs-stat-note"> · {{ summary.nextName }}</span>
        </span>
        <span class="subs-stat-value subs-stat-date">{{ summary.nextEnd }}</span>
      </div>
    </div>

    <p v-if="summary.unknownCycle > 0" class="mb-2.5 text-[11px] text-muted-foreground">
      另有 {{ summary.unknownCycle }} 项认不出周期，未计入月 / 年支出。
    </p>

    <!-- 空表:与账目同一句引导。 -->
    <div
      v-if="orderedRows.length === 0"
      class="rounded-xl border border-dashed border-line px-4 py-8 text-center text-[12px] text-muted-foreground"
    >
      这张表还没有订阅 —— 点右上角「打开数据表」添加一条。
    </div>

    <div v-else class="subs-grid">
      <article
        v-for="row in orderedRows"
        :key="row.id"
        class="subs-card"
        :class="[cardTone(row), { 'is-cancelled': cancelledOf(row) }]"
        :style="cardStyle(row)"
      >
        <div class="subs-head">
          <div class="subs-identity">
            <div class="subs-logo">
              <img
                v-if="iconOf(row)"
                :src="iconOf(row)"
                alt=""
                loading="lazy"
                decoding="async"
                @error="markImageBroken(iconSourceOf(row))"
              />
              <span v-else>{{ initialOf(row) }}</span>
            </div>
            <div class="subs-heading">
              <h4 class="subs-name">{{ nameOf(row) }}</h4>
              <span class="subs-caption">订阅</span>
            </div>
          </div>
          <span class="subs-status shrink-0 rounded-full px-2 py-0.5 text-[10px] font-medium" :class="STATUS_TONES[statusOf(row).kind]">
            {{ statusOf(row).label }}
          </span>
        </div>

        <div v-if="amountText(row)" class="subs-price-row">
          <span class="subs-price">{{ amountText(row) }}</span>
          <span v-if="cycleText(row)" class="subs-cycle">/ {{ cycleText(row) }}</span>
        </div>
        <div v-else-if="cycleText(row)" class="subs-cycle-only">{{ cycleText(row) }}</div>

        <div v-if="progressValue(row) !== null" class="subs-progress">
          <div :class="progressTone(row)" :style="{ width: progressWidth(row) }"></div>
        </div>

        <div v-if="startText(row) || endText(row)" class="subs-dates">
          <span class="subs-dates-label">有效日期</span>
          <div class="subs-dates-row">
            <span class="subs-range">
              <span>{{ startText(row) || "—" }}</span>
              <span class="subs-arrow">→</span>
              <span>{{ endText(row) || "至今" }}</span>
            </span>
            <span v-if="endText(row) && remainingFor(endText(row), row)" class="subs-remaining">{{ remainingFor(endText(row), row) }}</span>
          </div>
          <!-- 试用到期与正式到期同一天时只留一行 —— 参考表的试用记录就是这样,不必重复。 -->
          <div v-if="trialText(row) && trialText(row) !== endText(row)" class="subs-trial">
            <span>试用至 {{ trialText(row) }}</span>
            <span v-if="remainingFor(trialText(row), row)">{{ remainingFor(trialText(row), row) }}</span>
          </div>
        </div>

        <div v-if="paidText(row) || roles.autoRenew !== null || roles.cancelled !== null" class="subs-foot">
          <div v-if="paidText(row)" class="subs-paid">
            <span>累计支付</span>
            <strong>{{ paidText(row) }}</strong>
          </div>
          <div v-if="roles.autoRenew !== null || roles.cancelled !== null" class="subs-controls">
            <label v-if="roles.autoRenew !== null">
              <input
                type="checkbox"
                class="size-3 accent-brand"
                :checked="autoRenewOf(row)"
                @change="toggleFlag(row, 'autoRenew', $event)"
              >
              自动续费
            </label>
            <label v-if="roles.cancelled !== null">
              <input
                type="checkbox"
                class="size-3 accent-brand"
                :checked="cancelledOf(row)"
                @change="toggleFlag(row, 'cancelled', $event)"
              >
              已取消
            </label>
          </div>
        </div>
      </article>
    </div>
  </div>
</template>

<style scoped>
.subs-summary {
  display: grid;
  grid-auto-flow: column;
  grid-auto-columns: minmax(0, 1fr);
  margin-bottom: 14px;
  overflow: hidden;
  border: 1px solid var(--color-line);
  border-radius: 18px;
  background: var(--card);
  box-shadow: var(--elev-block);
}

.subs-stat {
  position: relative;
  min-width: 0;
  padding: 16px 20px 17px;
}

/* 分隔线上下各留 16px,不顶到卡片边缘 —— 这条留白是「白卡」不像表格的关键。 */
.subs-stat + .subs-stat::before {
  position: absolute;
  top: 16px;
  bottom: 16px;
  left: 0;
  width: 1px;
  content: "";
  background: var(--color-line);
}

.subs-stat-label {
  display: block;
  margin-bottom: 4px;
  overflow: hidden;
  color: var(--muted-foreground);
  font-size: 11px;
  letter-spacing: 0.04em;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.subs-stat-value {
  display: flex;
  min-width: 0;
  align-items: baseline;
  gap: 4px;
  font-size: 23px;
  font-weight: 600;
  letter-spacing: -0.035em;
  line-height: 1.15;
  font-variant-numeric: tabular-nums;
}

.subs-stat-value small {
  min-width: 0;
  overflow: hidden;
  color: var(--muted-foreground);
  font-size: 11px;
  font-weight: 500;
  letter-spacing: 0;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* 日期单独一档字号(它最长),仍禁止换行 —— 连字符处断行会把日期挤成两行方块。 */
.subs-stat-date {
  flex-wrap: nowrap;
  font-size: 19px;
  letter-spacing: -0.02em;
  white-space: nowrap;
}

/* 标签尾随的补充说明(如即将到期的服务名),比标签再淡一点。 */
.subs-stat-note {
  opacity: 0.72;
}

.subs-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(248px, 1fr));
  gap: 14px;
}

.subs-card {
  --sub-accent: var(--color-brand);
  position: relative;
  isolation: isolate;
  display: flex;
  min-height: 216px;
  flex-direction: column;
  overflow: hidden;
  padding: 18px;
  border: 1px solid color-mix(in srgb, var(--sub-accent) 20%, var(--color-line));
  border-radius: 18px;
  background:
    radial-gradient(
      circle at 100% 0%,
      color-mix(in srgb, var(--sub-accent) 15%, transparent),
      transparent 46%
    ),
    linear-gradient(
      145deg,
      color-mix(in srgb, var(--card) 95%, var(--sub-accent)),
      var(--card) 68%
    );
  box-shadow: var(--elev-block);
  transition:
    border-color var(--duration-base) ease,
    box-shadow var(--duration-base) ease,
    transform var(--duration-base) ease,
    opacity var(--duration-base) ease;
}

.subs-card::before {
  position: absolute;
  right: -58px;
  bottom: -86px;
  z-index: -1;
  width: 190px;
  height: 190px;
  border: 1px solid color-mix(in srgb, var(--sub-accent) 14%, transparent);
  border-radius: 50%;
  box-shadow:
    0 0 0 26px color-mix(in srgb, var(--sub-accent) 4%, transparent),
    0 0 0 52px color-mix(in srgb, var(--sub-accent) 3%, transparent);
  content: "";
  pointer-events: none;
}

.subs-card:hover {
  border-color: color-mix(in srgb, var(--sub-accent) 34%, var(--color-line));
  box-shadow: var(--elev-island);
  transform: translateY(-2px);
}

.subs-card.is-urgent {
  border-color: color-mix(in srgb, var(--color-status-warn-foreground) 34%, var(--color-line));
}

.subs-card.is-cancelled {
  opacity: 0.72;
  filter: saturate(0.45);
}

.subs-card.is-cancelled:hover {
  opacity: 0.92;
}

.subs-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
}

.subs-identity {
  display: flex;
  min-width: 0;
  align-items: center;
  gap: 11px;
}

.subs-logo {
  display: grid;
  width: 44px;
  height: 44px;
  flex: none;
  place-items: center;
  overflow: hidden;
  border: 1px solid color-mix(in srgb, var(--sub-accent) 16%, transparent);
  border-radius: 13px;
  color: var(--sub-accent);
  background: color-mix(in srgb, var(--sub-accent) 11%, var(--card));
  box-shadow: inset 0 1px 0 color-mix(in srgb, white 55%, transparent);
  font-size: 16px;
  font-weight: 700;
}

.subs-logo img {
  display: block;
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.subs-heading {
  min-width: 0;
}

.subs-name {
  margin: 0;
  overflow: hidden;
  font-size: 14px;
  font-weight: 600;
  letter-spacing: -0.01em;
  line-height: 1.35;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.subs-caption {
  display: block;
  margin-top: 2px;
  color: var(--muted-foreground);
  font-size: 9px;
  font-weight: 600;
  letter-spacing: 0.12em;
  line-height: 1.2;
}

.subs-status {
  line-height: 1.5;
}

.subs-price-row {
  display: flex;
  min-height: 31px;
  align-items: baseline;
  gap: 5px;
  margin-top: 21px;
}

.subs-price {
  font-size: 31px;
  font-weight: 600;
  letter-spacing: -0.055em;
  line-height: 1;
  font-variant-numeric: tabular-nums;
}

.subs-cycle {
  color: var(--muted-foreground);
  font-size: 11px;
}

.subs-cycle-only {
  margin-top: 21px;
  color: var(--muted-foreground);
  font-size: 12px;
}

.subs-progress {
  height: 3px;
  margin-top: 18px;
  overflow: hidden;
  border-radius: 999px;
  background: color-mix(in srgb, var(--sub-accent) 10%, var(--color-muted-strong));
}

.subs-progress > div {
  height: 100%;
  border-radius: inherit;
  transition: width var(--duration-panel) ease;
}

.subs-dates {
  margin-top: 15px;
}

.subs-dates-label {
  display: block;
  color: var(--muted-foreground);
  font-size: 9px;
  letter-spacing: 0.04em;
}

.subs-dates-row {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 4px 8px;
  margin-top: 2px;
}

.subs-range {
  display: flex;
  align-items: center;
  gap: 5px;
  color: color-mix(in srgb, var(--foreground) 78%, transparent);
  font-size: 11px;
  font-variant-numeric: tabular-nums;
}

.subs-arrow {
  color: var(--muted-foreground);
  font-size: 9px;
}

.subs-remaining {
  padding: 1px 6px;
  border-radius: 999px;
  color: var(--muted-foreground);
  background: color-mix(in srgb, var(--sub-accent) 8%, transparent);
  font-size: 9px;
  font-variant-numeric: tabular-nums;
}

.subs-trial {
  display: flex;
  flex-wrap: wrap;
  justify-content: space-between;
  gap: 4px 8px;
  margin-top: 5px;
  color: var(--muted-foreground);
  font-size: 10px;
  font-variant-numeric: tabular-nums;
}

.subs-foot {
  display: flex;
  align-items: flex-end;
  justify-content: space-between;
  gap: 10px;
  margin-top: auto;
  padding-top: 12px;
  border-top: 1px solid color-mix(in srgb, var(--color-line) 80%, transparent);
}

.subs-paid {
  display: flex;
  order: 2;
  margin-left: auto;
  flex-direction: column;
  gap: 1px;
  text-align: right;
}

.subs-paid span {
  color: var(--muted-foreground);
  font-size: 9px;
  letter-spacing: 0.04em;
}

.subs-paid strong {
  font-size: 11px;
  font-weight: 600;
  font-variant-numeric: tabular-nums;
}

.subs-controls {
  display: flex;
  order: 1;
  flex-wrap: wrap;
  align-items: center;
  gap: 10px;
  color: var(--muted-foreground);
  font-size: 10px;
}

.subs-controls label {
  display: flex;
  cursor: pointer;
  align-items: center;
  gap: 5px;
}

/* 窄到放不下一行四栏时改成 2×2:行内分隔线退场,改用格线,避免第一列左边飘一条孤线。 */
@media (max-width: 560px) {
  .subs-summary {
    grid-auto-flow: row;
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .subs-stat {
    padding: 13px 15px 14px;
  }

  .subs-stat + .subs-stat::before {
    display: none;
  }

  .subs-stat:nth-child(2n) {
    border-left: 1px solid var(--color-line);
  }

  .subs-stat:nth-child(n + 3) {
    border-top: 1px solid var(--color-line);
  }
}

@media (max-width: 420px) {
  .subs-grid {
    grid-template-columns: 1fr;
  }
}

@media (prefers-reduced-motion: reduce) {
  .subs-card,
  .subs-progress > div {
    transition: none;
  }

  .subs-card:hover {
    transform: none;
  }
}
</style>

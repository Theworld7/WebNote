<script setup lang="ts">
import type { StatBlock } from "@/types/workspace"
import type { DataColumn, DataRow } from "@/types/data-table"
import { computed } from "vue"
import { DatabaseIcon, Settings2Icon } from "@lucide/vue"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import TableRefNotice from "@/components/TableRefNotice.vue"
import { useWorkspace } from "@/composables/useWorkspace"
import { useTableEntry } from "@/composables/useTableEntry"
import * as dt from "@/lib/data-table"

/**
 * 统计块:引用一张数据表的某一列,把列下的数值求和成一个大数字。
 *
 * 数据链路与看板 / 账目完全同源,取数走 `useTableEntry` 共用 seam。求和是**视图
 * 计算的派生值**(与账目块的余额同一立场):非数字值按空处理,指向的列被删后退化为
 * 「未设置」提示态,`.tbl` 与块上都不落合计。
 */
const props = defineProps<{ block: StatBlock }>()

const { openFile, updateBlockSettings, bindStatTable, tablePaths } = useWorkspace()

const { state, table, columns, rows } = useTableEntry(() => props.block.path)

/** 求和列。块设置指向的列被删后这里落空,视图退化为「请选统计字段」提示。 */
const statColumn = computed<DataColumn | null>(
  () => columns.value.find((column) => column.id === props.block.columnId) ?? null,
)

/** 合计保留的小数位数。缺省两位,设置改档后显式落盘。 */
const precision = computed<number>(() => props.block.precision ?? dt.STAT_PRECISION_DEFAULT)

/**
 * 筛选列。列 id 非空才生效;指向的列被删后筛选失效退回全表 —— 与求和列同一退化立场。
 */
const filterColumn = computed<DataColumn | null>(() => {
  const id = props.block.filterColumnId ?? ""
  if (id === "") return null
  return columns.value.find((column) => column.id === id) ?? null
})

/** 参与求和的行:有生效筛选时只留「筛选列显示文本 === 筛选值」的行。 */
const filteredRows = computed<readonly DataRow[]>(() => {
  const column = filterColumn.value
  if (column === null) return rows.value
  return dt.filterRowsByValue(rows.value, column, props.block.filterValue ?? "")
})

/** 列下数值的合计。非数字(null / 文本 / 勾选)按空跳过 —— 与账目块金额列同一口径。 */
const sum = computed<number>(() => {
  const column = statColumn.value
  if (column === null) return 0
  return dt.sumColumn(filteredRows.value, column)
})

/** 显示形态与导出快照同一真源(见 dt.formatGrouped)。 */
const sumText = computed<string>(() => dt.formatGrouped(sum.value, precision.value))

const columnSelection = computed({
  get: () => props.block.columnId,
  set: (value: string) => updateBlockSettings(props.block.id, { columnId: value }),
})

/** 筛选字段选择:选「不限」(空串)时连值一起清,不留悬空的比对值。 */
function pickFilterColumn(value: string) {
  if (value === "") {
    updateBlockSettings(props.block.id, { filterColumnId: "", filterValue: "" })
    return
  }
  updateBlockSettings(props.block.id, { filterColumnId: value, filterValue: props.block.filterValue ?? "" })
}

/** 筛选值是自由文本:change(失焦/回车)才提交,不逐字符写盘。 */
function commitFilterValue(event: Event) {
  updateBlockSettings(props.block.id, { filterValue: (event.target as HTMLInputElement).value })
}

/** 表名只取路径去扩展名 —— 菜单里摆全路径太长，扩展名没有信息量。 */
function tableLabel(path: string): string {
  return path.replace(/\.tbl$/i, "")
}

function openTable() {
  if (props.block.path === "") return
  openFile(props.block.path)
}

const MENU = "w-[196px] rounded-island p-1.5 shadow-pop ring-0"
</script>

<template>
  <!--
    统一容器:操作行(右上角,悬停浮现)对**空指针**与正常态都要在 —— 格子内直接创建的
    统计卡就是空指针起步的,设置入口要是只挂在「已指向」分支上,这一态就永远没有补指向的路。
    读不到 / 读取中仍是纯提示:指针对着不存在的表,先如实报告。
  -->
  <div class="group/stat relative my-4">
    <div
      v-if="props.block.path === '' || table !== null"
      class="absolute -top-2 right-0 z-20 flex items-center gap-1 opacity-0 transition-opacity group-hover/stat:opacity-100 focus-within:opacity-100"
    >
      <Button
        v-if="props.block.path !== ''"
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
        <DropdownMenuContent :class="MENU" align="end">
          <DropdownMenuLabel class="px-2 pb-1 pt-1.5 text-[11px] font-normal text-muted-foreground">
            数据表
          </DropdownMenuLabel>
          <div class="px-2 pb-1.5">
            <select
              :value="props.block.path"
              class="w-full cursor-pointer rounded border border-line bg-transparent px-1.5 py-1 text-[12px] outline-none"
              @change="bindStatTable(props.block.id, ($event.target as HTMLSelectElement).value)"
            >
              <option value="">未选择</option>
              <option v-for="path in tablePaths" :key="path" :value="path">
                {{ tableLabel(path) }}
              </option>
            </select>
          </div>
          <template v-if="props.block.path !== ''">
            <DropdownMenuLabel class="px-2 pb-1 pt-1.5 text-[11px] font-normal text-muted-foreground">
              统计字段(对该列数值求和)
            </DropdownMenuLabel>
            <div class="px-2 pb-1.5">
              <select
                v-model="columnSelection"
                class="w-full cursor-pointer rounded border border-line bg-transparent px-1.5 py-1 text-[12px] outline-none"
              >
                <option value="">未选择</option>
                <option v-for="column in columns" :key="column.id" :value="column.id">
                  {{ column.name }}
                </option>
              </select>
            </div>
            <DropdownMenuLabel class="px-2 pb-1 pt-1.5 text-[11px] font-normal text-muted-foreground">
              筛选字段(留空 = 全表求和)
            </DropdownMenuLabel>
            <div class="px-2 pb-1.5">
              <select
                :value="props.block.filterColumnId ?? ''"
                class="w-full cursor-pointer rounded border border-line bg-transparent px-1.5 py-1 text-[12px] outline-none"
                @change="pickFilterColumn(($event.target as HTMLSelectElement).value)"
              >
                <option value="">不限</option>
                <option v-for="column in columns" :key="column.id" :value="column.id">
                  {{ column.name }}
                </option>
              </select>
            </div>
            <template v-if="filterColumn !== null">
              <DropdownMenuLabel class="px-2 pb-1 pt-1.5 text-[11px] font-normal text-muted-foreground">
                筛选值(只合计该字段等于此值的行)
              </DropdownMenuLabel>
              <div class="px-2 pb-1.5">
                <input
                  :value="props.block.filterValue ?? ''"
                  :placeholder="`如:${filterColumn.name} 的某个值`"
                  class="w-full rounded border border-line bg-transparent px-1.5 py-1 text-[12px] outline-none"
                  @change="commitFilterValue"
                />
              </div>
            </template>
            <DropdownMenuLabel class="px-2 pb-1 pt-1.5 text-[11px] font-normal text-muted-foreground">
              小数位数
            </DropdownMenuLabel>
            <div class="px-2 pb-1.5">
              <select
                :value="precision"
                class="w-full cursor-pointer rounded border border-line bg-transparent px-1.5 py-1 text-[12px] outline-none"
                @change="updateBlockSettings(props.block.id, { precision: Number(($event.target as HTMLSelectElement).value) })"
              >
                <option v-for="option in dt.STAT_PRECISION_OPTIONS" :key="option" :value="option">
                  {{ option }} 位
                </option>
              </select>
            </div>
          </template>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>

    <!--
      空指针:不共用 TableRefNotice —— 它的文案是「删掉重插」,对统计卡不成立,
      这里能直接补指向。样式与 TableRefNotice 的虚线框同一套(可恢复的正常态)。
    -->
    <div
      v-if="props.block.path === ''"
      class="my-4 flex items-center gap-2.5 rounded-lg border border-dashed border-line bg-muted/40 px-3 py-2.5"
    >
      <DatabaseIcon class="size-3.5 shrink-0 text-muted-foreground" />
      <span class="text-[12px] text-muted-foreground">
        统计卡尚未指向数据表 —— 点右上角「设置」先挑一张表,再选求和字段。
      </span>
    </div>

    <!-- 引用的文件读不到:提示态,不是错误态。 -->
    <TableRefNotice
      v-else-if="state === 'missing' || state === 'failed'"
      kind="missing"
      label="统计卡"
      :path="props.block.path"
    />

    <TableRefNotice v-else-if="table === null" kind="loading" label="统计卡" />

    <!-- 未选统计列(或列已被删):引导去设。 -->
    <div
      v-else-if="statColumn === null"
      class="rounded-lg border border-dashed border-line bg-muted/30 px-3 py-2.5 text-[12px] text-muted-foreground"
    >
      统计卡尚未选择字段 —— 点右上角「设置」挑一列,卡片会对它下面的数值求和。
    </div>

    <div
      v-else
      class="flex w-full flex-col gap-0.5 rounded-lg border border-line bg-muted/30 px-4 py-3"
    >
      <span class="truncate text-[11px] text-muted-foreground">
        {{ statColumn.name }}<template v-if="filterColumn !== null"> · {{ filterColumn.name }} = {{ props.block.filterValue }}</template>
      </span>
      <span class="text-[26px] font-semibold leading-tight tabular-nums">{{ sumText }}</span>
      <span class="text-[10px] text-muted-foreground/70">
        {{ filteredRows.length }} 行<template v-if="filterColumn !== null"> / 共 {{ rows.length }} 行</template> · 求和
      </span>
    </div>
  </div>
</template>

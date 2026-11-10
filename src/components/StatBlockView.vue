<script setup lang="ts">
import type { StatBlock } from "@/types/workspace"
import type { DataColumn, DataRow } from "@/types/data-table"
import { computed } from "vue"
import { DatabaseIcon, Settings2Icon } from "@lucide/vue"
import { Button } from "@/components/ui/button"
import { DropdownMenu, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import {
  BlockMenu,
  MENU_CONTROL,
  MenuField,
  MenuSection,
  MenuSelect,
  TOOL_PILL,
} from "@/components/settings-menu"
import TableRefNotice from "@/components/TableRefNotice.vue"
import { useWorkspace } from "@/composables/useWorkspace"
import { useTableEntry } from "@/composables/useTableEntry"
import * as dt from "@/lib/data-table"
import { NOTICE_INLINE, NOTICE_TEXT } from "@/components/ui/notice/recipes"

/**
 * 统计块:引用一张数据表的某一列,把列下的数值求和成一个大数字。
 *
 * 数据链路与看板 / 账目完全同源,取数走 `useTableEntry` 共用 seam。求和是**视图
 * 计算的派生值**(与账目块的余额同一立场):非数字值按空处理,指向的列被删后退化为
 * 「未设置」提示态,`.tbl` 与块上都不落合计。
 */
const props = defineProps<{ block: StatBlock }>()

const { openFile, updateBlockSettings, rebindTable, tablePaths } = useWorkspace()

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
  const target = event.target
  if (!(target instanceof HTMLInputElement)) return
  updateBlockSettings(props.block.id, { filterValue: target.value })
}

/** 表名只取路径去扩展名 —— 菜单里摆全路径太长，扩展名没有信息量。 */
function tableLabel(path: string): string {
  return path.replace(/\.tbl$/i, "")
}

/** 菜单里的表选项与列选项。控件只认 `{ value, label }`，映射留在这里。 */
const tableOptions = computed(() =>
  tablePaths.value.map((path) => ({ value: path, label: tableLabel(path) })),
)

const columnOptions = computed(() =>
  columns.value.map((column) => ({ value: column.id, label: column.name })),
)

const precisionOptions = dt.STAT_PRECISION_OPTIONS.map((value) => ({
  value: String(value),
  label: `${value} 位`,
}))

/** 小数位数的下拉只看字符串，写回时再折回数字。 */
const precisionSelection = computed({
  get: () => String(precision.value),
  set: (value: string) => updateBlockSettings(props.block.id, { precision: Number(value) }),
})

function openTable() {
  if (props.block.path === "") return
  openFile(props.block.path)
}
</script>

<template>
  <!--
    统一容器:操作行(右上角,悬停浮现)对**空指针**与正常态都要在 —— 格子内直接创建的
    统计卡就是空指针起步的,设置入口要是只挂在「已指向」分支上,这一态就永远没有补指向的路。
    读不到 / 读取中仍是纯提示:指针对着不存在的表,先如实报告 —— 换表的出路在提示条
    自己身上(见 TableRefNotice 的 reselect)。
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
        :class="TOOL_PILL"
        @click="openTable"
      >
        <DatabaseIcon class="size-3" />打开数据表
      </Button>
      <DropdownMenu>
        <DropdownMenuTrigger as-child>
          <Button variant="ghost" size="sm" :class="TOOL_PILL">
            <Settings2Icon class="size-3" />设置
          </Button>
        </DropdownMenuTrigger>
        <BlockMenu :width="12.25" align="end">
          <MenuSection>数据表</MenuSection>
          <MenuField>
            <MenuSelect
              :model-value="props.block.path"
              empty-label="未选择"
              :options="tableOptions"
              @update:model-value="(path: string) => rebindTable(props.block.id, path)"
            />
          </MenuField>
          <template v-if="props.block.path !== ''">
            <MenuSection>统计字段(对该列数值求和)</MenuSection>
            <MenuField>
              <MenuSelect v-model="columnSelection" empty-label="未选择" :options="columnOptions" />
            </MenuField>
            <MenuSection>筛选字段(留空 = 全表求和)</MenuSection>
            <MenuField>
              <MenuSelect
                :model-value="props.block.filterColumnId ?? ''"
                empty-label="不限"
                :options="columnOptions"
                @update:model-value="pickFilterColumn"
              />
            </MenuField>
            <template v-if="filterColumn !== null">
              <MenuSection>筛选值(只合计该字段等于此值的行)</MenuSection>
              <MenuField>
                <input
                  :value="props.block.filterValue ?? ''"
                  :placeholder="`如:${filterColumn.name} 的某个值`"
                  :class="MENU_CONTROL"
                  @change="commitFilterValue"
                >
              </MenuField>
            </template>
            <MenuSection>小数位数</MenuSection>
            <MenuField>
              <MenuSelect v-model="precisionSelection" :options="precisionOptions" />
            </MenuField>
          </template>
        </BlockMenu>
      </DropdownMenu>
    </div>

    <!--
      空指针:不共用 TableRefNotice —— 它的文案是「删掉重插」,对统计卡不成立,
      这里能直接补指向。样式与 TableRefNotice 的虚线框同一套(可恢复的正常态)。
    -->
    <div
      v-if="props.block.path === ''"
      :class="NOTICE_INLINE"
    >
      <DatabaseIcon class="size-3.5 shrink-0 text-muted-foreground" />
      <span class="text-12 text-muted-foreground">
        统计卡尚未指向数据表 —— 点右上角「设置」先挑一张表,再选求和字段。
      </span>
    </div>

    <!-- 引用的文件读不到:提示态,不是错误态 —— 提示条自带一条重新指向的出路。 -->
    <TableRefNotice
      v-else-if="state === 'missing' || state === 'failed'"
      kind="missing"
      label="统计卡"
      :path="props.block.path"
      :tables="tablePaths"
      @reselect="(path: string) => rebindTable(props.block.id, path)"
    />

    <TableRefNotice v-else-if="state === 'locked'" kind="locked" label="统计卡" />

    <TableRefNotice v-else-if="table === null" kind="loading" label="统计卡" />

    <!-- 未选统计列(或列已被删):引导去设。 -->
    <div
      v-else-if="statColumn === null"
      :class="NOTICE_TEXT"
    >
      统计卡尚未选择字段 —— 点右上角「设置」挑一列,卡片会对它下面的数值求和。
    </div>

    <div
      v-else
      class="flex w-full flex-col gap-0.5 rounded-lg border border-line bg-muted/30 px-4 py-3"
    >
      <span class="truncate text-11 text-muted-foreground">
        {{ statColumn.name }}<template v-if="filterColumn !== null"> · {{ filterColumn.name }} = {{ props.block.filterValue }}</template>
      </span>
      <span class="text-26 font-semibold leading-tight tabular-nums">{{ sumText }}</span>
      <span class="text-11 text-muted-foreground/70">
        {{ filteredRows.length }} 行<template v-if="filterColumn !== null"> / 共 {{ rows.length }} 行</template> · 求和
      </span>
    </div>
  </div>
</template>

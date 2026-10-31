<script setup lang="ts">
import { DatabaseIcon } from "@lucide/vue"
import { fileName } from "@/lib/paths"

/**
 * 引用块的三段提示态（空指针 / 读不到 / 读取中）。
 *
 * 各引用块视图曾经的模板逐字重复这三段,连文案都只差块名 —— 现在观感与文案
 * 由这里一处负责,视图只声明「什么块、处于什么态」。样式与块手柄提示同一套
 * (虚线框 = 可恢复的正常态,不是错误态 —— 见 GLOSSARY.md 的「Missing Data table」)。
 *
 * `missing` 态带一条回到正常的出路:数据表可能被改名或挪走,GLOSSARY 里那条定义
 * 本来就说「the user may want to point the block at it again」。所以视图传了
 * `tables` 就在提示条右侧摆一个数据表下拉;不传就只有文案 —— 视图自己另开了入口的
 * 地方不必重复摆。
 */
const props = defineProps<{
  /** `unset` 空指针(未指定表) / `missing` 引用的表读不到 / `loading` 读取中。 */
  kind: "unset" | "missing" | "loading"
  /** 块的显示名,进文案:「画册未指定数据表…」。 */
  label: string
  /** `missing` 态展示的路径。 */
  path?: string
  /** 可选的数据表清单 —— 给了就在 `missing` 态附一个「重新选择」下拉,空数组等于不给。 */
  tables?: readonly string[]
}>()

const emit = defineEmits<{ reselect: [path: string] }>()

/** 表名只取文件名去扩展名 —— 全路径摆在一条提示里太长,扩展名没有信息量。 */
function tableLabel(path: string): string {
  return fileName(path).replace(/\.tbl$/i, "")
}

/**
 * 选完立刻 emit,然后把下拉复位到占位项。
 *
 * 复位是必要的:换成一张能读的表之后这条提示整个消失,但换过去要是也读不到
 * (或视图还没重算),下拉不归位就会停在一个「看起来已经选好了」的错值上。
 */
function onReselect(event: Event): void {
  const target = event.target
  if (!(target instanceof HTMLSelectElement)) return
  const picked = target.value
  target.value = ""
  if (picked !== "") emit("reselect", picked)
}
</script>

<template>
  <!-- 还没读完。占位高度避免读盘回来时页面跳一下。 -->
  <div
    v-if="kind === 'loading'"
    class="my-4 flex items-center gap-2.5 rounded-lg border border-line bg-muted/30 px-3 py-2.5"
  >
    <DatabaseIcon class="size-3.5 shrink-0 animate-pulse text-muted-foreground" />
    <span class="text-[12px] text-muted-foreground">正在读取数据表…</span>
  </div>

  <div
    v-else
    class="my-4 flex items-center gap-2.5 rounded-lg border border-dashed border-line bg-muted/40 px-3 py-2.5"
  >
    <DatabaseIcon class="size-3.5 shrink-0 text-muted-foreground" />
    <span class="min-w-0 flex-1 text-[12px] text-muted-foreground">
      <!-- 空指针(转换流程修好前的遗留块 / 手工编辑):如实说没指定,而不是永远转圈。 -->
      <template v-if="kind === 'unset'">{{ label }}未指定数据表 —— 删掉这个块,用 / 菜单重新插入。</template>
      <!-- 引用的文件读不到:提示态,不是错误态。 -->
      <template v-else>{{ label }}引用的数据表不存在:<span class="font-mono">{{ path }}</span></template>
    </span>
    <!-- 换一条出路:只挑得出表的时候才摆,挑不出来等于给一个点不动的按钮。 -->
    <select
      v-if="kind === 'missing' && props.tables !== undefined && props.tables.length > 0"
      :value="''"
      class="shrink-0 cursor-pointer rounded border border-line bg-transparent px-1.5 py-1 text-[12px] outline-none"
      @change="onReselect"
    >
      <option value="" disabled>重新选择数据表…</option>
      <option v-for="item in props.tables" :key="item" :value="item">{{ tableLabel(item) }}</option>
    </select>
  </div>
</template>

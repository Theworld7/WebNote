<script setup lang="ts">
import { DatabaseIcon } from "@lucide/vue"

/**
 * 引用块的三段提示态（空指针 / 读不到 / 读取中）。
 *
 * 四个引用块视图曾经的模板逐字重复这三段,连文案都只差块名 —— 现在观感与文案
 * 由这里一处负责,视图只声明「什么块、处于什么态」。样式与块手柄提示同一套
 * (虚线框 = 可恢复的正常态,不是错误态 —— 见 CONTEXT.md 的「Missing Data table」)。
 */
defineProps<{
  /** `unset` 空指针(未指定表) / `missing` 引用的表读不到 / `loading` 读取中。 */
  kind: "unset" | "missing" | "loading"
  /** 块的显示名,进文案:「画册未指定数据表…」。 */
  label: string
  /** `missing` 态展示的路径。 */
  path?: string
}>()
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
    <span class="text-[12px] text-muted-foreground">
      <!-- 空指针(转换流程修好前的遗留块 / 手工编辑):如实说没指定,而不是永远转圈。 -->
      <template v-if="kind === 'unset'">{{ label }}未指定数据表 —— 删掉这个块,用 / 菜单重新插入。</template>
      <!-- 引用的文件读不到:提示态,不是错误态。 -->
      <template v-else>{{ label }}引用的数据表不存在:<span class="font-mono">{{ path }}</span></template>
    </span>
  </div>
</template>

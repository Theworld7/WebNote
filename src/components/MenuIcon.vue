<script setup lang="ts">
import type { Component } from "vue"

/**
 * 菜单左列那颗图标及其格子 —— 块类型菜单、块操作菜单、数据表 / 表格的列菜单共用一份。
 *
 * 格子定宽 22px（`w-5.5`）是为了让**标签的起始位置**在同一份菜单里对齐：图标是任意形状，
 * 光靠它自身的宽度对不齐。图标 14px / stroke 2，与工具栏的「＋」同一档（见 ADR-0051）；
 * `text-muted-foreground` 由格子继承下去，图标不用自己带颜色。
 *
 * 选中态（✓）不进这里 —— 那是状态标记、不是动作图标，仍留在 `MARKER` 那一列按字符排。
 */
defineProps<{
  /** 任意 lucide 图标组件：`BLOCK_TYPES` 里的那份，或菜单自己那一颗。 */
  icon: Component
}>()
</script>

<template>
  <span class="flex w-5.5 shrink-0 items-center justify-center text-muted-foreground">
    <component :is="icon" class="size-3.5" />
  </span>
</template>

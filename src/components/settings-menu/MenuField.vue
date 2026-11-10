<script setup lang="ts">
import { MENU_FIELD, MENU_FIELD_LABEL } from "./recipes"

/**
 * 设置菜单里的字段行：可选的小字标签 + 控件。
 *
 * 小字标签与 `MenuSection` 不是一回事：分组标题自成一行、上面还带间距；字段标签
 * 贴在控件上方，是「这一格填什么」。歌单 / 订阅的字段映射按注释那样排 6–10 行，
 * 用分组标题会撑得太高。
 */
defineProps<{ label?: string }>()
</script>

<template>
  <div :class="MENU_FIELD">
    <div v-if="label !== undefined" :class="MENU_FIELD_LABEL">{{ label }}</div>
    <slot />
  </div>
</template>

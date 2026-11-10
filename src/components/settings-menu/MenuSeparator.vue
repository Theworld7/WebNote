<script setup lang="ts">
import type { HTMLAttributes } from "vue"
import { DropdownMenuSeparator } from "@/components/ui/dropdown-menu"
import { MENU_SEPARATOR } from "./recipes"

/** 设置菜单里的分隔线。 */
defineProps<{ class?: HTMLAttributes["class"] }>()
</script>

<template>
  <DropdownMenuSeparator :class="[MENU_SEPARATOR, $props.class]" />
</template>

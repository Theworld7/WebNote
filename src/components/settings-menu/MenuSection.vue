<script setup lang="ts">
import type { HTMLAttributes } from "vue"
import { DropdownMenuLabel } from "@/components/ui/dropdown-menu"
import { MENU_SECTION } from "./recipes"

/** 设置菜单里的分组标题。抬头文字由调用方给。 */
defineProps<{ class?: HTMLAttributes["class"] }>()
</script>

<template>
  <DropdownMenuLabel :class="[MENU_SECTION, $props.class]">
    <slot />
  </DropdownMenuLabel>
</template>

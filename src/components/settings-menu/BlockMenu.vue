<script setup lang="ts">
import type { HTMLAttributes } from "vue"
import { computed } from "vue"
import { DropdownMenuContent, DropdownMenuSubContent } from "@/components/ui/dropdown-menu"
import { cn } from "@/lib/utils"
import { MENU_SHELL } from "./recipes"

/**
 * 设置菜单的外壳。除了宽度，其余观感（圆角 / 阴影 / hairline / 内边距）全在
 * `recipes.ts`，调用方不再拼那一串。
 *
 * 宽度写 `rem` 的数而不是 Tailwind 类：原来是 `w-[12.25rem]` 这种字面量散在 13 处，
 * 五种宽度各写各的。数字进来之后定宽只有一种表达，加宽窄也不会漏掉某一处。
 *
 * `sub` 是给子菜单用的：reka 的两棵菜单树各有自己的 portal，壳不能共用。
 */
const props = withDefaults(
  defineProps<{
    /** 定宽，单位 rem；`"auto"` 交给内容撑开，`"max"` 按内容的最大宽度撑开（横向分组的菜单用）。 */
    width?: number | "auto" | "max"
    /** 子菜单的壳。 */
    sub?: boolean
    class?: HTMLAttributes["class"]
  }>(),
  { width: "auto", sub: false, class: undefined },
)

defineOptions({ inheritAttrs: false })

const shellClass = computed(() =>
  cn(MENU_SHELL, props.width === "max" ? "w-max" : undefined, props.class),
)

const shellStyle = computed(() =>
  typeof props.width === "number" ? { width: `${props.width}rem` } : undefined,
)
</script>

<template>
  <DropdownMenuSubContent v-if="sub" v-bind="$attrs" :class="shellClass" :style="shellStyle">
    <slot />
  </DropdownMenuSubContent>
  <DropdownMenuContent v-else v-bind="$attrs" :class="shellClass" :style="shellStyle">
    <slot />
  </DropdownMenuContent>
</template>

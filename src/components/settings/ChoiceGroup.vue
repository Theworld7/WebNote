<script setup lang="ts" generic="V extends string | number, T extends { value: V }">
import type { HTMLAttributes } from "vue"
import { cn } from "@/lib/utils"
import { OPTION_ROW, optionRowClass } from "./recipes"

/**
 * 设置面板里的互斥选项组。**只管外壳**：栅格 / 竖叠、radiogroup 语义、radio 的
 * aria-checked、选中态描边与底色、点击写回。每组的图形（图标 + 说明、宽度条、
 * 圆角示意方块、字号数字）由插槽自己画 —— 原来六份模板各写一整遍那 25 行，
 * 差别其实只在按钮里面那一小块。
 *
 * 圆角走 `rounded-lg`（`--rad-lg`）而不是写死 9px：设置面板里的按钮也该跟着
 * 「界面圆角」那一档走（ADR-0040）。注意 `CORNER_STYLE_OPTIONS[].preview` 里的
 * 3 / 8 / 13px **不归这里管** —— 那是四档圆角的示意方块，它必须写死才画得出差别。
 */
const props = withDefaults(
  defineProps<{
    options: readonly T[]
    modelValue: V
    /** radiogroup 的无障碍名。 */
    label: string
    /** 不给就是竖叠；给 2 / 3 / 4 就是对应列数的横排栅格。 */
    columns?: 2 | 3 | 4
    /** 按钮里内容的排布，各组图形不同。 */
    itemClass?: HTMLAttributes["class"]
  }>(),
  { columns: undefined, itemClass: undefined },
)

const emit = defineEmits<{ (event: "update:modelValue", value: V): void }>()

/** 字面量写全，Tailwind 才扫得到 —— 拼 `grid-cols-${n}` 不会生成类。 */
const GRID: Record<2 | 3 | 4, string> = {
  2: "grid grid-cols-2",
  3: "grid grid-cols-3",
  4: "grid grid-cols-4",
}

</script>

<template>
  <div
    :class="cn('mt-0.5 gap-1.5', columns === undefined ? 'flex flex-col' : GRID[columns])"
    role="radiogroup"
    :aria-label="label"
  >
    <button
      v-for="option in options"
      :key="option.value"
      type="button"
      role="radio"
      :aria-checked="props.modelValue === option.value"
      :class="[OPTION_ROW, props.itemClass, optionRowClass(props.modelValue === option.value)]"
      @click="emit('update:modelValue', option.value)"
    >
      <slot :option="option" :active="props.modelValue === option.value" />
    </button>
  </div>
</template>

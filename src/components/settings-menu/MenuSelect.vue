<script setup lang="ts">
import type { HTMLAttributes } from "vue"
import { MENU_CONTROL } from "./recipes"

/**
 * 设置菜单里的下拉控件。
 *
 * 选项一律以 `{ value, label }` 的数组进来 —— 列名、月份、枚举都由调用方映射好，
 * 控件只管画。`emptyLabel` 是那第一项「未设置 / 不分组 / 不限」：值恒为空串，
 * 因为块字段的缺省表示就是空串。
 *
 * 写回只走 `update:modelValue`，事件里已经是字符串 —— 原来每个调用点各自
 * `(event.target as HTMLSelectElement)`，取一次值断言一次。
 */
withDefaults(
  defineProps<{
    modelValue: string
    options: readonly { value: string; label: string }[]
    /** 第一项「未选」的文案。不给就不加这一项。 */
    emptyLabel?: string
    class?: HTMLAttributes["class"]
  }>(),
  { emptyLabel: undefined, class: undefined },
)

const emit = defineEmits<{ (event: "update:modelValue", value: string): void }>()

function onChange(event: Event): void {
  const target = event.target
  if (!(target instanceof HTMLSelectElement)) return
  emit("update:modelValue", target.value)
}
</script>

<template>
  <select :class="[MENU_CONTROL, $props.class]" :value="modelValue" @change="onChange">
    <option v-if="emptyLabel !== undefined" value="">{{ emptyLabel }}</option>
    <option v-for="option in options" :key="option.value" :value="option.value">
      {{ option.label }}
    </option>
  </select>
</template>

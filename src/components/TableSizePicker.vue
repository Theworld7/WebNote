<script setup lang="ts">
import { computed, ref } from "vue"
import { TABLE_PICKER_SIZE } from "@/lib/table"

/**
 * 网格尺寸选择器 —— 拖动选 m × n，所见即所得。
 *
 * 是「空表格块」的内容：从菜单插入表格时先落一个空表，尺寸在这里选。这样插入动作
 * 不用在菜单里嵌一层浮层（两层 reka 菜单叠在一起，键盘导航与焦点会互相抢）。
 */
const emit = defineEmits<{ (event: "pick", columns: number, rows: number): void }>()

/** 当前 hover 到的尺寸，行列都从 1 起。列数为 0 表示指针不在网格上。 */
const hovered = ref({ rows: 0, columns: 0 })

const slots = computed(() => {
  const list: { row: number; column: number }[] = []
  for (let row = 0; row < TABLE_PICKER_SIZE; row += 1) {
    for (let column = 0; column < TABLE_PICKER_SIZE; column += 1) list.push({ row, column })
  }
  return list
})

function inRange(row: number, column: number): boolean {
  return row < hovered.value.rows && column < hovered.value.columns
}

/** 格数由常量决定，列数不能写死在 class 里（改了常量 class 不会跟着变）。 */
const gridStyle = { gridTemplateColumns: `repeat(${TABLE_PICKER_SIZE}, 1fr)` }
</script>

<template>
  <div class="flex flex-col gap-1.5">
    <div
      class="grid w-fit gap-1"
      :style="gridStyle"
      @mouseleave="hovered = { rows: 0, columns: 0 }"
    >
      <button
        v-for="slot in slots"
        :key="`${slot.row}-${slot.column}`"
        type="button"
        class="size-4 rounded-[3px] bg-muted-strong transition-colors"
        :class="inRange(slot.row, slot.column) && 'bg-selection-foreground'"
        :aria-label="`${slot.column + 1} 列 ${slot.row + 1} 行`"
        @mouseenter="hovered = { rows: slot.row + 1, columns: slot.column + 1 }"
        @click="emit('pick', slot.column + 1, slot.row + 1)"
      />
    </div>
    <div class="h-4 text-[11px] text-muted-foreground">
      {{ hovered.columns === 0 ? "拖动选择行列数" : `${hovered.columns} 列 × ${hovered.rows} 行` }}
    </div>
  </div>
</template>

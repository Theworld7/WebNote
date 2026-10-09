<script setup lang="ts">
import { cn } from "@/lib/utils"

const props = defineProps<{ dragging: boolean }>()
const emit = defineEmits<{ (event: "drag-start", payload: MouseEvent): void }>()

/** 抓手只在 hover / 拖拽中显现 —— 原来靠通栏竖线分隔，现在靠两区之间的留白。 */
const gripClass = cn(
  "pointer-events-none absolute left-1/2 top-1/2 h-[30px] w-[3px] -translate-x-1/2 -translate-y-1/2",
  "rounded-full bg-line transition-opacity",
  props.dragging ? "opacity-100" : "opacity-0 group-hover:opacity-100",
)
</script>

<template>
  <div
    class="group relative w-3 flex-none cursor-col-resize"
    @mousedown="emit('drag-start', $event)"
  >
    <span :class="gripClass" />
  </div>
</template>

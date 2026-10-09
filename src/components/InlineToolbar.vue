<script setup lang="ts">
import type { Component } from "vue"
import type { InlineMark } from "@/types/workspace"
import { BoldIcon, CodeIcon, HighlighterIcon } from "@lucide/vue"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"

/**
 * 选中文本后浮在选区上方的行内格式条。
 *
 * 只放加粗 / 高亮 / 行内代码三项：其余标记（斜体 / 下划线 / 删除线）虽然模型与
 * 解析都支持，但实际用不到，先不给按钮 —— 菜单里摆一排用不上的东西只会让人犹豫。
 */
interface FormatItem {
  mark: InlineMark
  label: string
  icon: Component
}

const ITEMS: readonly FormatItem[] = [
  { mark: "bold", label: "加粗", icon: BoldIcon },
  { mark: "highlight", label: "高亮", icon: HighlighterIcon },
  { mark: "code", label: "行内代码", icon: CodeIcon },
]

const props = defineProps<{
  /** 选区起点处生效的标记，用来把对应的按钮标成激活态。 */
  marks: readonly InlineMark[]
  /** 视口坐标，浮条以此为底部中心点。 */
  anchor: { top: number; left: number }
}>()

const emit = defineEmits<{ (event: "toggle", mark: InlineMark): void }>()

/** 24px 见方的图标按钮，与块左侧手柄同规格。 */
const TOOL = "size-6 rounded-[5px] p-0 text-muted-foreground hover:text-foreground"

const ACTIVE = "bg-accent text-foreground"

/**
 * 按下就吞掉默认行为。
 *
 * 按钮一旦拿到焦点，页面选区当场清空 —— 那样就无从知道要给哪段文字加格式了。
 * 所以这里不靠 click 之前先抢焦点，而是让选区原地不动，click 照常触发。
 */
function keepSelection(event: MouseEvent) {
  event.preventDefault()
}
</script>

<template>
  <div
    class="fixed z-50 flex items-center gap-0.5 rounded-island border border-line bg-background p-1 shadow-pop"
    :style="{ top: `${anchor.top}px`, left: `${anchor.left}px`, transform: 'translate(-50%, -100%)' }"
    @mousedown="keepSelection"
  >
    <Button
      v-for="item in ITEMS"
      :key="item.mark"
      variant="ghost"
      :class="cn(TOOL, props.marks.includes(item.mark) && ACTIVE)"
      :aria-label="item.label"
      :aria-pressed="props.marks.includes(item.mark)"
      @click="emit('toggle', item.mark)"
    >
      <component :is="item.icon" class="size-[14px]" />
    </Button>
  </div>
</template>

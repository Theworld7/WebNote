<script setup lang="ts">
import type { DialogContentEmits, DialogContentProps } from 'reka-ui'
import type { HTMLAttributes } from 'vue'
import { reactiveOmit } from '@vueuse/core'
import { DialogContent, DialogOverlay, DialogPortal, useForwardPropsEmits } from 'reka-ui'
import { cn } from '@/lib/utils'

/**
 * 抽屉面板。reka 没有 Sheet —— 它本质就是一个贴边的 `DialogContent`，
 * 所以这里按 `alert-dialog` 那套「薄包装 + class 合并」的写法自己组一个。
 *
 * 只做右侧一种方向（设置面板是唯一的使用者）。真要做多方向再加 `side` 属性，
 * 不为还不存在的需求预留分叉。
 *
 * 关键几点：
 * - `inset-y-0 right-0 h-full`：贴满整个视口高度，不是居中浮层。
 * - 宽 360px 由这里定，调用方可以 `:class` 覆盖。
 * - 左侧一道 `border-line` 替代圆角：通栏抽屉做圆角会跟视口边缘打架，
 *   而它紧贴内容区，需要一条线把两者分开（阴影留着，压住背后的内容）。
 * - 进出场动画用 `data-open:` / `data-closed:` 变体（reka 在根节点上挂这两个属性），
 *   横向滑入滑出，而不是弹窗的缩放。
 */
defineOptions({
  inheritAttrs: false,
})

const props = withDefaults(
  defineProps<DialogContentProps & { class?: HTMLAttributes['class'] }>(),
  {},
)
const emits = defineEmits<DialogContentEmits>()

const delegatedProps = reactiveOmit(props, 'class')

const forwarded = useForwardPropsEmits(delegatedProps, emits)
</script>

<template>
  <DialogPortal>
    <DialogOverlay
      data-slot="sheet-overlay"
      class="data-open:animate-in data-closed:animate-out data-closed:fade-out-0 data-open:fade-in-0 bg-black/10 supports-backdrop-filter:backdrop-blur-xs fixed inset-0 z-50 duration-150"
    />
    <DialogContent
      data-slot="sheet-content"
      v-bind="{ ...$attrs, ...forwarded }"
      :class="
        cn(
          'bg-card text-card-foreground fixed inset-y-0 right-0 z-50 flex h-full w-[360px] flex-col border-l border-line shadow-pop outline-none',
          'data-open:animate-in data-closed:animate-out data-closed:slide-out-to-right data-open:slide-in-from-right duration-200',
          props.class,
        )
      "
    >
      <slot />
    </DialogContent>
  </DialogPortal>
</template>

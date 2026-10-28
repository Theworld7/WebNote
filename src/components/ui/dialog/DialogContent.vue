<script setup lang="ts">
import type { DialogContentEmits, DialogContentProps } from 'reka-ui'
import type { HTMLAttributes } from 'vue'
import { reactiveOmit } from '@vueuse/core'
import { DialogContent, DialogOverlay, DialogPortal, useForwardPropsEmits } from 'reka-ui'
import { cn } from '@/lib/utils'

/**
 * 普通对话框（可 Esc / 点遮罩关掉）。
 *
 * 与 `alert-dialog` 分开的那条线是**焦点与退出方式**：reka 的 `AlertDialogContent`
 * 在 `openAutoFocus` 里写死了「把焦点给取消钮」，而且不吃 `preventDefault` —— 那是给
 * 「确认删除」那种两选一准备的；表单对话框要自己决定第一格焦点落哪，所以走 `Dialog`。
 *
 * 视觉上与 alert-dialog 同一套：popover 底、ring 一圈、居中缩放进出。宽度交给调用方
 * （`:class="max-w-md"` 之类），这里不预设档位 —— 表单的宽度由字段多少决定。
 */
defineOptions({
  inheritAttrs: false,
})

const props = defineProps<DialogContentProps & { class?: HTMLAttributes['class'] }>()
const emits = defineEmits<DialogContentEmits>()

const delegatedProps = reactiveOmit(props, 'class')

const forwarded = useForwardPropsEmits(delegatedProps, emits)
</script>

<template>
  <DialogPortal>
    <DialogOverlay
      data-slot="dialog-overlay"
      class="data-open:animate-in data-closed:animate-out data-closed:fade-out-0 data-open:fade-in-0 bg-black/10 reduce-transparency:bg-black/45 supports-backdrop-filter:backdrop-blur-xs reduce-transparency:backdrop-blur-none fixed inset-0 z-50 duration-100"
    />
    <DialogContent
      data-slot="dialog-content"
      v-bind="{ ...$attrs, ...forwarded }"
      :class="
        cn(
          'data-open:animate-in data-closed:animate-out data-closed:fade-out-0 data-open:fade-in-0 data-closed:zoom-out-95 data-open:zoom-in-95 bg-popover text-popover-foreground ring-foreground/10 fixed top-1/2 left-1/2 z-50 grid w-full max-w-md -translate-x-1/2 -translate-y-1/2 gap-4 rounded-xl p-4 ring-1 duration-100 outline-none',
          props.class,
        )
      "
    >
      <slot />
    </DialogContent>
  </DialogPortal>
</template>

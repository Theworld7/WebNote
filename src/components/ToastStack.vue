<script setup lang="ts">
import { CheckIcon, TriangleAlertIcon } from "@lucide/vue"
import { useToast } from "@/composables/useToast"

/**
 * 瞬态提示的唯一渲染处（App.vue 挂一次）。
 *
 * 底部居中：视线离开正文最少的位置，也不压住右下角可能出现的抽屉。全部
 * `pointer-events-none` —— 提示是通知，不是按钮，不该拦住底下的点击。
 *
 * `aria-live="polite"` 而不是 `role="alert"`：这是「成了」的确认，等着正文读完
 * 再说就行，不该打断屏幕阅读器。真正的失败（保存被拒之类）走编辑区顶部那条
 * `role="alert"` 的错误条。
 */
const { toasts } = useToast()
</script>

<template>
  <div class="pointer-events-none fixed inset-x-0 bottom-6 z-50 flex flex-col items-center gap-2" aria-live="polite">
    <TransitionGroup
      enter-from-class="translate-y-1 opacity-0"
      enter-active-class="transition duration-150 ease-out"
      leave-to-class="opacity-0"
      leave-active-class="transition duration-150 ease-in"
    >
      <div
        v-for="toast in toasts"
        :key="toast.id"
        class="flex max-w-[70vw] items-center gap-1.5 rounded-full border border-line bg-popover px-3 py-1.5 text-[12px] text-foreground shadow-island"
      >
        <TriangleAlertIcon v-if="toast.kind === 'error'" class="size-3.5 shrink-0 text-destructive" />
        <CheckIcon v-else class="size-3.5 shrink-0 text-status-ok-foreground" />
        <span class="truncate">{{ toast.message }}</span>
      </div>
    </TransitionGroup>
  </div>
</template>

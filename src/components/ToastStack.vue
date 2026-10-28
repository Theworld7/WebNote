<script setup lang="ts">
import { CheckIcon, TriangleAlertIcon } from "@lucide/vue"
import { useToast } from "@/composables/useToast"

/**
 * 瞬态提示的唯一渲染处（App.vue 挂一次）。
 *
 * 底部居中：视线离开正文最少的位置，也不压住右下角可能出现的抽屉。全部
 * `pointer-events-none` —— 提示是通知，不是按钮，不该拦住底下的点击。
 *
 * `z-[60]` 而不是全站惯用的 `z-50`：抽屉 / 对话框是 portal 到 body 的，同层级下
 * 它们按 DOM 顺序压在提示之上，遮罩的 `backdrop-blur` 会把提示糊成一团白雾。
 * 提示是「你刚才那个动作成了」的收据，常常正是在抽屉里按出来的，必须最上层。
 *
 * `aria-live="polite"` 而不是 `role="alert"`：这是「成了」的确认，等着正文读完
 * 再说就行，不该打断屏幕阅读器。真正的失败（保存被拒之类）走编辑区顶部那条
 * `role="alert"` 的错误条。
 */
const { toasts } = useToast()
</script>

<template>
  <div class="pointer-events-none fixed inset-x-0 bottom-6 z-[60] flex flex-col items-center gap-2" aria-live="polite">
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

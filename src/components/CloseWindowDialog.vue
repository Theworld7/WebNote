<script setup lang="ts">
import { computed } from "vue"
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { Button } from "@/components/ui/button"
import { useWorkspace } from "@/composables/useWorkspace"

/**
 * 关窗确认。
 *
 * 桌面端的关窗被原生层拦住（`CloseGuard`），到这里来问一句。它与「关标签」的
 * 确认框是两件事，不合并：那边问的是**一个文件**，一次只关一个；这里问的是
 * **整个窗口**，答完就退出，所以按钮是「全部保存」而不是「保存」。
 *
 * 三个按钮刻意用普通 Button 而不是 AlertDialogAction/Cancel —— 后两者点击即关框，
 * reka 的关闭回调会先把待确认态清掉，我们的动作再跑时状态已经没了。与
 * `EditorTabBar` 里那个框同一个理由。
 */
const { windowClosePending, dirtyTabs, resolveWindowClose, cancelWindowClose } = useWorkspace()

/** 确认框里的按钮：h-7、13px，跟工具栏那批小按钮同一个体量。 */
const DIALOG_BTN = "h-7 px-3 text-[13px]"

const count = computed(() => dirtyTabs.value.length)
</script>

<template>
  <AlertDialog :open="windowClosePending" @update:open="(open: boolean) => !open && cancelWindowClose()">
    <AlertDialogContent class="max-w-sm rounded-[18px] p-5 shadow-pop ring-1 ring-line/70">
      <AlertDialogHeader>
        <AlertDialogTitle>{{ count }} 个文件有未保存的修改</AlertDialogTitle>
        <AlertDialogDescription>关闭窗口后这些修改将会丢失。</AlertDialogDescription>
      </AlertDialogHeader>
      <AlertDialogFooter class="mx-0 mb-0 gap-2 rounded-none border-t-0 bg-transparent p-0 pt-1">
        <Button variant="ghost" :class="DIALOG_BTN" @click="cancelWindowClose">取消</Button>
        <Button variant="destructive" :class="DIALOG_BTN" @click="resolveWindowClose('discard')">不保存</Button>
        <Button :class="DIALOG_BTN" @click="resolveWindowClose('save')">全部保存并关闭</Button>
      </AlertDialogFooter>
    </AlertDialogContent>
  </AlertDialog>
</template>

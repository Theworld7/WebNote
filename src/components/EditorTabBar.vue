<script setup lang="ts">
import { nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue"
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
import EditorTab from "./EditorTab.vue"

const {
  tabs,
  activePath,
  activateTab,
  requestCloseTab,
  saveTab,
  isClosePending,
  pendingCloseLabel,
  resolveClose,
  cancelPendingClose,
} = useWorkspace()

/** 确认框里的按钮：h-7、13px，跟工具栏那批小按钮同一个体量。 */
const DIALOG_BTN = "h-7 px-3 text-[13px]"

/**
 * 标签条两端的渐变遮罩：某一侧还有内容可滚时才显示，
 * 表示「这边被截断了」。颜色从浮岛底色（card）淡出，盖在标签上不突兀。
 */
const stripRef = ref<HTMLElement | null>(null)
const overflow = ref({ left: false, right: false })

/** 自绘滚动指示条：宽与位置都是相对轨道（滚动容器内容宽）的百分比。 */
const thumb = ref({ left: 0, width: 100 })

function updateOverflow() {
  const element = stripRef.value
  if (element === null) return
  overflow.value = {
    left: element.scrollLeft > 1,
    right: element.scrollLeft + element.clientWidth < element.scrollWidth - 1,
  }
  thumb.value = {
    width: (element.clientWidth / element.scrollWidth) * 100,
    left: (element.scrollLeft / element.scrollWidth) * 100,
  }
}

onMounted(() => {
  updateOverflow()
  window.addEventListener("resize", updateOverflow)
})

onBeforeUnmount(() => {
  window.removeEventListener("resize", updateOverflow)
})

// 开关标签会改变总宽，等 DOM 更新完再量一次。
watch(() => tabs.value.length, () => nextTick(updateOverflow))
</script>

<template>
  <!-- 浮岛：只占内容宽度、不通栏，靠 self-start 收在左侧，右侧留空。
       **没开文件时整条浮岛不渲染**：没有标签可显示，留着就只是一块空白卡片压在编辑区
       上方。整块拿掉后编辑区直接顶到标题栏下面。
       max-w-full：标签多到放不下时浮岛不得撑破容器，超出交给标签条横向滚动。
       group/island：自绘滚动指示条挂在标签条下缘，hover 浮岛才显形。 -->
  <div
    v-if="tabs.length > 0"
    class="group/island flex max-w-full flex-none items-center self-start rounded-island bg-card p-1 shadow-island"
  >
    <div class="relative min-w-0">
      <div
        ref="stripRef"
        class="tab-scrollbar flex h-7 items-center gap-0.5 overflow-x-auto"
        @scroll.passive="updateOverflow"
      >
        <EditorTab
          v-for="tab in tabs"
          :key="tab.path"
          :tab="tab"
          :active="tab.path === activePath"
          @activate="activateTab"
          @close="requestCloseTab"
          @save="saveTab"
        />
      </div>

      <!-- 两端渐变：有内容被截断的一侧才显示。pointer-events-none，不挡点击。 -->
      <div
        v-if="overflow.left"
        class="pointer-events-none absolute left-0 top-0 h-7 w-6 bg-gradient-to-r from-card to-transparent"
      />
      <div
        v-if="overflow.right"
        class="pointer-events-none absolute right-0 top-0 h-7 w-6 bg-gradient-to-l from-card to-transparent"
      />

      <!-- 自绘滚动指示条：可滚才渲染，hover 浮岛才显形。绝对定位挂在标签条下缘
           （浮岛的 p-1 下内边距里），完全不占布局高度。 -->
      <div
        v-if="overflow.left || overflow.right"
        class="pointer-events-none absolute inset-x-0 -bottom-[3px] h-[3px] opacity-0 transition-opacity group-hover/island:opacity-100"
      >
        <div class="absolute h-full rounded-full bg-line" :style="{ width: `${thumb.width}%`, left: `${thumb.left}%` }" />
      </div>
    </div>
  </div>

  <!-- 关标签拦截：只有「关掉脏标签」这一个动作会被打断，切标签静默保留脏态。
       三个按钮刻意用普通 Button 而不是 AlertDialogAction/Cancel —— 后两者自带「点击即关框」，
       而 reka 那个关闭回调会先把 pendingClosePath 清掉，等我们的 @click 再跑时路径已经没了，
       结果就是框关了、标签没关。用普通按钮把「关框」这件事完全交回给 resolveClose 控制。

       Esc 仍然有效：走 reka 的 onOpenChange(false) → cancelPendingClose，等同「取消」。 -->
  <AlertDialog :open="isClosePending" @update:open="(open: boolean) => !open && cancelPendingClose()">
    <AlertDialogContent class="rounded-[18px] p-5 shadow-pop ring-0">
      <AlertDialogHeader>
        <AlertDialogTitle>保存对「{{ pendingCloseLabel }}」的修改？</AlertDialogTitle>
        <AlertDialogDescription>这个文件有未保存的修改，关闭后将会丢失。</AlertDialogDescription>
      </AlertDialogHeader>
      <AlertDialogFooter class="mx-0 mb-0 gap-2 rounded-none border-t-0 bg-transparent p-0 pt-1">
        <Button variant="ghost" :class="DIALOG_BTN" @click="cancelPendingClose">取消</Button>
        <Button variant="destructive" :class="DIALOG_BTN" @click="resolveClose('discard')">不保存</Button>
        <Button :class="DIALOG_BTN" @click="resolveClose('save')">保存</Button>
      </AlertDialogFooter>
    </AlertDialogContent>
  </AlertDialog>
</template>

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
  savingPaths,
  isClosePending,
  pendingCloseLabel,
  resolveClose,
  cancelPendingClose,
} = useWorkspace()

/** 确认框里的按钮：h-7、13px，跟工具栏那批小按钮同一个体量。 */
const DIALOG_BTN = "h-7 px-3 text-[13px]"

/**
 * 标签条两端的渐变遮罩：某一侧还有内容可滚时才显示，
 * 表示「这边被截断了」。颜色从卡片底色（card）淡出，盖在标签上不突兀。
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
  <!-- 标签条是编辑卡片第一行里的一段，不自带外壳：宽度按内容收缩、放不下才滚动，
       右端的余量留在卡片里（这一行没有别的子项，余量是空的，不再当拖拽面用 ——
       窗口的拖拽面在标题栏，见 ADR-0033）。所以这里既不能 flex-1，也不能撑破父级。
       group/tabs：自绘滚动指示条挂在标签条下缘，hover 这一段才显形。 -->
  <div class="group/tabs relative min-w-0 max-w-full">
    <!-- **没开文件时标签区不渲染**：没有标签可显示，留一条空轨道只会把卡片顶端撑出一条缝。 -->
    <div
      v-if="tabs.length > 0"
      ref="stripRef"
      class="tab-scrollbar flex h-7 items-center gap-0.5 overflow-x-auto"
      @scroll.passive="updateOverflow"
    >
      <EditorTab
        v-for="tab in tabs"
        :key="tab.path"
        :tab="tab"
        :active="tab.path === activePath"
        :saving="savingPaths.has(tab.path)"
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

    <!-- 自绘滚动指示条：可滚才渲染，hover 才显形。绝对定位挂在标签条下缘的留白里，
         完全不占布局高度。 -->
    <div
      v-if="overflow.left || overflow.right"
      class="pointer-events-none absolute inset-x-0 -bottom-1 h-[3px] opacity-0 transition-opacity group-hover/tabs:opacity-100"
    >
      <div class="absolute h-full rounded-full bg-line" :style="{ width: `${thumb.width}%`, left: `${thumb.left}%` }" />
    </div>

    <!-- 关标签拦截：只有「关掉脏标签」这一个动作会被打断，切标签静默保留脏态。
         三个按钮刻意用普通 Button 而不是 AlertDialogAction/Cancel —— 后两者自带「点击即关框」，
         而 reka 那个关闭回调会先把 pendingClosePath 清掉，等我们的 @click 再跑时路径已经没了，
         结果就是框关了、标签没关。用普通按钮把「关框」这件事完全交回给 resolveClose 控制。

         Esc 仍然有效：走 reka 的 onOpenChange(false) → cancelPendingClose，等同「取消」。
         放在根节点内部是为了让本组件保持单根 —— 否则父级给它的 class 传不进来。 -->
    <AlertDialog :open="isClosePending" @update:open="(open: boolean) => !open && cancelPendingClose()">
      <AlertDialogContent class="rounded-[18px] p-5 shadow-pop ring-1 ring-line/70">
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
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue"
import { LocateFixedIcon, MoonIcon, PanelLeftIcon, SettingsIcon, SunIcon } from "@lucide/vue"
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { Button } from "@/components/ui/button"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { useWorkspace } from "@/composables/useWorkspace"
import { useTheme } from "@/composables/useTheme"
import SettingsPanel from "./SettingsPanel.vue"
import EditorTab from "./EditorTab.vue"

defineProps<{ sidebarCollapsed: boolean }>()
const emit = defineEmits<{ (event: "toggle-sidebar"): void }>()

const {
  tabs,
  activePath,
  activeTab,
  activateTab,
  requestCloseTab,
  saveTab,
  isClosePending,
  pendingCloseLabel,
  resolveClose,
  cancelPendingClose,
} = useWorkspace()

const ACTION = "size-6 rounded-[5px] p-0 text-muted-foreground hover:text-foreground"

/**
 * 主题开关。图标画的是**点下去会变成什么**（深色时给太阳），不是当前状态 ——
 * 一颗只有两个态的按钮，用户点它时想知道的是结果。
 */
const { theme, toggle: toggleTheme } = useTheme()
const themeActionLabel = computed(() => (theme.value === "dark" ? "切换到浅色" : "切换到深色"))

/** 设置抽屉的开合。放在工具栏这一层：它是浮岛上的一个动作，不是工作区状态。 */
const settingsOpen = ref(false)

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
       标签条与动作组之间的间隔只由外层 gap 一处承担（曾经叠了 `gap-1` + `ml-1` + `pl-1.5`，
       无标签时那段空白会露出来）；空标签时标签条整个不渲染，否则零宽的空条仍会吃掉一份 gap。
       max-w-full：标签多到放不下时浮岛不得撑破容器，超出交给标签条横向滚动。
       group/island：自绘滚动指示条挂在标签条下缘，hover 浮岛才显形。 -->
  <div class="group/island flex max-w-full flex-none items-center gap-2 self-start rounded-island bg-card p-1 shadow-island">
    <div v-if="tabs.length > 0" class="relative min-w-0">
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

    <div class="flex flex-none items-center gap-0.5">
      <!-- 「在目录中定位」定的是当前激活的那篇笔记，没有激活标签就无从定位，不给按钮。 -->
      <Tooltip v-if="activeTab !== null">
        <TooltipTrigger as-child>
          <Button variant="ghost" :class="ACTION" aria-label="在目录中定位">
            <LocateFixedIcon class="size-[15px]" />
          </Button>
        </TooltipTrigger>
        <TooltipContent>在目录中定位</TooltipContent>
      </Tooltip>

      <Tooltip>
        <TooltipTrigger as-child>
          <Button variant="ghost" :class="ACTION" aria-label="折叠侧栏" @click="emit('toggle-sidebar')">
            <PanelLeftIcon class="size-[15px]" />
          </Button>
        </TooltipTrigger>
        <TooltipContent>{{ sidebarCollapsed ? "展开侧栏" : "折叠侧栏" }}</TooltipContent>
      </Tooltip>

      <!-- 主题开关与设置同属全局动作，收在动作组右端；自动模式下它只覆盖当前时段，
           具体到下一个跳变点会不会被自动接管，看设置面板里的「外观」。 -->
      <Tooltip>
        <TooltipTrigger as-child>
          <Button variant="ghost" :class="ACTION" :aria-label="themeActionLabel" @click="toggleTheme">
            <SunIcon v-if="theme === 'dark'" class="size-[15px]" />
            <MoonIcon v-else class="size-[15px]" />
          </Button>
        </TooltipTrigger>
        <TooltipContent>{{ themeActionLabel }}</TooltipContent>
      </Tooltip>

      <!-- 设置放在动作组最右：它不针对当前标签，是全局入口，与左侧那几个「对当前文档做事」的按钮分开。 -->
      <Tooltip>
        <TooltipTrigger as-child>
          <Button variant="ghost" :class="ACTION" aria-label="设置" @click="settingsOpen = true">
            <SettingsIcon class="size-[15px]" />
          </Button>
        </TooltipTrigger>
        <TooltipContent>设置</TooltipContent>
      </Tooltip>
    </div>
  </div>

  <SettingsPanel v-model:open="settingsOpen" />

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

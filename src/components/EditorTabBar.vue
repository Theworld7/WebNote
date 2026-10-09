<script setup lang="ts">
import { LocateFixedIcon, PanelLeftIcon } from "@lucide/vue"
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
import EditorTab from "./EditorTab.vue"

defineProps<{ sidebarCollapsed: boolean }>()
const emit = defineEmits<{ (event: "toggle-sidebar"): void }>()

const {
  tabs,
  activePath,
  activeTab,
  isDirty,
  activateTab,
  requestCloseTab,
  save,
  isClosePending,
  pendingCloseLabel,
  resolveClose,
  cancelPendingClose,
} = useWorkspace()

const ACTION = "size-6 rounded-[5px] p-0 text-muted-foreground hover:text-foreground"

/** 出现即代表「有东西要存」，所以样式是恒定的强调态，不再随 isDirty 分叉。 */
const SAVE =
  "h-[26px] rounded-full bg-selection px-3 text-xs font-medium text-selection-foreground hover:bg-selection-strong hover:text-selection-foreground"

/** 确认框里的按钮：h-7、13px，跟工具栏那批小按钮同一个体量。 */
const DIALOG_BTN = "h-7 px-3 text-[13px]"
</script>

<template>
  <!-- 浮岛：只占内容宽度、不通栏，靠 self-start 收在左侧，右侧留空。
       标签条与动作组之间的间隔只由外层 gap 一处承担（曾经叠了 `gap-1` + `ml-1` + `pl-1.5`，
       无标签时那段空白会露出来）；空标签时标签条整个不渲染，否则零宽的空条仍会吃掉一份 gap。 -->
  <div class="flex flex-none items-center gap-2 self-start rounded-island bg-card p-1 shadow-island">
    <div v-if="tabs.length > 0" class="flex min-w-0 items-center gap-0.5 overflow-hidden">
      <EditorTab
        v-for="tab in tabs"
        :key="tab.path"
        :tab="tab"
        :active="tab.path === activePath"
        @activate="activateTab"
        @close="requestCloseTab"
      />
    </div>

    <div class="flex flex-none items-center gap-0.5">
      <!-- 只在当前激活标签有未保存改动时出现。其余标签的脏态由标签自己那个圆点表达，
           全局常驻一个「保存」按钮会误导成「点了会保存所有标签」。 -->
      <Button
        v-if="isDirty"
        variant="ghost"
        size="xs"
        :class="SAVE"
        @click="save"
      >
        保存
      </Button>

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

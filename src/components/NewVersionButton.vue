<script setup lang="ts">
import { ArrowUpRightIcon } from "@lucide/vue"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { useUpdateCheck } from "@/composables/useUpdateCheck"

/**
 * 「新版本」提示。有更新才渲染 —— chrome 上不养一颗常亮的按钮，那会让人每次开机
 * 都去点一次不会有结果的东西。
 *
 * 用文字而不是图标：它说的是「有新东西可以拿」，这件事和撤销、重做、设置那几颗
 * 按钮不是一类，图标讲不清楚。品牌色是唯一的强调手段，块与按钮的形态跟旁边保持一致。
 *
 * 点击直接把那个 release 的页面交给系统浏览器 —— 应用内不下载、不安装。
 */
const { latest, open } = useUpdateCheck()
</script>

<template>
  <Tooltip v-if="latest !== null">
    <TooltipTrigger as-child>
      <button
        type="button"
        class="flex h-6 flex-none items-center gap-0.5 rounded-[5px] px-1.5 text-[11px] font-medium text-primary transition-colors hover:bg-primary/10"
        :aria-label="`新版本 ${latest.version}，打开下载页面`"
        @mousedown.prevent
        @click="open"
      >
        新版本
        <ArrowUpRightIcon class="size-3" />
      </button>
    </TooltipTrigger>
    <TooltipContent>v{{ latest.version }} 已发布 · 打开下载页面</TooltipContent>
  </Tooltip>
</template>

<script setup lang="ts">
import type { HtmlBlock } from "@/types/workspace"
import { computed, onBeforeUnmount, onMounted, ref } from "vue"
import { PencilIcon } from "@lucide/vue"
import { Button } from "@/components/ui/button"
import { useWorkspace } from "@/composables/useWorkspace"
import { buildHtmlFrameDoc } from "@/lib/html-frame"
import HtmlSourceDrawer from "./HtmlSourceDrawer.vue"

/**
 * 自定义 HTML 块。
 *
 * 渲染走**沙箱 iframe**（`sandbox="allow-scripts"`）：原文里的脚本能跑，但拿不到
 * 父页面、碰不到编辑器 —— 写什么渲染什么，隔离交给浏览器。iframe 会吞双击，
 * 编辑入口是 hover 浮出的按钮。
 *
 * 源码编辑在**抽屉**里（Monaco，`HtmlSourceDrawer`）：从块内 textarea 换成
 * 右缘半宽抽屉，大段 HTML 有正经编辑器伺候。空块摊一个可聚焦的占位
 * （挂 `data-editable`）—— 新插入 / 转换来的块由 `BlockEditor` 统一聚焦，
 * 焦点一到就顺势拉开抽屉；打开旧笔记里的空块不会凭空弹抽屉。
 */
const props = defineProps<{ block: HtmlBlock }>()

const { setHtmlSource } = useWorkspace()

const drawerOpen = ref(false)

function openDrawer() {
  drawerOpen.value = true
}

/** 提交。空原文是合法结果 —— 块回到空占位态，不算死局。 */
function commit(source: string) {
  drawerOpen.value = false
  if (source !== props.block.source) setHtmlSource(props.block.id, source)
}

const frameRef = ref<HTMLIFrameElement | null>(null)

/** iframe 当前内容高度。没收到上报前给个能看见的最小值。 */
const height = ref(48)

/**
 * srcdoc 文档出自 `lib/html-frame.ts` —— 探针量 body 不量 documentElement 的
 * 理由（视口正反馈会把 iframe 永远撑大）写在那边。
 */
const doc = computed(() => buildHtmlFrameDoc(props.block.source))

/**
 * 高度上报的守卫：只认自己 iframe 发来的消息（按 `event.source` 认窗口，多个
 * HTML 块各报各的互不串台），载荷只认 `{ height: number }`。
 */
function isHeightMessage(data: unknown): data is { height: number } {
  if (typeof data !== "object" || data === null) return false
  return "height" in data && typeof data.height === "number"
}

function onMessage(event: MessageEvent) {
  const frame = frameRef.value
  if (frame === null || event.source !== frame.contentWindow) return
  if (!isHeightMessage(event.data)) return
  height.value = Math.max(32, Math.ceil(event.data.height))
}

onMounted(() => window.addEventListener("message", onMessage))
onBeforeUnmount(() => window.removeEventListener("message", onMessage))
</script>

<template>
  <div class="group/html relative">
    <!-- 沙箱渲染：高度由内容自报，宽度铺满内容列。srcdoc 换成即整体重载。 -->
    <iframe
      v-if="block.source.trim() !== ''"
      ref="frameRef"
      class="my-1 block w-full rounded-lg border-none bg-transparent"
      :style="{ height: `${height}px` }"
      sandbox="allow-scripts"
      :srcdoc="doc"
    />

    <!-- 空原文：可聚焦的占位就是入口 —— 点它、或 BlockEditor 把焦点送来，都拉抽屉。 -->
    <div
      v-else
      :data-editable="block.id"
      tabindex="0"
      class="my-1 flex h-16 cursor-pointer items-center justify-center rounded-lg bg-muted text-[12px] text-muted-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring"
      title="编写 HTML 源码"
      @focus="openDrawer"
      @click="openDrawer"
    >
      HTML 块 · 点此编写源码
    </div>

    <!-- hover 浮现，但浮现即是按钮形态：自带底色描边（ghost 默认透明底，
         不加的话出现时只是裸文字，hover 到它自己才长出按钮的样子）。 -->
    <Button
      v-if="block.source.trim() !== ''"
      size="sm"
      variant="ghost"
      class="absolute right-0 top-2 z-10 h-7 gap-1.5 rounded-md border border-line bg-background/80 px-2.5 text-[11.5px] shadow-xs backdrop-blur-sm opacity-0 transition-opacity hover:bg-muted group-hover/html:opacity-100 focus-visible:opacity-100"
      @click="openDrawer"
    >
      <PencilIcon class="size-3.5" />
      编辑源码
    </Button>

    <!-- 常驻复用的源码抽屉（内部 v-show 显隐，Monaco 实例只建一次）。 -->
    <HtmlSourceDrawer :open="drawerOpen" :source="block.source" @commit="commit" @close="drawerOpen = false" />
  </div>
</template>

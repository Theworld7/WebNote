<script setup lang="ts">
import { computed } from "vue"
import { LoaderCircleIcon, TriangleAlertIcon, XIcon } from "@lucide/vue"
import { useWorkspace } from "@/composables/useWorkspace"
import BlockEditor from "./BlockEditor.vue"
import DataTableEditor from "./DataTableEditor.vue"
import EditorHome from "./EditorHome.vue"
import EditorTabBar from "./EditorTabBar.vue"
import MarkdownView from "./MarkdownView.vue"

const {
  tabs,
  activeTab,
  activePath,
  isLoadingDocument,
  isActiveTable,
  isActiveMarkdown,
  fsError,
  dismissError,
  busyLabel,
} = useWorkspace()

/**
 * 只有真拿到正文才挂 BlockEditor。
 *
 * 载入中也挂的话，会先用空文档渲染一遍再跳成真内容 —— 闪一下，而且拖拽 / 粘贴那套
 * 处理器会挂在一个马上就要被替换的文档上。
 *
 * 数据表走同一扇门：它的正文由数据表编辑器自己读（`useTables`），工作区这边的
 * `isLoadingDocument` 对它恒为 false，所以它一打开就能挂上。
 */
const hasDocument = computed(() => activeTab.value !== null && !isLoadingDocument.value)
</script>

<template>
  <!-- `data-editor-surface`：块级抽屉（HTML 源码编辑）的 Teleport 锚点 ——
       抽屉宽度按笔记编辑区一半算，只能挂这里，挂 body 就成了按视口算。
       它同时是正文 gutter 的容器查询基准（见 style.css）：侧栏展开与折叠差 244px，
       用 vw 量出来的 gutter 会跟着窗口走、不跟着编辑区，正好是错的那一半。
       min-w-0 不能省：作为 flex row 的子项，没它时长内容（宽表格、长链接）会撑破容器
       而不是滚动。 -->
  <div
    class="relative flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden rounded-block bg-card shadow-block"
    data-editor-surface
  >
    <!-- 标签行是这张卡片自己的第一行（ADR-0033）：标签描述的是「这篇文档」，不是窗口，
         所以跟着文档待在卡片里；没有标签时整行不渲染，空态直接从 EditorHome 开始。
         行高 44 = 28px 标签 + 上下各 8px：卡片上沿是 18px 圆角，标签只让开 4px 时两颗圆弧
         挤在同一个角上，看着发紧。 -->
    <div v-if="tabs.length > 0" class="flex h-11 flex-none items-center gap-2 px-2.5">
      <EditorTabBar class="min-w-0" />
    </div>

    <!-- 读写错误条。常驻在编辑区顶部而不是只在空态里 —— 保存失败时正开着文档，
         那条错误若不显示出来，用户会以为已经存好了。
         `role="alert"`：这一条几乎总是「刚才那个动作没成」的结果，屏幕阅读器必须
         当场播报；视觉用户看到的是红条，非视觉用户拿到的应当是同一句话。 -->
    <div
      v-if="fsError !== ''"
      role="alert"
      class="flex flex-none items-center gap-2 bg-destructive/8 px-[22px] py-1.5 text-[12px] text-destructive"
    >
      <TriangleAlertIcon class="size-3.5 shrink-0" />
      <span class="min-w-0 flex-1 truncate">{{ fsError }}</span>
      <button
        type="button"
        class="flex size-4 shrink-0 items-center justify-center rounded-[4px] opacity-60 hover:opacity-100"
        aria-label="关闭提示"
        @click="dismissError"
      >
        <XIcon class="size-3.5" />
      </button>
    </div>

    <!-- 进行中的盘上操作（删除 / 移动 / 重命名）。确认框一关界面就静止的话，
         用户分不清它在干活还是卡住了，于是再点一次 —— 那才是真出事的地方。
         `role="status"`：播报但不打断，与上面那条错误的优先级不同。 -->
    <div
      v-if="busyLabel !== ''"
      role="status"
      class="flex flex-none items-center gap-2 bg-muted/60 px-[22px] py-1.5 text-[12px] text-muted-foreground"
    >
      <LoaderCircleIcon class="size-3.5 shrink-0 animate-spin" />
      <span class="min-w-0 flex-1 truncate">{{ busyLabel }}</span>
    </div>

    <EditorHome v-if="!hasDocument" />
    <!-- 编辑器在 onMounted 里按当时的 activePath 读一次表,不随激活路径自动重读 ——
         不加 key 的话,两个数据表标签之间切换会复用实例,永远显示第一张激活的表。
         key 让每个路径一个实例:换表 = 重挂 = 重读。 -->
    <DataTableEditor v-else-if="isActiveTable" :key="activePath" />
    <!-- Markdown 同理：每个路径一个实例，切文件时重挂并重新注入那份 scoped 样式。 -->
    <MarkdownView v-else-if="isActiveMarkdown" :key="activePath" />
    <BlockEditor v-else />
  </div>
</template>

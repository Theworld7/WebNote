<script setup lang="ts">
import type { ImageBlock } from "@/types/workspace"
import { computed, ref } from "vue"
import { ImageOffIcon, ImagePlusIcon } from "@lucide/vue"
import { Button } from "@/components/ui/button"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { useWorkspace } from "@/composables/useWorkspace"
import { markImageBroken, usableImage } from "@/lib/broken-images"
import { isFileDrag, pickImageFile, readImageFile } from "@/lib/image"
import ImageSourcePanel from "./ImageSourcePanel.vue"

/**
 * 图片块。
 *
 * 有图时换图入口收在 hover 浮层里 —— 图片本身才是内容，常驻一条工具条会抢视线。
 * 无图时反过来：直接把来源面板摊在块里，空块给一个看得见的入口，比藏起来的按钮好。
 *
 * 「有地址但画不出来」是第三种态，单独给一块说明：链接失效、断网、对方禁止外链
 * 都会走到这里，而 `<img>` 自己失败时页面只是安静地少一块图，用户无从判断是网、
 * 是链接，还是文件坏了。
 */
const props = defineProps<{ block: ImageBlock }>()

const { setImageSource } = useWorkspace()

const hasSource = computed(() => props.block.src !== "")
/** 能画的地址。失败过的按空串处理，落到下面那块说明。 */
const shownSrc = computed(() => usableImage(props.block.src))
const replaceOpen = ref(false)
const dropActive = ref(false)

function apply(src: string) {
  setImageSource(props.block.id, src)
  replaceOpen.value = false
}

function onDragOver(event: DragEvent) {
  if (!isFileDrag(event.dataTransfer)) return
  // 放行 drop 并拦住冒泡：编辑器那一层收到就变成「在落点插入一个新块」了。
  event.preventDefault()
  event.stopPropagation()
  dropActive.value = true
}

function onDragLeave() {
  dropActive.value = false
}

async function onDrop(event: DragEvent) {
  if (!isFileDrag(event.dataTransfer)) return
  event.preventDefault()
  event.stopPropagation()
  dropActive.value = false
  // 拖进来的不是图片就安静地吃掉这次 drop，别让浏览器去打开那个文件。
  const file = pickImageFile(event.dataTransfer)
  if (file === null) return
  apply(await readImageFile(file))
}
</script>

<template>
  <div
    class="group/img relative transition-shadow"
    :class="dropActive && 'rounded-lg ring-2 ring-selection-strong'"
    @dragover="onDragOver"
    @dragleave="onDragLeave"
    @drop="onDrop"
  >
    <!-- 深色下压暗 6%：HIG 要求「显示的内容图像包含白色背景时略微调暗，防止背景在深色
         环境里发光」。截图的纯白底铺在 #171717 卡片上是 17.9:1，不压就是一块亮斑；
         6% 对普通照片看不出来，对白底截图足够收一收。 -->
    <img
      v-if="shownSrc !== ''"
      :src="shownSrc"
      :alt="block.alt"
      :title="block.title"
      class="my-1 block max-w-full rounded-lg dark:brightness-[0.94]"
      @error="markImageBroken(shownSrc)"
    />

    <!-- 有地址但画不出来。说明白「不是笔记坏了」，再把地址摊出来 —— 用户能自己判断
         是链接写错了还是对方不让外链。换图入口仍走下面的浮层。 -->
    <div
      v-else-if="hasSource"
      class="my-1 flex items-start gap-2.5 rounded-lg border border-dashed border-line bg-muted/40 px-3 py-2.5"
    >
      <ImageOffIcon class="mt-0.5 size-3.5 shrink-0 text-muted-foreground" />
      <div class="min-w-0">
        <p class="text-[12px] text-muted-foreground">图片打不开 —— 地址可能失效、需要联网，或对方不允许外链。</p>
        <p class="mt-1 truncate font-mono text-[11px] text-muted-foreground/70">{{ block.src }}</p>
      </div>
    </div>

    <div v-else class="my-1 rounded-lg bg-muted p-3">
      <div class="mb-2 flex items-center gap-1.5 text-[12px] text-muted-foreground">
        <ImagePlusIcon class="size-3.5" />
        还没有图片 —— 选一张，或拖入 / 粘贴
      </div>
      <ImageSourcePanel @pick="apply" />
    </div>

    <Popover v-if="hasSource" v-model:open="replaceOpen">
      <PopoverTrigger as-child>
        <Button
          size="sm"
          class="absolute right-2 top-3 h-7 gap-1.5 px-2.5 opacity-0 shadow-island transition-opacity group-hover/img:opacity-100 focus-visible:opacity-100"
        >
          <ImagePlusIcon class="size-3.5" />
          换图
        </Button>
      </PopoverTrigger>
      <PopoverContent
        align="end"
        class="w-auto rounded-island p-3 shadow-pop ring-1 ring-line/70"
        @open-auto-focus.prevent
      >
        <ImageSourcePanel autofocus @pick="apply" />
      </PopoverContent>
    </Popover>
  </div>
</template>

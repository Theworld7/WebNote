<script setup lang="ts">
import type { ImageBlock } from "@/types/workspace"
import { computed, ref } from "vue"
import { ImagePlusIcon } from "@lucide/vue"
import { Button } from "@/components/ui/button"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { useWorkspace } from "@/composables/useWorkspace"
import { isFileDrag, pickImageFile, readImageFile } from "@/lib/image"
import ImageSourcePanel from "./ImageSourcePanel.vue"

/**
 * 图片块。
 *
 * 有图时换图入口收在 hover 浮层里 —— 图片本身才是内容，常驻一条工具条会抢视线。
 * 无图时反过来：直接把来源面板摊在块里，空块给一个看得见的入口，比藏起来的按钮好。
 */
const props = defineProps<{ block: ImageBlock }>()

const { setImageSource } = useWorkspace()

const hasSource = computed(() => props.block.src !== "")
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
    <img
      v-if="hasSource"
      :src="block.src"
      :alt="block.alt"
      :title="block.title"
      class="my-1 block max-w-full rounded-lg"
    />

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
        class="w-auto rounded-island p-3 shadow-pop ring-0"
        @open-auto-focus.prevent
      >
        <ImageSourcePanel autofocus @pick="apply" />
      </PopoverContent>
    </Popover>
  </div>
</template>

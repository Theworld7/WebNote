<script setup lang="ts">
import { FolderOpenIcon, LoaderCircleIcon } from "@lucide/vue"
import { Button } from "@/components/ui/button"
import { useWorkspace } from "@/composables/useWorkspace"

/**
 * 编辑区的空态。
 *
 * 四种情况都落在这里，是为了让它们**长得一样**（居中、一行说明）——
 * 分散到各组件里各写一份，间距和字号必然漂移。
 */
const { hasRoot, scanning, isLoadingDocument, tabs, fsHint, openRoot } = useWorkspace()
</script>

<template>
  <div class="flex min-h-0 flex-1 flex-col items-center justify-center gap-3 px-10 text-center">
    <template v-if="scanning">
      <LoaderCircleIcon class="size-[18px] animate-spin text-muted-foreground" />
      <p class="text-[13px] text-muted-foreground">正在读取目录…</p>
    </template>

    <template v-else-if="isLoadingDocument">
      <LoaderCircleIcon class="size-[18px] animate-spin text-muted-foreground" />
      <p class="text-[13px] text-muted-foreground">正在打开笔记…</p>
    </template>

    <template v-else-if="!hasRoot">
      <p class="text-[13px] text-muted-foreground">还没有打开笔记目录</p>
      <Button
        variant="secondary"
        class="h-8 gap-1.5 rounded-[10px] px-3.5 text-[13px]"
        @click="openRoot"
      >
        <FolderOpenIcon class="size-4" />
        <span>打开文件夹</span>
      </Button>
      <p class="max-w-[300px] text-[12px] leading-relaxed text-muted-foreground/70">
        {{ fsHint }}
      </p>
    </template>

    <template v-else>
      <p class="text-[13px] text-muted-foreground">
        {{ tabs.length === 0 ? "从左侧目录里选一篇笔记开始" : "这篇笔记还是空的" }}
      </p>
    </template>
  </div>
</template>

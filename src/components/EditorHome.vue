<script setup lang="ts">
import { computed } from "vue"
import { FolderOpenIcon, LoaderCircleIcon, RefreshCwIcon } from "@lucide/vue"
import { Button } from "@/components/ui/button"
import { useWorkspace } from "@/composables/useWorkspace"

/**
 * 编辑区的空态。
 *
 * 四种情况都落在这里，是为了让它们**长得一样**（居中、一行说明）——
 * 分散到各组件里各写一份，间距和字号必然漂移。
 */
const { hasRoot, scanning, isLoadingDocument, tabs, fsHint, openRoot, restoreOffer, grantRestore } =
  useWorkspace()

/** 只在还缺一次授权时给按钮；目录已失效由顶部的 `fsError` 条提示，不在这里出入口。 */
const pendingGrant = computed(() =>
  restoreOffer.value?.kind === "grant" ? restoreOffer.value : null,
)
</script>

<template>
  <div class="flex min-h-0 flex-1 flex-col items-center justify-center gap-3 px-10 text-center">
    <template v-if="scanning">
      <LoaderCircleIcon class="size-4 animate-spin text-muted-foreground" />
      <p class="text-13 text-muted-foreground">正在读取目录…</p>
    </template>

    <template v-else-if="isLoadingDocument">
      <LoaderCircleIcon class="size-4 animate-spin text-muted-foreground" />
      <p class="text-13 text-muted-foreground">正在打开笔记…</p>
    </template>

    <template v-else-if="!hasRoot">
      <p class="text-13 text-muted-foreground">还没有打开笔记目录</p>
      <!-- 恢复入口放前面：浏览器重新打开时，上一次的目录通常就是想继续用的那个。 -->
      <Button
        v-if="pendingGrant !== null"
        variant="secondary"
        class="h-8 max-w-[18.75rem] gap-1.5 rounded-[10px] px-3.5 text-13"
        @click="grantRestore"
      >
        <RefreshCwIcon class="size-4 shrink-0" />
        <span class="truncate">恢复上次工作区：{{ pendingGrant.name }}</span>
      </Button>
      <Button
        variant="secondary"
        class="h-8 gap-1.5 rounded-[10px] px-3.5 text-13"
        @click="openRoot"
      >
        <FolderOpenIcon class="size-4" />
        <span>打开文件夹</span>
      </Button>
      <p class="max-w-[18.75rem] text-12 leading-relaxed text-muted-foreground/70">
        {{ pendingGrant !== null ? "上次的目录还记着，授权后即可继续" : fsHint }}
      </p>
    </template>

    <template v-else>
      <p class="text-13 text-muted-foreground">
        {{ tabs.length === 0 ? "开始你的想法" : "这篇笔记还是空的" }}
      </p>
    </template>
  </div>
</template>

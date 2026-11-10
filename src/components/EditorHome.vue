<script setup lang="ts">
import { computed } from "vue"
import { FolderOpenIcon, LoaderCircleIcon, RefreshCwIcon, ServerIcon } from "@lucide/vue"
import { Button } from "@/components/ui/button"
import { useWorkspace } from "@/composables/useWorkspace"
import { BTN_BLOCK } from "@/components/ui/button/recipes"

/**
 * 编辑区的空态。
 *
 * 四种情况都落在这里，是为了让它们**长得一样**（居中、一行说明）——
 * 分散到各组件里各写一份，间距和字号必然漂移。
 */
const {
  hasRoot,
  scanning,
  isLoadingDocument,
  tabs,
  fsHint,
  openRoot,
  restoreOffer,
  grantRestore,
  requestWebDav,
} = useWorkspace()

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
        :class="[BTN_BLOCK, 'max-w-[18.75rem]']"
        @click="grantRestore"
      >
        <RefreshCwIcon class="size-4 shrink-0" />
        <span class="truncate">恢复上次工作区：{{ pendingGrant.name }}</span>
      </Button>
      <Button
        variant="secondary"
        :class="BTN_BLOCK"
        @click="openRoot"
      >
        <FolderOpenIcon class="size-4" />
        <span>打开文件夹</span>
      </Button>
      <!-- 与「打开文件夹」并列而不是塞进它的下拉：这两条是同一件事的两种来源，
           只是 WebDAV 还需要填地址与账号，点开是一张表单。 -->
      <Button
        variant="secondary"
        :class="BTN_BLOCK"
        @click="requestWebDav"
      >
        <ServerIcon class="size-4" />
        <span>连接 WebDAV</span>
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

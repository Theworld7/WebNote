<script setup lang="ts">
import { ref } from "vue"
import { XIcon } from "@lucide/vue"
import { usesBuiltinStorage } from "@/lib/fs"

/**
 * 标题栏中段的一行提醒：当前浏览器拿不到完整体验（Firefox / Safari 没有目录选择器，
 * 笔记只能留在浏览器内置存储里）。
 *
 * 为什么从对话框改成这里：它不是要用户做决定的事，弹一次框挡在正文前，比重开一句
 * 提示更烦。写在标题栏中间这片本来就空着的拖拽面上，随时看得见、随手能关掉，
 * 想细看再说。
 *
 * 关掉只是这一程不再出现：下次进入仍会露出来，否则「换个浏览器」这条信息一旦被
 * 关掉就再也传达不到了。桌面端与 Chromium 系不会渲染。
 */
const visible = ref(usesBuiltinStorage())
</script>

<template>
  <div
    v-if="visible"
    class="flex min-w-0 items-center gap-1.5 rounded-full bg-muted py-1 pr-1 pl-2.5"
  >
    <span class="truncate text-12 text-muted-foreground">
      本浏览器无法获得完整体验，建议改用 Chrome 内核浏览器或桌面版
    </span>
    <button
      type="button"
      class="flex size-4 flex-none items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-foreground/10 hover:text-foreground"
      aria-label="关闭提示"
      @click="visible = false"
    >
      <XIcon class="size-2.5" />
    </button>
  </div>
</template>

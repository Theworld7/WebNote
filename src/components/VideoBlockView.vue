<script setup lang="ts">
import type { VideoBlock } from "@/types/workspace"
import { computed, onBeforeUnmount, ref, watch } from "vue"
import { ExternalLinkIcon, RefreshCwIcon, VideoIcon } from "@lucide/vue"
import { Button } from "@/components/ui/button"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { useWorkspace } from "@/composables/useWorkspace"
import { bytesToBlob } from "@/lib/image"
import { describeError } from "@/lib/errors"
import { openExternalUrl } from "@/lib/open-external"
import { fromSegments, toSegments } from "@/lib/paths"
import { isFileDrag, isRemoteVideo, pickVideoFile, videoMimeOf, videoModeOf } from "@/lib/video"
import VideoSourcePanel from "./VideoSourcePanel.vue"

/**
 * 视频块。
 *
 * 两种形态靠地址自己分（`videoModeOf`），模型里没有第二种真相：
 *
 * - **本地 / 直链**：`<video controls>`。桌面端把盘上路径交给 asset 协议
 *   （`streamUrl`），播放器自己按 range 请求分片——片子多大都不进 JS 内存。浏览器端
 *   没有这条通道，退回「整段读成字节再包 blob URL」：沙箱里的 `tauri://` 与
 *   `http://localhost` 都不认「相对笔记文件」的路径，而块里存的正是那条相对路径
 *   （序列化要它，见 `VideoBlock`）。
 * - **站点播放器**：`<iframe>`。嵌不嵌得进去由对方的 X-Frame-Options 说了算，我们
 *   无从预判，所以常备一个「在新窗口打开」的出口。
 *
 * iframe 会吞掉双击，进不了编辑态 —— 换片入口因此是 hover 浮出的按钮，与 HTML 块
 * 同一套做法。
 */
const props = defineProps<{ block: VideoBlock }>()

const { setVideoSrc, importVideoFile, activePath, fs, root } = useWorkspace()

const mode = computed(() => (props.block.src === "" ? "empty" : videoModeOf(props.block.src)))

/** 本地视频的播放地址：盘上那张片子包出来的 blob URL，或直链本身。 */
const playUrl = ref("")
const loadError = ref("")
const loading = ref(false)
const replaceOpen = ref(false)
const dropActive = ref(false)

/**
 * 空块被编辑器送来焦点时（刚插入的块）把光标转给输入框 —— 插完就能直接粘链接。
 * 面板的 `autofocus` 只在挂载时生效，而焦点是挂载之后才到的，所以这里直接 focus。
 */
function focusPanel(event: FocusEvent) {
  const host = event.currentTarget
  if (!(host instanceof HTMLElement)) return
  const input = host.querySelector("input")
  if (input instanceof HTMLInputElement) input.focus()
}

/** 只为本地文件创建，卸载 / 换片时必须回收 —— 一条 blob URL 会把整段视频钉在内存里。 */
let objectUrl: string | null = null

function release() {
  if (objectUrl !== null) {
    URL.revokeObjectURL(objectUrl)
    objectUrl = null
  }
  playUrl.value = ""
}

async function loadLocal(src: string) {
  release()
  loadError.value = ""
  if (src === "" || videoModeOf(src) !== "file") return

  // 直链：浏览器自己能取，不必经我们读一遍。
  if (isRemoteVideo(src)) {
    playUrl.value = src
    return
  }

  const driver = fs.value
  const current = root.value
  if (driver === null || current === null) return

  loading.value = true
  try {
    // 块里存的是相对笔记的路径；读盘要的是工作区路径，两者在这里对上。
    const noteDir = toSegments(activePath.value).slice(0, -1)
    const path = fromSegments([...noteDir, ...src.split("/")])

    // 桌面端优先走 asset 协议：播放器自己发 range 请求，片子多大都不必先塞进内存。
    const streamed = driver.streamUrl(current, path)
    if (streamed !== null) {
      playUrl.value = streamed
      return
    }

    const bytes = await driver.readBinary(current, path)
    objectUrl = URL.createObjectURL(bytesToBlob(bytes, videoMimeOf(path)))
    playUrl.value = objectUrl
  } catch (error) {
    loadError.value = describeError(error)
  } finally {
    loading.value = false
  }
}

watch(
  () => props.block.src,
  (src) => void loadLocal(src),
  { immediate: true },
)

onBeforeUnmount(release)

function apply(src: string) {
  setVideoSrc(props.block.id, src)
  replaceOpen.value = false
}

/** 换片也走同一条入口：本地文件先搬进工作区，网络地址先归一成 embed。 */
function onDragOver(event: DragEvent) {
  if (!isFileDrag(event.dataTransfer)) return
  // 放行 drop 并拦住冒泡：编辑器那一层收到就变成「在落点插入一个新块」了。
  event.preventDefault()
  event.stopPropagation()
  dropActive.value = true
}

async function onDrop(event: DragEvent) {
  if (!isFileDrag(event.dataTransfer)) return
  event.preventDefault()
  event.stopPropagation()
  dropActive.value = false
  const file = pickVideoFile(event.dataTransfer)
  if (file === null) return
  apply(await importVideoFile(file))
}
</script>

<template>
  <div
    class="group/video relative transition-shadow"
    :class="dropActive && 'rounded-lg ring-2 ring-selection-strong'"
    @dragover="onDragOver"
    @dragleave="dropActive = false"
    @drop="onDrop"
  >
    <!-- 站点播放器。allow 放开全屏 / 画中画 / 自动播放：缺了只是「能看但用不全」。 -->
    <iframe
      v-if="mode === 'embed'"
      :src="block.src"
      class="my-1 block aspect-video w-full rounded-lg border-0 bg-black"
      allow="autoplay; fullscreen; picture-in-picture; encrypted-media"
      allowfullscreen
    />

    <!-- 本地 / 直链：交给浏览器原生播放器。 -->
    <template v-else-if="mode === 'file'">
      <video
        v-if="playUrl !== ''"
        :src="playUrl"
        controls
        class="my-1 block w-full rounded-lg bg-black"
      />
      <div
        v-else-if="loading"
        class="my-1 flex h-16 items-center justify-center rounded-lg bg-muted text-12 text-muted-foreground"
      >
        正在读取视频…
      </div>
      <div
        v-else
        class="my-1 flex items-start gap-2.5 rounded-lg border border-dashed border-line bg-muted/40 px-3 py-2.5"
      >
        <VideoIcon class="mt-0.5 size-3.5 shrink-0 text-muted-foreground" />
        <div class="min-w-0">
          <p class="text-12 text-muted-foreground">视频打不开 —— 文件可能被移动或删掉了。</p>
          <p class="mt-1 truncate font-mono text-11 text-muted-foreground/70" :title="loadError">
            {{ block.src }}
          </p>
        </div>
      </div>
    </template>

    <!-- 空块：面板摊在块里，看得见的入口比藏起来的按钮好。 -->
    <div
      v-else
      :data-editable="block.id"
      tabindex="0"
      class="my-1 rounded-lg bg-muted p-3 outline-none focus-visible:ring-2 focus-visible:ring-ring"
      @focus="focusPanel"
    >
      <div class="mb-2 flex items-center gap-1.5 text-12 text-muted-foreground">
        <VideoIcon class="size-3.5" />
        还没有视频 —— 粘贴链接，或选一个本地文件
      </div>
      <VideoSourcePanel @pick="apply" />
    </div>

    <!-- 有片子时的换片入口：hover 浮现，浮层里是同一块面板。 -->
    <Popover v-if="mode !== 'empty'" v-model:open="replaceOpen">
      <PopoverTrigger as-child>
        <Button
          size="sm"
          class="absolute right-2 top-3 h-7 gap-1.5 px-2.5 opacity-0 shadow-island transition-opacity group-hover/video:opacity-100 focus-visible:opacity-100"
        >
          <RefreshCwIcon class="size-3.5" />
          换视频
        </Button>
      </PopoverTrigger>
      <PopoverContent
        align="end"
        class="w-auto rounded-island p-3 shadow-pop ring-1 ring-line/70"
        @open-auto-focus.prevent
      >
        <VideoSourcePanel autofocus @pick="apply" />
      </PopoverContent>
    </Popover>

    <!-- 嵌入被对方拒绝时看不出「是坏了还是不让嵌」，给一个能走的出口。 -->
    <Button
      v-if="mode === 'embed'"
      size="sm"
      variant="ghost"
      class="absolute right-2 top-12 h-7 gap-1.5 rounded-md border border-line bg-background/80 px-2.5 text-12 shadow-xs backdrop-blur-sm reduce-transparency:bg-background reduce-transparency:backdrop-blur-none opacity-0 transition-opacity group-hover/video:opacity-100 focus-visible:opacity-100"
      @click="openExternalUrl(block.src)"
    >
      <ExternalLinkIcon class="size-3.5" />
      在新窗口打开
    </Button>
  </div>
</template>

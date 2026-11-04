<script setup lang="ts">
import { onMounted, ref } from "vue"
import { FolderOpenIcon } from "@lucide/vue"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { useToast } from "@/composables/useToast"
import { useWorkspace } from "@/composables/useWorkspace"
import { describeError } from "@/lib/errors"
import { toEmbedUrl } from "@/lib/video"

/**
 * 视频来源面板 —— 填链接 + 选本地文件两条入口。
 *
 * 被两处复用：视频块空态的内联面板、hover 浮层里的「换视频」。
 * 与 `ImageSourcePanel` 的分工一样：拖入 / 粘贴属于块级的事，面板只管「主动挑」。
 *
 * 链接一律先过 `toEmbedUrl`：用户粘的通常是 B站 / YouTube 的**页面**地址，
 * 直接塞进 iframe 会被对方拒掉，转成 embed 地址才放得出来。
 *
 * 选中的本地文件不是「读成字符串」，而是搬进工作区（`importVideoFile`），
 * 面板拿回来的是相对笔记的路径。
 */
const props = withDefaults(
  defineProps<{
    /** 挂载即聚焦输入框。浮层里要，内联引导里不要（会把正文焦点抢走）。 */
    autofocus?: boolean
  }>(),
  { autofocus: false },
)

const emit = defineEmits<{ (event: "pick", src: string): void }>()

const { notify } = useToast()
const { importVideoFile } = useWorkspace()

const rootRef = ref<HTMLElement | null>(null)
const fileRef = ref<HTMLInputElement | null>(null)
const draft = ref("")
const busy = ref(false)

onMounted(() => {
  if (!props.autofocus) return
  const input = rootRef.value?.querySelector("input")
  if (input instanceof HTMLInputElement) input.focus()
})

function applyUrl() {
  const raw = draft.value.trim()
  if (raw === "") return
  emit("pick", toEmbedUrl(raw))
  draft.value = ""
}

async function onFileChange(event: Event) {
  const input = event.target
  if (!(input instanceof HTMLInputElement)) return
  const file = input.files?.[0]
  // 复位：不清空的话，同一个文件第二次选不会触发 change。
  input.value = ""
  if (file === undefined) return

  busy.value = true
  try {
    emit("pick", await importVideoFile(file))
  } catch (error) {
    // 与图片面板同一条口径：写不进去得说，否则面板没有任何反应。
    notify(`插入视频失败：${describeError(error)}`, "error")
  } finally {
    busy.value = false
  }
}
</script>

<template>
  <div ref="rootRef" class="flex w-64 flex-col gap-2">
    <div class="flex gap-1.5">
      <Input
        v-model="draft"
        placeholder="粘贴 B站 / YouTube 链接"
        class="h-7 text-12"
        @keydown.enter.prevent="applyUrl"
      />
      <Button size="sm" class="h-7 shrink-0 px-2.5" :disabled="draft.trim() === ''" @click="applyUrl">
        应用
      </Button>
    </div>

    <Button
      variant="secondary"
      size="sm"
      class="h-7 justify-start gap-1.5 px-2.5 text-12"
      :disabled="busy"
      @click="fileRef?.click()"
    >
      <FolderOpenIcon class="size-3.5" />
      {{ busy ? "写入中…" : "选择本地视频" }}
    </Button>

    <p class="text-11 leading-[1.5] text-muted-foreground">
      本地视频会复制一份到笔记旁边的资源目录，也可以直接把文件拖进来
    </p>

    <input ref="fileRef" type="file" accept="video/*" class="hidden" @change="onFileChange" />
  </div>
</template>

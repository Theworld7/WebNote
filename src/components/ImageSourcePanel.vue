<script setup lang="ts">
import { onMounted, ref } from "vue"
import { FolderOpenIcon } from "@lucide/vue"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { readImageFile } from "@/lib/image"

/**
 * 图片来源面板 —— 填链接 + 选本地文件两条入口。
 *
 * 被两处复用：图片块的 hover 浮层（有图时换图）与空态引导卡片。
 * 拖入 / 粘贴不在这里 —— 那是块级和编辑器级的事，面板只管「主动挑图」。
 */
const props = withDefaults(
  defineProps<{
    /** 挂载即聚焦输入框。浮层里要，内联引导卡片里不要（会把正文焦点抢走）。 */
    autofocus?: boolean
  }>(),
  { autofocus: false },
)

const emit = defineEmits<{ (event: "pick", src: string): void }>()

const rootRef = ref<HTMLElement | null>(null)
const fileRef = ref<HTMLInputElement | null>(null)
const draft = ref("")
const busy = ref(false)

/**
 * 聚焦输入框走「根节点里找 input」而不是给 shadcn 的 Input 挂 ref：
 * 模板 ref 拿到的是组件实例，拿元素还得绕 `$el`，而这里的根是普通 div，一行搞定。
 */
onMounted(() => {
  if (!props.autofocus) return
  const input = rootRef.value?.querySelector("input")
  if (input instanceof HTMLInputElement) input.focus()
})

function applyUrl() {
  const url = draft.value.trim()
  if (url === "") return
  emit("pick", url)
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
    emit("pick", await readImageFile(file))
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
        placeholder="粘贴图片链接"
        class="h-7 text-[12.5px]"
        @keydown.enter.prevent="applyUrl"
      />
      <Button size="sm" class="h-7 shrink-0 px-2.5" :disabled="draft.trim() === ''" @click="applyUrl">
        应用
      </Button>
    </div>

    <Button
      variant="secondary"
      size="sm"
      class="h-7 justify-start gap-1.5 px-2.5 text-[12.5px]"
      :disabled="busy"
      @click="fileRef?.click()"
    >
      <FolderOpenIcon class="size-3.5" />
      {{ busy ? "读取中…" : "选择本地图片" }}
    </Button>

    <p class="text-[11px] leading-[1.5] text-muted-foreground">
      也可以把图片直接拖进来，或粘贴进来
    </p>

    <input ref="fileRef" type="file" accept="image/*" class="hidden" @change="onFileChange" />
  </div>
</template>

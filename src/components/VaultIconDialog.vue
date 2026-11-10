<script setup lang="ts">
import { computed, ref, watch } from "vue"
import { GlobeIcon, ImagePlusIcon, KeyRoundIcon } from "@lucide/vue"
import { AlertDialog, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { isImageFile, readImageFile } from "@/lib/image"
import { BTN_TEXT } from "@/components/ui/button/recipes"

/**
 * 密码本条目的图标配置弹窗。
 *
 * 两条路二选一：**本地图片**（读成 data URI，自包含、离线也在）或**在线地址**
 * （填一个 URL，省空间、但要联网才显示）。无论哪条，落进图标格的都是一个能直接
 * 当 `<img src>` 用的字符串 —— 与数据表图片列同一口径，不另立一套存储。
 *
 * 预览是即时的：选了文件、或地址输完，上面那块立刻画出来；地址加载不出来就如实
 * 说一句，而不是留一块空白让人猜是网慢还是填错了。
 */
const props = defineProps<{
  /** 弹窗开合。 */
  open: boolean
  /** 当前图标值（data URI 或 URL）；空串 = 还没有图标。 */
  value: string
}>()

const emit = defineEmits<{
  close: []
  /** 提交新值。空串 = 清除图标。 */
  confirm: [value: string]
}>()

type IconMode = "local" | "url"

const mode = ref<IconMode>("url")
/** 本地图片读出来的 data URI。 */
const localSrc = ref("")
/** 在线地址输入框的值。 */
const urlSrc = ref("")

/** 当前生效的候选值 —— 预览与提交都认它。 */
const draft = computed(() => (mode.value === "local" ? localSrc.value : urlSrc.value.trim()))

/** 预览图的加载态。地址可能打不开，要如实说，不能停在「转圈」。 */
const previewState = ref<"empty" | "ok" | "error">("empty")

// 候选值一变就重判预览：先乐观地当它能画出来，真加载失败再由 img 的 error 事件翻案。
watch(draft, (value) => {
  previewState.value = value === "" ? "empty" : "ok"
})

/** 每次打开都按当前值定初始形态：data URI 走本地，其余走在线地址。 */
watch(
  () => props.open,
  (open) => {
    if (!open) return
    const value = props.value
    if (value.startsWith("data:")) {
      mode.value = "local"
      localSrc.value = value
      urlSrc.value = ""
    } else {
      mode.value = "url"
      urlSrc.value = value
      localSrc.value = ""
    }
    previewState.value = value === "" ? "empty" : "ok"
  },
)

const fileInput = ref<HTMLInputElement | null>(null)

function pickFile(): void {
  fileInput.value?.click()
}

async function onFile(event: Event): Promise<void> {
  const target = event.target
  if (!(target instanceof HTMLInputElement) || target.files === null) return
  const file = target.files[0]
  // 先清空再读：清掉后重选同一个文件也能触发 change。
  target.value = ""
  if (file === undefined || !isImageFile(file)) return
  localSrc.value = await readImageFile(file)
  mode.value = "local"
}

function submit(): void {
  emit("confirm", draft.value)
}

function clear(): void {
  emit("confirm", "")
}
</script>

<template>
  <AlertDialog :open="open" @update:open="emit('close')">
    <AlertDialogContent class="max-w-sm" @open-auto-focus.prevent>
      <AlertDialogHeader>
        <AlertDialogTitle class="text-14">配置图标</AlertDialogTitle>
        <AlertDialogDescription class="text-12">
          选一张本地图片，或填一个在线图片地址 —— 下面会即时预览。
        </AlertDialogDescription>
      </AlertDialogHeader>

      <!-- 预览：所见即所存。地址加载不出来时如实说，不留空白。 -->
      <div class="flex items-center gap-3 rounded-md border border-line bg-muted/30 px-3 py-3" data-vault-icon-preview>
        <div class="grid size-16 shrink-0 place-items-center overflow-hidden rounded-md bg-card ring-1 ring-line/70">
          <img
            v-if="draft !== '' && previewState !== 'error'"
            :src="draft"
            alt="图标预览"
            class="size-full object-cover"
            @load="previewState = 'ok'"
            @error="previewState = 'error'"
          >
          <KeyRoundIcon v-else class="size-5 text-muted-foreground" />
        </div>
        <div class="min-w-0 flex-1">
          <p v-if="draft === ''" class="text-12 text-muted-foreground">还没有图标</p>
          <p v-else-if="previewState === 'error'" class="text-12 text-destructive" data-vault-icon-broken>这个地址加载不出来</p>
          <p v-else class="text-12 text-foreground">预览</p>
          <p class="mt-0.5 text-11 text-muted-foreground/70">
            {{ mode === "local" ? "本地图片 · 存进笔记，离线也在" : "在线地址 · 要联网才显示" }}
          </p>
        </div>
      </div>

      <!-- 二选一：本地图片 / 在线地址。 -->
      <div class="flex gap-1 rounded-md bg-muted p-0.5">
        <button
          type="button"
          class="flex h-7 flex-1 items-center justify-center gap-1 rounded text-12 transition-colors"
          :class="mode === 'local' ? 'bg-card text-foreground ring-1 ring-line/70' : 'text-muted-foreground hover:text-foreground'"
          data-vault-icon-mode-local
          @click="mode = 'local'"
        >
          <ImagePlusIcon class="size-3.5" />本地图片
        </button>
        <button
          type="button"
          class="flex h-7 flex-1 items-center justify-center gap-1 rounded text-12 transition-colors"
          :class="mode === 'url' ? 'bg-card text-foreground ring-1 ring-line/70' : 'text-muted-foreground hover:text-foreground'"
          data-vault-icon-mode-url
          @click="mode = 'url'"
        >
          <GlobeIcon class="size-3.5" />在线地址
        </button>
      </div>

      <!-- 本地：挑一个文件，读成 data URI。 -->
      <div v-if="mode === 'local'" class="flex items-center gap-2">
        <input ref="fileInput" type="file" accept="image/*" class="hidden" data-vault-icon-file @change="onFile">
        <Button variant="ghost" size="sm" class="h-8 shrink-0 text-13" data-vault-icon-pick @click="pickFile">
          <ImagePlusIcon class="size-3.5" />{{ localSrc === "" ? "选择图片…" : "重新选择…" }}
        </Button>
        <span class="min-w-0 flex-1 truncate text-11 text-muted-foreground">
          {{ localSrc === "" ? "png / jpg / gif / webp / svg" : "已选本地图片" }}
        </span>
      </div>

      <!-- 在线：填一个地址。 -->
      <Input
        v-else
        v-model="urlSrc"
        type="url"
        placeholder="https://example.com/icon.png"
        class="h-8 text-13 md:text-13"
        spellcheck="false"
        data-vault-icon-url
        @keydown.enter.prevent="submit"
      />

      <AlertDialogFooter>
        <AlertDialogCancel as-child>
          <Button variant="ghost" size="sm" :class="BTN_TEXT">取消</Button>
        </AlertDialogCancel>
        <Button
          v-if="props.value !== ''"
          variant="ghost"
          size="sm"
          class="text-13 text-destructive hover:text-destructive"
          data-vault-icon-clear
          @click="clear"
        >
          清除图标
        </Button>
        <Button size="sm" :class="BTN_TEXT" data-vault-icon-save @click="submit">保存</Button>
      </AlertDialogFooter>
    </AlertDialogContent>
  </AlertDialog>
</template>

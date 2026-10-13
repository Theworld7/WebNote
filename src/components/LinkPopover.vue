<script setup lang="ts">
import type { LinkShape } from "@/types/workspace"
import { computed, onMounted, ref, watch } from "vue"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"

/**
 * 链接编辑浮层：输地址、挑形态（文本链接 / 书签卡片）、可移除。
 *
 * 打开时选区已被记成字符区间（见 BlockItem），浮层里随便聚焦都不丢 ——
 * 确认时按区间改 runs，再由 paint 把选区装回去。所以这里不需要 keepSelection 技巧，
 * 输入框可以正常拿焦点。
 */
const props = defineProps<{
  /** 已有链接时的回显值；新建时为空串。 */
  href: string
  /** 已有链接时的形态；新建时恒为 text。 */
  shape: LinkShape
  /** 视口坐标，浮条以此为底部中心点（与格式条同一个锚点）。 */
  anchor: { top: number; left: number }
}>()

const emit = defineEmits<{
  /** 确认。href 为空串表示移除链接。 */
  (event: "apply", href: string, shape: LinkShape): void
  (event: "close"): void
}>()

const url = ref(props.href)
const shape = ref<LinkShape>(props.shape)

/** 动态插入的 DOM 上原生 autofocus 不生效（Chromium 只认首屏解析），挂载后手动聚焦。 */
const root = ref<HTMLElement | null>(null)
onMounted(() => {
  root.value?.querySelector("input")?.focus()
})

/** props 是打开那一刻的快照，仅重开时重置草稿 —— 编辑过程中不回写。 */
watch(
  () => props.href,
  (value) => {
    url.value = value
  },
)

const FORMS: Readonly<{ value: LinkShape; label: string }[]> = [
  { value: "text", label: "文本链接" },
  { value: "card", label: "书签卡片" },
]

const canApply = computed(() => url.value.trim() !== "" || props.href !== "")

function submit() {
  if (!canApply.value) return
  emit("apply", url.value.trim(), shape.value)
}

function onKeydown(event: KeyboardEvent) {
  if (event.key === "Enter") {
    event.preventDefault()
    submit()
    return
  }
  if (event.key === "Escape") {
    event.preventDefault()
    emit("close")
  }
}

/** 与格式条按钮同一规格的文字按钮。 */
const FORM_BUTTON =
  "h-6 rounded-[5px] px-2 text-[12px] text-muted-foreground hover:text-foreground"
const FORM_ACTIVE = "bg-accent text-foreground"
</script>

<template>
  <div
    ref="root"
    class="fixed z-50 w-72 rounded-island border border-line bg-background p-2 shadow-pop"
    :style="{ top: `${anchor.top}px`, left: `${anchor.left}px`, transform: 'translate(-50%, -100%)' }"
    @keydown="onKeydown"
  >
    <Input
      v-model="url"
      class="h-7 text-[13px]"
      placeholder="粘贴或输入链接地址"
      spellcheck="false"
    />

    <div class="mt-2 flex items-center gap-1">
      <span class="text-[11px] text-muted-foreground">形态</span>
      <Button
        v-for="form in FORMS"
        :key="form.value"
        variant="ghost"
        :class="[
          FORM_BUTTON,
          shape === form.value && FORM_ACTIVE,
        ]"
        :aria-pressed="shape === form.value"
        @click="shape = form.value"
      >
        {{ form.label }}
      </Button>
    </div>

    <div class="mt-2 flex items-center justify-between">
      <Button
        v-if="props.href !== ''"
        variant="ghost"
        class="h-6 rounded-[5px] px-2 text-[12px] text-muted-foreground hover:text-destructive"
        @click="emit('apply', '')"
      >
        移除链接
      </Button>
      <span v-else />
      <Button
        variant="ghost"
        class="h-6 rounded-[5px] bg-accent px-2.5 text-[12px] text-accent-foreground"
        :disabled="!canApply"
        @click="submit"
      >
        应用
      </Button>
    </div>
  </div>
</template>

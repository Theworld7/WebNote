<script setup lang="ts">
import type { LinkShape } from "@/types/workspace"
import { computed, onBeforeUnmount, onMounted, ref, watch } from "vue"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"

/**
 * 链接编辑浮层：显示内容、地址、形态（文本链接 / 书签卡片），可移除、可取消。
 *
 * 打开时选区已被记成字符区间（见 useInlineToolbar），浮层里随便聚焦都不丢 ——
 * 确认 / 取消时按区间改 runs 或还原选区。所以这里不需要 keepSelection 技巧，
 * 输入框可以正常拿焦点。
 */
const props = defineProps<{
  /** 已有链接的回显：显示内容（区间里的文字）；新建时为选中的那一段文字。 */
  text: string
  /** 已有链接时回显值；新建时为空串。 */
  href: string
  /** 已有链接时的形态；新建时恒为 text。 */
  shape: LinkShape
  /** 视口坐标，浮条以此为底部中心点（与格式条同一个锚点）。 */
  anchor: { top: number; left: number }
}>()

const emit = defineEmits<{
  /** 确认。href 为空串表示移除链接（显示内容照旧留下的那份）。 */
  (event: "apply", text: string, href: string, shape: LinkShape): void
  /** 收起。restoreFocus 为假表示焦点已被那次点击带走，不必再还给正文。 */
  (event: "close", restoreFocus?: boolean): void
}>()

const text = ref(props.text)
const url = ref(props.href)
const shape = ref(props.shape)

/** 动态插入的 DOM 上原生 autofocus 不生效（Chromium 只认首屏解析），挂载后手动聚焦。 */
const root = ref<HTMLElement | null>(null)

/** props 是打开那一刻的快照，仅重开时重置草稿 —— 编辑过程中不回写。 */
watch(
  () => props.text,
  (value) => {
    text.value = value
  },
)

watch(
  () => props.href,
  (value) => {
    url.value = value
  },
)

/**
 * 点浮层外收起，但不改数据（走取消）。
 *
 * 用捕获阶段的 mousedown 而不是 click：点在别处时用户要的是「离开」，不该等
 * 到 click —— 那时正文的光标已经落好了，晚一步再收会显得迟钝。
 */
function onDocMouseDown(event: MouseEvent) {
  if (root.value?.contains(event.target as Node) !== true) emit("close", false)
}

onMounted(() => {
  document.addEventListener("mousedown", onDocMouseDown, true)
  // 新建链接时最想填的是地址，编辑已有链接也一样（改文字随时能改，地址才是要重贴的）。
  const input = root.value?.querySelector<HTMLInputElement>("[data-url-input]")
  input?.focus()
})

onBeforeUnmount(() => {
  document.removeEventListener("mousedown", onDocMouseDown, true)
})

const FORMS: Readonly<{ value: LinkShape; label: string }[]> = [
  { value: "text", label: "文本链接" },
  { value: "card", label: "书签卡片" },
]

/** 显示内容不能空（空的链接在正文里不可见）；地址可以为空，但那样不能新建链接。 */
const canApply = computed(() => text.value.trim() !== "" && (url.value.trim() !== "" || props.href !== ""))

/** 移除链接时带的文字：编辑中的显示内容有效就带上，否则保持原样 —— 只断地址，文字留着。 */
const removedText = computed(() => text.value.trim() || props.text)

function submit() {
  if (!canApply.value) return
  // 显示内容原样交出：首尾空格可能是排版本意，判断「空不空」才用 trim。
  emit("apply", text.value, url.value.trim(), shape.value)
}

function cancel() {
  emit("close", true)
}

function onKeydown(event: KeyboardEvent) {
  if (event.key === "Enter") {
    event.preventDefault()
    submit()
    return
  }
  if (event.key === "Escape") {
    event.preventDefault()
    cancel()
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
    data-link-popover
    class="fixed z-50 w-80 rounded-island border border-line bg-popover p-2 shadow-pop"
    :style="{ top: `${anchor.top}px`, left: `${anchor.left}px`, transform: 'translate(-50%, -100%)' }"
    @keydown="onKeydown"
  >
    <!-- 两个框都可能有值，靠左侧标签区分「改哪个」—— 只写 placeholder 的话，
         填上值之后两个框就长得一样了。 -->
    <div class="flex items-center gap-1.5">
      <span class="w-7 shrink-0 text-[11px] text-muted-foreground">文字</span>
      <Input
        v-model="text"
        data-text-input
        class="h-7 text-[13px]"
        placeholder="链接上显示的字"
        spellcheck="false"
      />
    </div>
    <div class="mt-1.5 flex items-center gap-1.5">
      <span class="w-7 shrink-0 text-[11px] text-muted-foreground">链接</span>
      <Input
        v-model="url"
        data-url-input
        class="h-7 text-[13px]"
        placeholder="粘贴网址，或填工作区里的笔记 / 数据表路径"
        spellcheck="false"
      />
    </div>

    <!-- 三行的左端共用同一列标签（w-7 + 同一档 gap）：「形态」的按钮组与上面两个
         输入框的左缘对齐，否则只有这行往外凸 6px，看着像没对齐。 -->
    <div class="mt-2 flex items-center gap-1.5">
      <span class="w-7 shrink-0 text-[11px] text-muted-foreground">形态</span>
      <span class="flex items-center gap-1">
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
      </span>
    </div>

    <div class="mt-2 flex items-center justify-between">
      <Button
        v-if="props.href !== ''"
        variant="ghost"
        class="h-6 rounded-[5px] px-2 text-[12px] text-muted-foreground hover:text-destructive"
        @click="emit('apply', removedText, '', 'text')"
      >
        移除链接
      </Button>
      <span v-else />
      <span class="flex items-center gap-1">
        <Button
          variant="ghost"
          class="h-6 rounded-[5px] px-2 text-[12px] text-muted-foreground hover:text-foreground"
          @click="cancel"
        >
          取消
        </Button>
        <Button
          variant="ghost"
          class="h-6 rounded-[5px] bg-accent px-2.5 text-[12px] text-accent-foreground"
          :disabled="!canApply"
          @click="submit"
        >
          应用
        </Button>
      </span>
    </div>
  </div>
</template>

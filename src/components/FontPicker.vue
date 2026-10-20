<script setup lang="ts">
import type { FontFaceKind } from "@/lib/fonts"
import { computed, nextTick, ref, watch } from "vue"
import { CheckIcon, ChevronDownIcon } from "@lucide/vue"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { previewFontStack } from "@/lib/fonts"

/**
 * 字体选择框：Popover + 搜索 + 每个候选用它自己的字形渲染。
 *
 * 为什么不用 select：系统字体常有三四百个，滚一列无搜索的名字是找不到字的；
 * 而且「选字体」这件事本身要靠看 —— 名字用该字体画出来，比一串族名有用得多。
 *
 * 空串是「系统默认」这一项的值，与 `useSettings` 里字体偏好的语义一致，
 * 不需要额外的哨兵值。
 */
const props = defineProps<{
  /** 当前 family 名。空串 = 系统默认栈。 */
  modelValue: string
  /** 候选（已排序去重）。本机没有的旧值不会出现在这里，但当前值照样显示在触发器上。 */
  options: readonly string[]
  /** 内容是 sans 还是 mono —— 只影响预览项的通用族兜底。 */
  kind: FontFaceKind
}>()

const emit = defineEmits<{ (event: "update:modelValue", value: string): void }>()

const open = ref(false)
const keyword = ref("")
const searchRef = ref<HTMLInputElement | null>(null)

watch(open, async (value) => {
  if (!value) {
    keyword.value = ""
    return
  }
  await nextTick()
  searchRef.value?.focus()
})

/** 大小写不敏感的包含匹配。三五百条名字，线性过滤足够。 */
const matches = computed(() => {
  const key = keyword.value.trim().toLowerCase()
  if (key === "") return props.options
  return props.options.filter((name) => name.toLowerCase().includes(key))
})

function pick(name: string) {
  emit("update:modelValue", name)
  open.value = false
}

/** 输入完直接回车选第一个 —— 知道字体名的人不必再点一下。 */
function pickFirst() {
  const first = matches.value[0]
  if (first !== undefined) pick(first)
}

/**
 * 粗体 / 斜体这类变体可以自己带族名后缀（"Arial Black" 就是独立家族），
 * 预览时直接按 family 用；缺字由通用族接住。
 */
function preview(name: string): Record<string, string> {
  return { fontFamily: previewFontStack(name, props.kind) }
}
</script>

<template>
  <Popover v-model:open="open">
    <PopoverTrigger as-child>
      <button
        type="button"
        class="flex w-full items-center justify-between gap-2 rounded-[9px] border border-line px-2.5 py-1.5 text-left transition-colors hover:border-foreground/15 hover:bg-muted/50"
        :aria-label="`字体：${modelValue === '' ? '系统默认' : modelValue}`"
      >
        <span
          class="min-w-0 flex-1 truncate text-[13px] text-foreground"
          :style="modelValue === '' ? undefined : preview(modelValue)"
        >
          {{ modelValue === "" ? "系统默认" : modelValue }}
        </span>
        <ChevronDownIcon class="size-3.5 flex-none text-muted-foreground" />
      </button>
    </PopoverTrigger>

    <!-- 焦点交给我们自己的搜索框：Popover 默认把焦点给内容容器，那样打开后直接打字没反应。 -->
    <PopoverContent
      class="w-[248px] gap-0 p-0"
      align="start"
      @open-auto-focus="(event: Event) => event.preventDefault()"
    >
      <div class="border-b border-line p-1.5">
        <input
          ref="searchRef"
          v-model="keyword"
          type="text"
          spellcheck="false"
          placeholder="搜索字体"
          class="h-7 w-full rounded-[6px] bg-muted px-2 text-[12.5px] text-foreground outline-none placeholder:text-muted-foreground"
          @keydown.enter.prevent="pickFirst"
        >
      </div>

      <div class="max-h-[260px] overflow-y-auto p-1">
        <button
          type="button"
          class="flex w-full items-center gap-2 rounded-[7px] px-2 py-1.5 text-left text-[13px] transition-colors"
          :class="modelValue === '' ? 'bg-selection text-selection-foreground' : 'hover:bg-muted'"
          @click="pick('')"
        >
          <span class="min-w-0 flex-1 truncate">系统默认</span>
          <CheckIcon v-if="modelValue === ''" class="size-3.5 flex-none" />
        </button>

        <button
          v-for="name in matches"
          :key="name"
          type="button"
          class="flex w-full items-center gap-2 rounded-[7px] px-2 py-1.5 text-left text-[13px] transition-colors"
          :class="modelValue === name ? 'bg-selection text-selection-foreground' : 'hover:bg-muted'"
          @click="pick(name)"
        >
          <span class="min-w-0 flex-1 truncate" :style="preview(name)">{{ name }}</span>
          <CheckIcon v-if="modelValue === name" class="size-3.5 flex-none" />
        </button>

        <p v-if="matches.length === 0" class="px-2 py-3 text-center text-[11.5px] text-muted-foreground">
          没有匹配的字体
        </p>
      </div>
    </PopoverContent>
  </Popover>
</template>

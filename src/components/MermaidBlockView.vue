<script setup lang="ts">
import type { MermaidBlock } from "@/types/workspace"
import { nextTick, ref, watch } from "vue"
import { PencilIcon } from "@lucide/vue"
import { Button } from "@/components/ui/button"
import { useWorkspace } from "@/composables/useWorkspace"
import { focusEditable } from "@/lib/dom"
import { renderMermaid } from "@/lib/mermaid"

/**
 * Mermaid 图块。
 *
 * 双态：有源码就画图，双击图（或 hover 上的按钮）切到源码；源码空则直接摊开编辑区
 * —— 与图片块「无图时把来源面板摊在块里」同一个判断：空块必须给一个看得见的入口，
 * 藏起来的按钮对空块毫无意义。
 *
 * 源码编辑区挂 `data-editable`，于是 `findEditable` 能找到它 —— 新插入 / 刚转换过来的
 * 块由 `BlockEditor` 统一聚焦，不必在这里自己抢焦点（自己抢会在「打开一篇含空图块的
 * 笔记」时把焦点从正文上拽走）。
 */
const props = defineProps<{ block: MermaidBlock }>()

const { setMermaidSource } = useWorkspace()

/** 空源码直接进编辑态。 */
const editing = ref(props.block.source.trim() === "")
const draft = ref(props.block.source)

const svg = ref("")
const error = ref("")

const textareaRef = ref<HTMLTextAreaElement | null>(null)

/** 源码框的占位示例。写成常量而不是模板属性：属性里的 `&#10;` 会不会被解码要看编译器脸色。 */
const PLACEHOLDER = "graph TD\n  A[开始] --> B[结束]"

/**
 * 渲染序号的守卫。
 *
 * 渲染是异步的，而用户会连着改源码 —— 先发的请求后回来就会把新图盖成旧图。
 * 每次渲染领一个号，回来时对不上就丢弃。
 */
let renderToken = 0

watch(
  () => props.block.source,
  (source) => {
    void render(source)
  },
  { immediate: true },
)

async function render(source: string) {
  const token = (renderToken += 1)

  // 空源码不渲染（也不算错）：它只是还没写，不是画不出来。
  if (source.trim() === "") {
    svg.value = ""
    error.value = ""
    return
  }

  try {
    const result = await renderMermaid(props.block.id, source)
    if (token !== renderToken) return
    svg.value = result
    error.value = ""
  } catch (failure) {
    if (token !== renderToken) return
    svg.value = ""
    error.value = failure instanceof Error ? failure.message : String(failure)
  }
}

/** 让输入区跟着内容长高 —— textarea 不会自己长。 */
function autosize() {
  const element = textareaRef.value
  if (element === null) return
  element.style.height = "auto"
  element.style.height = `${element.scrollHeight}px`
}

function startEdit() {
  draft.value = props.block.source
  editing.value = true
  void nextTick(() => {
    autosize()
    const element = textareaRef.value
    if (element !== null) focusEditable(element, "end")
  })
}

/**
 * 收工。
 *
 * 两道守卫：
 * - 草稿还是空的就留在编辑区。源码空 ⨯ 非编辑态是个死局 —— 渲染没内容可渲、
 *   编辑区又收起来了，只会永远停在「正在渲染」，而空源码本来就没什么可提交的。
 * - 草稿没变就不回写 —— 只是点开看一眼源码的话，不该把文档标脏。
 */
function commitEdit() {
  if (draft.value.trim() === "") return
  editing.value = false
  if (draft.value !== props.block.source) setMermaidSource(props.block.id, draft.value)
}

/** Esc 放弃改动。源码本来就空时不退 —— 退出去只剩一块什么都点不动的空白。 */
function cancelEdit() {
  if (props.block.source.trim() === "") return
  editing.value = false
  draft.value = props.block.source
}

function onKeydown(event: KeyboardEvent) {
  if (event.key === "Escape") {
    event.preventDefault()
    cancelEdit()
    return
  }
  // Enter 在源码里永远是换行，收工得用修饰键。
  if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
    event.preventDefault()
    commitEdit()
  }
}
</script>

<template>
  <div class="group/mm relative">
    <div v-if="editing" class="my-1 rounded-lg bg-muted-strong px-3.5 py-2.5">
      <textarea
        ref="textareaRef"
        v-model="draft"
        :data-editable="block.id"
        :placeholder="PLACEHOLDER"
        spellcheck="false"
        rows="2"
        class="w-full resize-none bg-transparent font-mono text-[12.5px] leading-[1.7] text-[oklch(0.3_0_0)] outline-none placeholder:text-muted-foreground/60"
        @input="autosize"
        @keydown="onKeydown"
      />
      <div class="mt-2 flex items-center justify-between text-[11px] text-muted-foreground">
        <span>Esc 取消 · ⌘/Ctrl + Enter 完成</span>
        <Button size="sm" variant="ghost" class="h-6 px-2 text-[11px]" @click="commitEdit">完成</Button>
      </div>
    </div>

    <template v-else>
      <!-- mermaid 生成的 svg 自带 `width:100%` + `max-width`，宽度会自己适应容器；
           `mx-auto` 在此基础上居中，且不像 justify-content 那样在溢出时吃掉左侧滚动区。 -->
      <div
        v-if="svg !== ''"
        class="my-1 [&>svg]:mx-auto [&>svg]:block"
        title="双击编辑源码"
        @dblclick="startEdit"
        v-html="svg"
      />

      <div
        v-else-if="error !== ''"
        class="my-1 rounded-lg border border-destructive/30 bg-destructive/5 px-3.5 py-2.5"
      >
        <p class="text-[12px] font-medium text-destructive">图渲染失败</p>
        <pre class="mt-1 whitespace-pre-wrap font-mono text-[11.5px] leading-[1.6] text-destructive/80">{{ error }}</pre>
        <Button size="sm" variant="outline" class="mt-2 h-7 gap-1.5 text-[11.5px]" @click="startEdit">
          <PencilIcon class="size-3" />
          改源码
        </Button>
      </div>

      <div
        v-else
        class="my-1 flex h-16 items-center justify-center rounded-lg bg-muted text-[12px] text-muted-foreground"
      >
        正在渲染图…
      </div>

      <Button
        v-if="svg !== ''"
        size="sm"
        variant="ghost"
        class="absolute right-0 top-2 h-7 gap-1.5 px-2.5 text-[11.5px] opacity-0 transition-opacity group-hover/mm:opacity-100 focus-visible:opacity-100"
        @click="startEdit"
      >
        <PencilIcon class="size-3.5" />
        编辑源码
      </Button>
    </template>
  </div>
</template>

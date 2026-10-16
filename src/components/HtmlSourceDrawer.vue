<script setup lang="ts">
import { onBeforeUnmount, ref, watch } from "vue"
import { Button } from "@/components/ui/button"
import type { editor as monacoEditor } from "monaco-editor"
import { loadMonaco } from "@/lib/monaco"

/**
 * HTML 块的源码抽屉：从笔记编辑区右缘滑出，宽度 = 编辑区一半。
 *
 * **编辑器实例只建一次、常驻复用**（`v-show` 控显隐，不是 v-if 挂卸）：Monaco 的
 * create/dispose 循环有单例状态坑，第二次 create 会炸；复用还顺带让二次打开
 * 零加载成本。每次打开 `setValue(当前原文)` + 聚焦，不会看到上一次没提交的残稿。
 *
 * 提交 / 取消都由外层收口：commit 带最终文本上去，close 什么都不动。
 *
 * Teleport 进 `data-editor-surface`：抽屉是**笔记编辑区**的一半，不是窗口的一半，
 * 挂 body 只能按视口算。编辑区自带 overflow-hidden + 圆角，抽屉贴着它滑出正好被裁齐。
 */
const props = defineProps<{ open: boolean; source: string }>()

const emit = defineEmits<{
  (event: "commit", source: string): void
  (event: "close"): void
}>()

const hostRef = ref<HTMLDivElement | null>(null)
let editor: monacoEditor.IStandaloneCodeEditor | null = null
/** 打开序号：快速开关时用来丢弃过期的聚焦（下面 setTimeout 的竞态守卫）。 */
let openSeq = 0

function commit() {
  if (editor === null) return
  emit("commit", editor.getValue())
}

watch(
  () => props.open,
  async (open) => {
    if (!open) {
      // 关闭即作废还没触发的延迟聚焦：220ms 窗口内按 Esc / 点完成的话，
      // 定时器会在抽屉隐藏后打焦点，Monaco 对 display:none 的编辑器聚焦会炸。
      openSeq += 1
      return
    }
    const seq = ++openSeq
    const monaco = await loadMonaco()
    const host = hostRef.value
    if (host === null || seq !== openSeq) return
    if (editor === null) {
      editor = monaco.editor.create(host, {
        language: "html",
        theme: "vs",
        automaticLayout: true,
        minimap: { enabled: false },
        wordWrap: "on",
        fontSize: 13,
        fontFamily: 'ui-monospace, "SF Mono", Menlo, monospace',
        scrollBeyondLastLine: false,
        padding: { top: 12 },
      })
      editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.Enter, commit)
      editor.addCommand(monaco.KeyCode.Escape, () => emit("close"))
    }
    editor.setValue(props.source)
    // **聚焦必须等滑入动画结束。** 动画进行中抽屉还在 translate-x-full，
    // 焦点元素在 overflow-hidden 表面之外 —— 浏览器会把表面当滚动容器横向滚
    // 去露出它（探针实测 scrollLeft 被顶到抽屉宽度 376px 再随动画弹回），
    // 整个编辑区内容跟着横移，看起来就是“抽屉先撑开容器宽度、页面抖动”。
    // 实例已缓存时（第二次起打开）loadMonaco 立即返回，焦点正好撞进动画；
    // 首次打开慢加载侥幸落在动画后，所以不是每次都抖。见 design/drawer-jitter-probe.html。
    await new Promise((resolve) => setTimeout(resolve, 220))
    if (seq !== openSeq || editor === null || !props.open) return
    editor.focus()
  },
)

onBeforeUnmount(() => {
  editor?.dispose()
  editor = null
})
</script>

<template>
  <Teleport to="[data-editor-surface]">
    <Transition
      enter-active-class="transition-transform duration-200 ease-out"
      enter-from-class="translate-x-full"
      leave-active-class="transition-transform duration-150 ease-in"
      leave-to-class="translate-x-full"
    >
      <div
        v-show="open"
        data-html-source-drawer
        class="absolute inset-y-0 right-0 z-20 flex w-1/2 flex-col border-l border-line bg-background shadow-pop"
      >
        <div class="flex flex-none items-center gap-3 border-b border-line px-4 py-2">
          <span class="text-[12.5px] font-medium">HTML 源码</span>
          <span class="text-[11px] text-muted-foreground">Esc 取消 · ⌘/Ctrl + Enter 完成</span>
          <div class="flex-1" />
          <Button size="sm" variant="ghost" class="h-7 px-2.5 text-[11.5px]" @click="emit('close')">
            取消
          </Button>
          <Button size="sm" class="h-7 px-2.5 text-[11.5px]" @click="commit">完成</Button>
        </div>
        <div ref="hostRef" class="min-h-0 flex-1" />
      </div>
    </Transition>
  </Teleport>
</template>

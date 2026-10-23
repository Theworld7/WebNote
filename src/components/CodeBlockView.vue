<script setup lang="ts">
import type { TextualBlock } from "@/types/workspace"
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue"
import { CheckIcon, CopyIcon, PencilIcon } from "@lucide/vue"
import { useWorkspace } from "@/composables/useWorkspace"
import { useTheme } from "@/composables/useTheme"
import { currentFontStack } from "@/lib/fonts"
import { highlightCode } from "@/lib/highlight"
import { runsText, textToRuns } from "@/lib/inline"
import { applyMonacoTheme } from "@/lib/monaco-theme"
import { closeCodeEditor, formatCodeEditor, openCodeEditor, prefetchCodeEditor } from "@/lib/monaco-code"
import type { CodeEditorHandle } from "@/lib/monaco-code"
import { supportsFormat } from "@/lib/source-format"

/**
 * 代码块。双态：静态高亮 / Monaco 编辑（ADR-0017）。
 *
 * 静态态是纯 DOM：`highlightCode` 出一段着色 HTML，与编辑器视图同一份排版常量。
 * 编辑态才向 `lib/monaco-code` 借**全应用唯一**的 Monaco 实例，退出即销毁 ——
 * 打开笔记永远不碰 Monaco，块有几十个也一样。
 *
 * 进入编辑只认右上角的「编辑」按钮（双击不响应）：代码块里双击常是「选中一个词」，
 * 抢走这个手势会让人没法选词。空块例外 —— 插入后直接进编辑态，与 Mermaid 块
 * 「空块必须给一个看得见的入口」同一立场。
 */
const props = defineProps<{ block: TextualBlock }>()

const { setBlockRuns, setBlockLang } = useWorkspace()
const { theme } = useTheme()

const text = computed(() => runsText(props.block.runs))
const language = computed(() => props.block.lang ?? "")
const highlighted = computed(() => (text.value === "" ? "" : highlightCode(text.value, language.value)))

/** 空块直接进编辑态；有内容就先给静态高亮。 */
const editing = ref(text.value === "")

const hostRef = ref<HTMLElement | null>(null)
/** 整个块的根。判断「焦点还在不在这块里」用 —— 工具条也在里面。 */
const rootRef = ref<HTMLElement | null>(null)
let handle: CodeEditorHandle | null = null

/**
 * 语言选项。Monaco 的语言 id 就是这些键（`shell` 是它的 bash 标识）。
 * 只列常用的：列全了要滚三屏，而真正会写进笔记的就这几门。
 */
const LANGUAGES = [
  { id: "", label: "纯文本" },
  { id: "css", label: "CSS" },
  { id: "html", label: "HTML" },
  { id: "javascript", label: "JavaScript" },
  { id: "typescript", label: "TypeScript" },
  { id: "json", label: "JSON" },
  { id: "python", label: "Python" },
  { id: "shell", label: "Shell" },
  { id: "sql", label: "SQL" },
  { id: "yaml", label: "YAML" },
  { id: "markdown", label: "Markdown" },
  { id: "go", label: "Go" },
  { id: "rust", label: "Rust" },
] as const

function disposeEditor(): void {
  handle?.dispose()
  handle = null
  // 排版是异步的：块可能在等待期间收工，`runFormat` 那侧的 `await` 就再也没有机会
  // 把按钮复位。状态归这里收，下次进编辑态不会挂着一个「格式化中…」。
  formatting.value = false
  // `handle.dispose` 已经清了模块里的 active，这里再兜一次：加载失败 / 重复进出时
  // 不留一个没人管的实例在后台。
  closeCodeEditor()
}

async function mountEditor(): Promise<void> {
  const host = hostRef.value
  if (host === null) return
  const opened = await openCodeEditor({
    host,
    value: text.value,
    language: language.value,
    theme: theme.value,
    fontFamily: currentFontStack("code"),
  })
  if (opened === null) {
    // Monaco 没起来就退回静态态 —— 块里还是原来那段文字，读者不受影响。
    editing.value = false
    return
  }
  handle = opened
  const { editor, monaco } = opened
  editor.addCommand(monaco.KeyCode.Escape, () => cancelEdit())
  editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.Enter, () => commitEdit())
  editor.focus()
}

async function startEdit(): Promise<void> {
  if (editing.value) return
  editing.value = true
  await nextTick()
  await mountEditor()
}

/**
 * 收工：先把值取出来，再退出编辑态、销毁实例。
 *
 * **`editing = false` 要排在 `disposeEditor()` 前面**：销毁 Monaco 会同步抛出一次
 * focusout，守卫（`if (!editing.value) return`）得先立住，否则收工会重入一次。
 */
function commitEdit(): void {
  if (!editing.value) return
  const value = handle?.editor.getValue() ?? text.value
  editing.value = false
  disposeEditor()
  if (value !== text.value) setBlockRuns(props.block.id, textToRuns(value))
}

/** Esc 放弃改动。正文本来为空时留在编辑态 —— 退出去只剩一块没入口的空白。 */
function cancelEdit(): void {
  if (!editing.value || text.value === "") return
  editing.value = false
  disposeEditor()
}

/**
 * 焦点离开**整块**才收工，而不是编辑器一失焦就收。
 *
 * 工具条（语言下拉、完成）长在块里，点它会把焦点从 Monaco 拿走 —— 按「编辑器失焦」
 * 收工的话，下拉还没展开块就退回静态态了。这里看的是焦点有没有还在 `rootRef` 之内：
 * 在（点下拉 / 点完成）就不动，出了块才提交。
 */
function onFocusOut(event: FocusEvent): void {
  const next = event.relatedTarget
  if (next instanceof Node && rootRef.value?.contains(next) === true) return
  commitEdit()
}

function changeLanguage(event: Event): void {
  const target = event.target
  if (!(target instanceof HTMLSelectElement)) return
  setBlockLang(props.block.id, target.value)
}

/**
 * 格式化。只排缓冲区，不写块 —— 落盘仍归 blur / 完成，所以按 Esc 能整个丢掉。
 *
 * 按钮只在「有格式化器」的语言上可点（prettier 没有 python / shell / sql / go / rust），
 * 置灰而不是隐藏：换语言时工具栏不该忽宽忽窄，用户也该知道这功能存在、只是当前不行。
 */
const formattable = computed(() => supportsFormat(language.value))
const formatting = ref(false)
/** 解析失败 / 引擎没起来的短暂提示 —— 代码写了一半是常态，prettier 认不了。 */
const formatFailed = ref(false)
let failedTimer: number | undefined

const formatLabel = computed(() => {
  if (formatting.value) return "格式化中…"
  return formatFailed.value ? "无法格式化" : "格式化"
})

async function runFormat(): Promise<void> {
  const target = handle
  if (target === null || formatting.value) return
  formatting.value = true
  const ok = await formatCodeEditor(target, language.value)
  // 排版期间块已经收工（实例换了 / 没了），这次结果作废，也不该往一个已经隐藏的
  // 工具栏上写提示。
  if (handle !== target) return
  formatting.value = false
  window.clearTimeout(failedTimer)
  formatFailed.value = !ok
  if (!ok) failedTimer = window.setTimeout(() => (formatFailed.value = false), 1500)
}

const copied = ref(false)
let copiedTimer: number | undefined

/** 复制按钮的反馈态：点完短暂变 ✓。 */
async function copyCode(): Promise<void> {
  await navigator.clipboard.writeText(text.value)
  copied.value = true
  window.clearTimeout(copiedTimer)
  copiedTimer = window.setTimeout(() => (copied.value = false), 1500)
}

// 换语言时立刻换 Monaco 的高亮，不必等重新进出编辑态。
watch(language, (next) => {
  const model = handle?.editor.getModel()
  if (handle === null || model === null || model === undefined) return
  handle.monaco.editor.setModelLanguage(model, next === "" ? "plaintext" : next)
})

// 外观在一天里会按日程自己换（ADR-0014）。编辑态时把新配色喂进去，实例不重建。
watch(theme, (next) => {
  if (handle !== null) applyMonacoTheme(handle.monaco, next)
})

onMounted(() => {
  // 空块（新插入 / 转换来的）：挂载后自己把编辑器拉起来。
  if (editing.value) void nextTick(mountEditor)
})

onBeforeUnmount(() => {
  disposeEditor()
  window.clearTimeout(copiedTimer)
  window.clearTimeout(failedTimer)
})
</script>

<template>
  <div ref="rootRef" class="group/code relative" @focusout="onFocusOut">
    <!--
      编辑态：Monaco 本体与静态层同底色同内边距（`px-3.5 py-2.5`），所以进出时
      块高、文字起点都不变。工具条做成**块下方的浮层**而不是块内的一行 ——
      块内加一行会让编辑态比静态态高 28px，进出一次下面的内容整体跳一下。
    -->
    <div v-if="editing" class="overflow-hidden rounded-lg bg-muted-strong">
      <div ref="hostRef" class="monaco-code-host px-3.5 py-2.5" />
    </div>
    <div
      v-if="editing"
      class="absolute left-0 top-full z-20 mt-1 flex w-full items-center gap-2 rounded-lg border border-line bg-popover px-2 py-1 shadow-sm"
    >
      <select
        :value="language"
        class="rounded border border-line bg-transparent px-1.5 py-0.5 text-[11px] text-muted-foreground outline-none hover:text-foreground focus-visible:border-brand"
        title="代码语言"
        @change="changeLanguage"
      >
        <option v-for="item in LANGUAGES" :key="item.id" :value="item.id">{{ item.label }}</option>
      </select>
      <!--
        格式化按钮。`@mousedown.prevent` 与「完成」同一条理由：按钮抢走焦点会触发
        整块的 focusout，下拉还没反应块就提交了。
      -->
      <button
        type="button"
        class="rounded px-2 py-0.5 text-[11px] text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent disabled:hover:text-muted-foreground"
        :disabled="!formattable || formatting"
        :title="formattable ? '格式化（prettier）' : '该语言暂无格式化器'"
        @mousedown.prevent
        @click="runFormat"
      >
        {{ formatLabel }}
      </button>
      <span class="text-[11px] text-muted-foreground">Esc 取消 · ⌘/Ctrl + Enter 完成</span>
      <button
        type="button"
        class="ml-auto rounded px-2 py-0.5 text-[11px] text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
        @mousedown.prevent
        @click="commitEdit"
      >
        完成
      </button>
    </div>

    <template v-else>
      <!-- `data-block-type` 是页面级 CSS 预览的改写钩子：导出文件里这里是 `<pre>`，
           用户写的 `pre { … }` 经 lib/note-style 改写成 `[data-block-type="code"]`。别删。 -->
      <div
        data-block-type="code"
        class="rounded-lg bg-muted-strong px-3.5 py-2.5 font-mono text-[12px] leading-[21px] whitespace-pre-wrap break-words text-code-foreground"
      >
        <template v-if="text === ''">
          <span class="text-muted-foreground/60">空代码块 · 点右上角「编辑」开始写</span>
        </template>
        <!-- eslint-disable-next-line vue/no-v-html -- 高亮产物由 highlight.js 转义生成 -->
        <span v-else v-html="highlighted" />
      </div>

      <div
        class="absolute right-1.5 top-1.5 flex gap-0.5 opacity-0 transition-opacity group-hover/code:opacity-100 focus-within:opacity-100"
      >
        <button
          type="button"
          class="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
          title="编辑"
          @mousedown.prevent
          @mouseenter="prefetchCodeEditor"
          @click="startEdit"
        >
          <PencilIcon class="size-3.5" />
        </button>
        <button
          type="button"
          class="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
          :title="copied ? '已复制' : '复制'"
          @mousedown.prevent
          @click="copyCode"
        >
          <CheckIcon v-if="copied" class="size-3.5" />
          <CopyIcon v-else class="size-3.5" />
        </button>
      </div>
    </template>
  </div>
</template>

<style scoped>
/*
 * Monaco 的主题把 `editor.background` 定成 `--background`（抽屉是这块纸），
 * 而代码块静态态的底是 `--color-muted-strong`。直接让 Monaco 画底色的话，
 * 进入/退出编辑时这块会明显跳一次色 —— 把它的底让出来，露出外层容器。
 */
.monaco-code-host :deep(.monaco-editor),
.monaco-code-host :deep(.monaco-editor .margin),
.monaco-code-host :deep(.monaco-editor-background) {
  background-color: transparent !important;
}
</style>

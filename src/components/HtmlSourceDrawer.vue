<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from "vue"
import { Button } from "@/components/ui/button"
import type { editor as monacoEditor } from "monaco-editor"
import { compactCss, formatCss, formatHtml } from "@/lib/source-format"
import { currentFontStack } from "@/lib/fonts"
import { applyMonacoTheme, monacoThemeName } from "@/lib/monaco-theme"
import { loadMonaco } from "@/lib/monaco"
import type { Monaco } from "@/lib/monaco"
import { useTheme } from "@/composables/useTheme"

/**
 * HTML 源码抽屉：从笔记编辑区右缘滑出，宽度 = 编辑区一半。
 *
 * 两个消费者：HTML 块的原文，和整篇笔记的页面级 CSS（`language="css"`）—— 都是
 * 「一段手写的源码」，只是语言与标题不同，所以按 props 分而不是拆两套。
 *
 * **编辑器实例只建一次、常驻复用**（`v-show` 控显隐，不是 v-if 挂卸）：Monaco 的
 * create/dispose 循环有单例状态坑，第二次 create 会炸；复用还顺带让二次打开
 * 零加载成本。每次打开 `setValue(当前原文)` + 切语言 + 聚焦，不会看到上一次没提交的残稿。
 *
 * **CSS 的格式化只存在于编辑期**：打开时排版成人能读的样子，提交时压回紧凑形态。
 * 磁盘上是紧凑的原文（见 `lib/source-format.ts` 的取舍），由此产生一个必须处理的细节 ——
 * 「打开后什么都没改就点完成」时要把**原文**还回去，而不是把 prettier 的产物当改动
 * 落盘（那会让每次打开都在文件里留下缩进）。**HTML 同样按这个细节处理**：它没有紧凑化，
 * 排版结果本来就是可落盘形态，但「没改过就还原文」这条不跟着变 —— 自动排版不该替用户
 * 改文件。
 *
 * 提交 / 取消都由外层收口：commit 带最终文本上去，close 什么都不动。
 *
 * Teleport 进 `data-editor-surface`：抽屉是**笔记编辑区**的一半，不是窗口的一半，
 * 挂 body 只能按视口算。编辑区自带 overflow-hidden + 圆角，抽屉贴着它滑出正好被裁齐。
 */
const props = withDefaults(defineProps<{ open: boolean; source: string; language?: string; title?: string }>(), {
  language: "html",
  title: "HTML 源码",
})

const emit = defineEmits<{
  (event: "commit", source: string): void
  (event: "close"): void
}>()

const hostRef = ref<HTMLDivElement | null>(null)
const { theme } = useTheme()
/** Monaco 的模块命名空间。加载过才有值 —— 换配色只在它非空时才碰。 */
let monaco: Monaco | null = null
let editor: monacoEditor.IStandaloneCodeEditor | null = null
/** 打开序号：快速开关时用来丢弃过期的聚焦（下面 setTimeout 的竞态守卫）。 */
let openSeq = 0
/** 编辑器里当前呈现的文本。提交时拿它判断「有没有真改过」。 */
let shown = ""

const cssMode = computed(() => props.language === "css")
/** 两种源码都支持格式化；除此之外的语言（将来的 js 块之类）先不接。 */
const formatMode = computed(() => props.language === "css" || props.language === "html")

/** 按 Monaco 的 language id 选格式化器。只该在 `formatMode` 成立时调用。 */
function formatFor(language: string, text: string): Promise<string> {
  return language === "css" ? formatCss(text) : formatHtml(text)
}

function commit() {
  if (editor === null) return
  const value = editor.getValue()
  // 没改过 → 原样还回去（自动排版不算改动）；改过 → CSS 压紧凑，HTML 保留排版的形态。
  if (value === shown) {
    emit("commit", props.source)
    return
  }
  emit("commit", cssMode.value ? compactCss(value) : value)
}

/**
 * 把一段排版好的文本换进编辑器。
 *
 * 用 `executeEdits` 而不是 `setValue`：后者清空撤销栈，点一下「格式化」就把之前的
 * 编辑历史一起抹掉了。光标位置手动收回来，免得跑回文件开头。
 *
 * **不动 `shown`**：它记的是「打开时呈现的样子」，提交时用它判断有没有真改过。
 * 把格式化结果写进去的话，「改两笔 → 点格式化 → 完成」就会被判成没改动，用户的编辑
 * 直接丢掉。
 */
function replaceAll(text: string) {
  if (editor === null) return
  const model = editor.getModel()
  if (model === null) return
  const position = editor.getPosition()
  editor.executeEdits("source-format", [{ range: model.getFullModelRange(), text }])
  if (position !== null) editor.setPosition(position)
}

/** 打开的排版：异步、可放弃 —— 用户已经开始打字或者抽屉已被关掉就不动它。 */
async function formatOnOpen(seq: number, source: string) {
  const formatted = await formatFor(props.language, source)
  if (formatted === "" || formatted === source || seq !== openSeq) return
  if (editor === null || !props.open || editor.getValue() !== source) return
  editor.setValue(formatted)
  shown = formatted
}

/** 手动格式化（抽屉头部按钮）。格式化本身可以撤销，不做额外记录。 */
async function formatNow() {
  if (editor === null) return
  const value = editor.getValue()
  const formatted = await formatFor(props.language, value)
  if (formatted === "" || formatted === value || editor === null) return
  replaceAll(formatted)
}

/**
 * 外观换了就地重绘（`setTheme` 是全局的，实例不用重建）。
 *
 * **不在这里 await 加载**：抽屉没开过时 Monaco 根本没加载，为了给一个没人看着的
 * 编辑器换色去拉整包（几 MB 加四个 worker）说不过去。首次打开时补上就行。
 */
watch(theme, () => {
  if (monaco !== null) applyMonacoTheme(monaco, theme.value)
})

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
    const api = await loadMonaco()
    monaco = api
    const host = hostRef.value
    if (host === null || seq !== openSeq) return
    // 先定义再 create：主题名没定义过时 Monaco 会静默退回 `vs`（浅色），
    // 深色界面下这就是那块白眼的第一帧。
    applyMonacoTheme(api, theme.value)
    if (editor === null) {
      editor = api.editor.create(host, {
        language: props.language,
        theme: monacoThemeName(theme.value),
        automaticLayout: true,
        minimap: { enabled: false },
        wordWrap: "on",
        fontSize: 13,
        // 代码字体偏好落在 --font-mono 上，这里跟着读当前值 —— Monaco 不认 CSS 变量，
        // 只能取出来喂给它。实例是复用的，下面每次打开还会再刷一次。
        fontFamily: currentFontStack("code"),
        scrollBeyondLastLine: false,
        padding: { top: 12 },
      })
      editor.addCommand(api.KeyMod.CtrlCmd | api.KeyCode.Enter, commit)
      editor.addCommand(api.KeyCode.Escape, () => emit("close"))
    }
    editor.updateOptions({ fontFamily: currentFontStack("code") })
    // 实例是复用的，语言得每次打开按 props 重设 —— 否则开过 HTML 块之后，
    // 页面样式那份会沿用 html 的高亮与校验。
    const model = editor.getModel()
    if (model !== null) api.editor.setModelLanguage(model, props.language)
    editor.setValue(props.source)
    shown = props.source
    // 不 await：排版要动态加载 prettier（首次几百 KB），不等它才叫「打开就能写」。
    if (formatMode.value) void formatOnOpen(seq, props.source)
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
  <!-- `defer`：锚点（`[data-editor-surface]`）是抽屉自己的祖先，与它同一次渲染才建出来。
        不延后解析的话，首次渲染时锚点还不在文档里，Teleport 找不到落点、子节点直接不挂
        —— 之后每次 props 变化都会在 patch 里炸（`component` 为 null）。延后到本次
        渲染结束后再解析，两个消费者（HTML 块、状态栏的页面样式）都不必关心挂载顺序。 -->
  <Teleport to="[data-editor-surface]" defer>
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
          <span class="flex-none whitespace-nowrap text-[12.5px] font-medium">{{ title }}</span>
          <!-- CSS 的排版是编辑期的临时形态，落盘会压回单行 —— 不写出来的话，下一次打开
               文件的人会以为「格式化」丢了。HTML 没有紧凑化，排版就是落盘形态，按钮的
               title 负责把这层差别说清。 -->
          <span class="truncate text-[11px] text-muted-foreground">
            {{ cssMode ? "保存压单行 · Esc 取消" : "Esc 取消 · ⌘/Ctrl + Enter 完成" }}
          </span>
          <div class="flex-1" />
          <Button
            v-if="formatMode"
            size="sm"
            variant="ghost"
            class="h-7 flex-none px-2.5 text-[11.5px]"
            :title="
              cssMode
                ? '按 prettier 重新排版（只影响编辑器里的文本，不影响落盘形态）'
                : '按 prettier 重新排版（有改动时排版形态跟着落盘）'
            "
            @click="formatNow"
          >
            格式化
          </Button>
          <Button size="sm" variant="ghost" class="h-7 flex-none px-2.5 text-[11.5px]" @click="emit('close')">
            取消
          </Button>
          <Button size="sm" class="h-7 flex-none px-2.5 text-[11.5px]" @click="commit">完成</Button>
        </div>
        <div ref="hostRef" class="min-h-0 flex-1" />
      </div>
    </Transition>
  </Teleport>
</template>

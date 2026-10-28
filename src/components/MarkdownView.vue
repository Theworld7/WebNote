<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch, watchEffect } from "vue"
import { FileTextIcon } from "@lucide/vue"
import { Button } from "@/components/ui/button"
import { ScrollArea } from "@/components/ui/scroll-area"
import { useTheme } from "@/composables/useTheme"
import { useWorkspace } from "@/composables/useWorkspace"
import { resolveRelativePath } from "@/lib/link"
import { markdownToHtml } from "@/lib/markdown"
import { scopeCss } from "@/lib/note-style"
import { openExternalUrl } from "@/lib/open-external"
import { docStyle, DOC_GUTTER_REM, DOC_MEASURE_PX } from "@/lib/typography"

const { activePath, activeMarkdown, convertMarkdownToNote, followLink, imageSourceOf } = useWorkspace()
const { theme } = useTheme()

/**
 * 右上角那组浮标的盒子：与 `docStyle()` 给 body 的版心、左右留白同源，才能把右缘落在
 * 正文内容上。走内联 style 而不是 `max-w-[720px]`：这两个数只能有一处真源。
 */
const ACTIONS_BOX = { maxWidth: `${DOC_MEASURE_PX}px`, paddingInline: `${DOC_GUTTER_REM}rem` }

const html = computed(() => markdownToHtml(activeMarkdown.value))

/**
 * 预览样式直接复用导出文档那份 `docStyle()`。
 *
 * `docStyle()` 写的是整页语义（`body`、`h1`），经 `scopeCss` 限定到预览容器；
 * `markdownToHtml` 给每个块打了 `data-block-type`，正是这套规则认的钩子 ——
 * 两边一对上，Markdown 的标题 / 列表 / 表格 / 代码就与导出的 HTML 长得一样，
 * 不必再为预览维护第二套字号与间距常量。
 */
const SCOPE_ROOT = "[data-markdown-doc]"
/**
 * Tailwind 的 preflight 把列表标记抹成 `list-style: none`，而导出文档是靠浏览器默认值
 * 才有圆点 / 数字。预览在应用里跑，得把这两样补回来。
 */
const LIST_MARKERS = `${SCOPE_ROOT} ul{list-style:disc}${SCOPE_ROOT} ol{list-style:decimal}`
let previewStyle: HTMLStyleElement | null = null

watchEffect(() => {
  // `theme` 也是依赖：外观一变，深色那套要重新摊平进这份 CSS。
  const css = `${scopeCss(docStyle(), SCOPE_ROOT, theme.value)}\n${LIST_MARKERS}`
  if (previewStyle === null) {
    previewStyle = document.createElement("style")
    previewStyle.dataset.markdownStyle = ""
    document.head.appendChild(previewStyle)
  }
  previewStyle.textContent = css
})

onBeforeUnmount(() => {
  previewStyle?.remove()
  previewStyle = null
  releaseImages()
})

/**
 * 预览里的链接不交给 webview 自己导航。
 *
 * 带 scheme 的地址走系统浏览器（与行内链接同一条路，ADR-0021）；其余按**这份 Markdown
 * 所在目录**解析成工作区路径 —— `./a.html`、`../日记/b.html` 都是相对它的，交给
 * `followLink` 去查盘、开标签，或把「打不开」写进错误提示。页内片段与解析不出来的
 * 地址什么都不做，至少不会把应用整个换成一页 Markdown 里的相对链接。
 */
function onClick(event: MouseEvent) {
  const target = event.target
  if (!(target instanceof Element)) return
  const anchor = target.closest("a")
  if (!(anchor instanceof HTMLAnchorElement)) return
  event.preventDefault()
  const href = anchor.getAttribute("href") ?? ""
  if (/^(?:https?:|mailto:|tel:)/i.test(href)) {
    void openExternalUrl(href)
    return
  }
  const path = resolveRelativePath(activePath.value, href)
  if (path !== null) void followLink(path)
}

const docRef = ref<HTMLElement | null>(null)

/** 这一轮为本地图片造出来的 object URL。换内容 / 卸载都要收回去，否则图像字节一直挂着。 */
let imageUrls: string[] = []

function releaseImages() {
  for (const url of imageUrls) URL.revokeObjectURL(url)
  imageUrls = []
}

/**
 * 把相对地址的图片从盘上读出来。
 *
 * `![](./图/a.png)` 是相对**这份 Markdown 所在目录**写的；浏览器拿到这串相对地址只会
 * 相对应用自己的 URL 去要，必然裂图。这里逐张解析成工作区路径、读字节、换成 object
 * URL，`<img>` 才有一个真能取到的地址。读不出来的保留原地址（裂图），不打断其余内容。
 */
async function resolveImages() {
  const container = docRef.value
  if (container === null) return
  for (const image of container.querySelectorAll("img")) {
    const raw = image.getAttribute("src") ?? ""
    if (raw === "") continue
    const path = resolveRelativePath(activePath.value, raw)
    if (path === null) continue
    const url = await imageSourceOf(path)
    if (url === null) continue
    imageUrls.push(url)
    image.setAttribute("src", url)
  }
}

// `flush: "post"`：等 `v-html` 真正落进 DOM 之后再改 `<img src>`，顺序反了就找不到图。
watch(
  html,
  async () => {
    releaseImages()
    await nextTick()
    await resolveImages()
  },
  { flush: "post" },
)

onMounted(() => void resolveImages())

/** 转换期间挡住重复点击：一次只落一篇笔记。 */
const converting = ref(false)

async function convert() {
  if (converting.value) return
  converting.value = true
  try {
    await convertMarkdownToNote(activePath.value)
  } finally {
    converting.value = false
  }
}
</script>

<template>
  <div class="relative flex min-h-0 flex-1 flex-col">
    <ScrollArea class="min-h-0 flex-1">
      <!-- 只读提示与转换入口贴在正文列右上角：正文列自己不摆工具栏，滚动时这组也不跟着走。
           它挂在滚动视口**里面**、sticky 钉住、零高 —— 与正文列共用同一个包含块，正文列按
           哪个宽度居中它就按哪个宽度居中，视口哪天真为滚动条留了宽度，两者一起挪，不会
           一个在里一个在外。零高是不许那一横把正文推下去。
           宽度与左右留白跟 `docStyle()` 里 body 的那两行同源，右缘才落在**内容**右缘上
           （宽窗口里正文列是居中的 720，贴编辑区右缘会让这组悬在文字外面）。
           外层 pointer-events-none：这条横在正文列顶上，挡住的话滚轮在这里就滚不动了。 -->
      <div class="pointer-events-none sticky top-0 z-10 h-0">
        <div class="mx-auto flex justify-end pt-3" :style="ACTIONS_BOX">
          <div data-markdown-actions class="pointer-events-auto flex items-center gap-2">
            <span class="text-[11px] text-muted-foreground">Markdown · 只读</span>
            <Button
              variant="ghost"
              size="sm"
              :disabled="converting"
              class="h-7 gap-1 rounded-full bg-popover px-2.5 text-[12px] shadow-sm"
              @click="convert"
            >
              <FileTextIcon class="size-3.5" />
              转为笔记
            </Button>
          </div>
        </div>
      </div>
      <!-- 内容来自本地 Markdown，`markdownToHtml` 已摘掉脚本与事件属性，才允许 v-html。 -->
      <div ref="docRef" data-markdown-doc @click="onClick" v-html="html" />
    </ScrollArea>
  </div>
</template>

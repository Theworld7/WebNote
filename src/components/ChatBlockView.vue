<script setup lang="ts">
import type { ChatBlock, ChatMessage, ChatRole } from "@/types/workspace"
import { RefreshCwIcon, PlusIcon, XIcon } from "@lucide/vue"
import { Button } from "@/components/ui/button"
import { useWorkspace } from "@/composables/useWorkspace"

/**
 * 聊天记录块：一串气泡，`you` 靠右、`agent` 靠左。
 *
 * 每个气泡直接是 contenteditable —— 聊天记录是「整段摘进来」的内容，改哪条点哪条，
 * 不另设整块的编辑态（与 mermaid 的双态编辑不同：那边是一份源码，这边是并列的消息）。
 * 悬停气泡出两个动作：换角色、删除；底部一个「添加消息」，新消息的角色取上一条的
 * 对面 —— 对话总是一来一回，多数时候这就是想要的。
 */
const props = defineProps<{ block: ChatBlock }>()

const { setChatMessages } = useWorkspace()

/** 每条消息一个可编辑体，焦点管理按 index 找元素，不用每个气泡一个 ref。 */
function messageEditable(index: number): string {
  return `${props.block.id}-m${index}`
}

/**
 * 失焦时才回写文本。
 *
 * 气泡走 contenteditable 非受控（与 BlockItem 同一立场）：文本节点写在模板里只是
 * 初值，输入过程 Vue 不回写 —— 否则每次 keystroke 重设 textContent 会把光标顶回去。
 * 换角色 / 删除走按钮，点击时气泡已先失焦，读到的就是最新文本。
 */
function commitFromDom(index: number, event: FocusEvent) {
  const element = event.target
  if (!(element instanceof HTMLElement)) return
  // contenteditable 结尾常挂着游离的 <br>，innerText 会把它读成尾换行，掐掉。
  const text = element.innerText.replace(/\n+$/, "")
  const current = props.block.messages[index]
  if (current === undefined || current.text === text) return
  commitText(index, text)
}

function commitText(index: number, text: string) {
  const messages = props.block.messages.map((message, at) => (at === index ? { ...message, text } : message))
  setChatMessages(props.block.id, messages)
}

function toggleRole(index: number) {
  const messages = props.block.messages.map((message, at) =>
    at === index ? { ...message, role: (message.role === "you" ? "agent" : "you") as ChatRole } : message,
  )
  setChatMessages(props.block.id, messages)
}

function removeMessage(index: number) {
  setChatMessages(props.block.id, props.block.messages.filter((_, at) => at !== index))
}

function addMessage() {
  const last = props.block.messages[props.block.messages.length - 1]
  const role: ChatRole = last === undefined ? "you" : last.role === "you" ? "agent" : "you"
  const messages = [...props.block.messages, { role, text: "" } satisfies ChatMessage]
  setChatMessages(props.block.id, messages)
}

function onBlur(index: number, event: FocusEvent) {
  commitFromDom(index, event)
}
</script>

<template>
  <div class="group/chat my-1 flex flex-col gap-1.5 rounded-lg bg-muted/50 px-2.5 pb-2.5 pt-[34px]">
    <!-- 顶部 34px 与底部留白（10px 内边距 + 24px 按钮高）等高：按钮常驻占位、
         hover 才显形，上下因此对称，块高度不随 hover 跳动。 -->
    <div
      v-for="(message, index) in block.messages"
      :key="index"
      class="group/msg flex"
      :class="message.role === 'you' ? 'justify-end' : 'justify-start'"
    >
      <!-- 包一层 relative：动作按钮以气泡（而不是整行）为锚。 -->
      <div class="relative max-w-[85%]">
        <!-- 气泡本体。白色底压在灰色容器上，两侧用灰底区分方向。 -->
        <div
          :data-editable="messageEditable(index)"
          contenteditable="true"
          spellcheck="false"
          class="min-h-[1.6rem] whitespace-pre-wrap break-words rounded-2xl px-3 py-1.5 text-[13px] leading-[1.6] outline-none"
          :class="
            message.role === 'you'
              ? 'rounded-br-md bg-tint text-tint-foreground'
              : 'rounded-bl-md bg-card text-foreground shadow-sm'
          "
          @blur="onBlur(index, $event)"
        >{{ message.text }}</div>

        <!-- 悬停动作：换角色 / 删除。右侧气泡挂在左上角外侧，左侧气泡反之 ——
             都朝着对话留白的一侧，不遮字、不越过气泡中线。 -->
        <div
          class="absolute top-0 flex items-center gap-0.5 opacity-0 transition-opacity group-hover/msg:opacity-100"
          :class="message.role === 'you' ? 'right-full mr-1.5' : 'left-full ml-1.5'"
        >
          <button
            type="button"
            title="换个说话人"
            class="rounded p-0.5 text-muted-foreground hover:text-foreground"
            @click="toggleRole(index)"
          >
            <RefreshCwIcon class="size-3" />
          </button>
          <button
            type="button"
            title="删除这条"
            class="rounded p-0.5 text-muted-foreground hover:text-destructive"
            @click="removeMessage(index)"
          >
            <XIcon class="size-3" />
          </button>
        </div>
      </div>
    </div>

    <Button
      :data-editable="block.id"
      variant="ghost"
      size="sm"
      class="h-6 w-fit gap-1 self-center px-2 text-[11px] text-muted-foreground opacity-0 transition-opacity hover:text-foreground focus-visible:opacity-100 group-hover/chat:opacity-100"
      @click="addMessage"
    >
      <PlusIcon class="size-3" />
      添加消息
    </Button>
  </div>
</template>

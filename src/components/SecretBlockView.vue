<script setup lang="ts">
import type { SecretBlock } from "@/types/workspace"
import { computed, nextTick, ref } from "vue"
import { CheckIcon, CopyIcon, EyeIcon, EyeOffIcon, KeyRoundIcon } from "@lucide/vue"
import { useCopied } from "@/composables/useCopied"
import { useToast } from "@/composables/useToast"
import { useWorkspace } from "@/composables/useWorkspace"
import { describeError } from "@/lib/errors"
import { SECRET_MASK } from "@/lib/secret"

/**
 * 密钥块：一张卡，装一条凭据 —— 名称、值、备注（ADR-0047）。
 *
 * 值默认是掩码，点眼睛才看明文；**掩码只是一个显示开关**，值本身没有任何加密，
 * 它就在这一篇 `.html` 的属性里。这一点在 ADR 里写明了：笔记是普通文件，
 * 假装的加密比没有加密更糟 —— 用户会以为它是安全的。
 *
 * 三格都是受控输入（`:value` + `@change`），失焦或回车才写回块：逐键回写会让
 * 撤销栈里塞满半个密钥，也会让光标在被写回的那一瞬跳位。
 */
const props = defineProps<{ block: SecretBlock }>()

const { setSecretFields } = useWorkspace()
const { notify } = useToast()
const { copied, flash } = useCopied()

/** 明文只在这一次显示里打开 —— 重新挂载（切走再切回、重开笔记）就回到掩码。 */
const revealed = ref(false)
const valueInput = ref<HTMLInputElement | null>(null)

const masked = computed(() => (props.block.value === "" ? "还没有填入密钥" : SECRET_MASK))
const hasValue = computed(() => props.block.value !== "")

/** 眼睛:打开明文，顺手把光标送进那一格 —— 打开就是为了改。 */
async function reveal(): Promise<void> {
  revealed.value = true
  await nextTick()
  valueInput.value?.focus()
}

function hide(): void {
  revealed.value = false
}

/**
 * 提交一格。空串也照收（清空是正常的编辑动作），只是不把 `undefined` 当成「没改」——
 * 三个字段的判定都在 `setSecretFields` 那侧，这里只负责把改过的那个字段递过去。
 */
function commitName(event: Event): void {
  const target = event.target
  if (!(target instanceof HTMLInputElement)) return
  if (target.value === props.block.name) return
  setSecretFields(props.block.id, { name: target.value })
}

function commitValue(event: Event): void {
  const target = event.target
  if (!(target instanceof HTMLInputElement)) return
  if (target.value === props.block.value) return
  setSecretFields(props.block.id, { value: target.value })
}

function commitNote(event: Event): void {
  const target = event.target
  if (!(target instanceof HTMLInputElement)) return
  if (target.value === props.block.note) return
  setSecretFields(props.block.id, { note: target.value })
}

/** 一格里的回车 = 收工（失焦即提交，与账目格、数据表格的直觉一致）。 */
function blurOnEnter(event: KeyboardEvent): void {
  if (event.key !== "Enter") return
  event.preventDefault()
  if (event.target instanceof HTMLInputElement) event.target.blur()
}

/** 值那一格的键盘：Esc 先收明文，其余照常。 */
function onValueKeydown(event: KeyboardEvent): void {
  if (event.key === "Escape" && revealed.value) {
    // 只是收起明文，不该冒到块层去「退出编辑 / 关浮层」。
    event.stopPropagation()
    hide()
    return
  }
  blurOnEnter(event)
}

async function copyValue(): Promise<void> {
  if (!hasValue.value) return
  try {
    await navigator.clipboard.writeText(props.block.value)
  } catch (error) {
    notify(`复制密钥失败：${describeError(error)}`, "error")
    return
  }
  flash()
}
</script>

<template>
  <div class="group/secret my-1 rounded-lg border border-line bg-muted/30 px-3 py-2.5">
    <div class="flex items-center gap-2">
      <KeyRoundIcon class="size-3.5 shrink-0 text-muted-foreground" />

      <!-- 名称:默认那颗就是入口，插进来直接能打字（`data-editable` 让 BlockEditor 聚焦它）。 -->
      <input
        :data-editable="block.id"
        :value="block.name"
        class="min-w-0 flex-1 bg-transparent text-13 font-medium text-foreground outline-none placeholder:text-muted-foreground/60"
        placeholder="名称（比如 OpenAI API Key）"
        spellcheck="false"
        @change="commitName"
        @keydown="blurOnEnter"
      >

      <button
        type="button"
        class="grid size-6 shrink-0 place-items-center rounded text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent"
        :disabled="!hasValue"
        :title="copied ? '已复制' : '复制密钥'"
        @mousedown.prevent
        @click="copyValue"
      >
        <CheckIcon v-if="copied" class="size-3.5" />
        <CopyIcon v-else class="size-3.5" />
      </button>

      <button
        type="button"
        class="grid size-6 shrink-0 place-items-center rounded text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
        :title="revealed ? '收起明文' : '显示明文'"
        :aria-pressed="revealed"
        @mousedown.prevent
        @click="revealed ? hide() : reveal()"
      >
        <EyeOffIcon v-if="revealed" class="size-3.5" />
        <EyeIcon v-else class="size-3.5" />
      </button>
    </div>

    <!--
      值那一行:掩码态是一块**只读**的等宽文本（点它等于点眼睛），明文态才是输入框。
      不做 `type="password"` 来回切：浏览器会把它当成密码框弹密码管理器，对一串 API key
      既不合适也挡视线。
    -->
    <div class="mt-1.5 flex items-center rounded-md bg-card px-2 py-1 ring-1 ring-line/70">
      <input
        v-if="revealed"
        ref="valueInput"
        :value="block.value"
        class="min-w-0 flex-1 bg-transparent font-mono text-12 text-foreground outline-none"
        placeholder="粘贴或输入密钥"
        spellcheck="false"
        autocomplete="off"
        @change="commitValue"
        @keydown="onValueKeydown"
      >
      <button
        v-else
        type="button"
        class="min-w-0 flex-1 truncate text-left font-mono text-12 tracking-[0.12em]"
        :class="hasValue ? 'text-muted-foreground' : 'text-muted-foreground/60 tracking-normal'"
        title="显示明文"
        @click="reveal"
      >
        {{ masked }}
      </button>
    </div>

    <input
      :value="block.note"
      class="mt-1.5 w-full bg-transparent text-11 text-muted-foreground outline-none placeholder:text-muted-foreground/50"
      placeholder="备注（在哪儿用、什么时候换）"
      spellcheck="false"
      @change="commitNote"
      @keydown="blurOnEnter"
    >
  </div>
</template>

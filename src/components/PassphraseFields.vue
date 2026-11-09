<script setup lang="ts">
import { ref, watch } from "vue"
import { CheckIcon, CopyIcon, WandSparklesIcon } from "@lucide/vue"
import { Input } from "@/components/ui/input"
import { useCopied } from "@/composables/useCopied"
import { useToast } from "@/composables/useToast"
import { describeError } from "@/lib/errors"
import { generatePassphrase, passphraseProblem } from "@/lib/vault"

/**
 * 设新口令的两个输入框 + 一键生成（ADR-0053）。
 *
 * 用在两处：插密码本块时、块里换口令时 —— 两处都是「设一个新口令」，
 * 规矩与生成方式必须只有一份，否则同一个应用里会出现两套能输什么的标准。
 *
 * **生成的明文只显示这一次。** 口令不落盘（ADR-0052），提交之后就没有再看一眼的地方了，
 * 所以生成的那一刻把结果原样摊开、给一个复制按钮 —— 用户关掉这块之后，
 * 这把口令只存在于他自己的剪贴板或纸上。手动改一个字符明文就收起：
 * 那时它已经不是「刚生成的那个」，再摊着只会让人以为看到的仍是它。
 *
 * 两个框都写 `text-13 md:text-13`：`Input` 自带 `text-base md:text-sm`，窄屏下
 * `text-13` 能盖住 `text-base`（同为普通工具类、字号刻度排在后面），但宽屏那份
 * `md:text-sm` 是变体、排在所有普通工具类之后，非写 `md:text-13` 盖不住 ——
 * 少了它，同一个面板里就会出现 13 与 14 两种字号。
 */
const passphrase = defineModel<string>("passphrase", { required: true })
const confirm = defineModel<string>("confirm", { required: true })

const { notify } = useToast()
const { copied, flash } = useCopied()

/** 刚生成的那个口令。非空时把明文摊开显示。 */
const generated = ref("")

/** 用户动了任一输入框，明文就收起 —— 见上面的注释。 */
watch([passphrase, confirm], ([next, nextConfirm]) => {
  if (next !== generated.value || nextConfirm !== generated.value) generated.value = ""
})

/** 生成一个合规矩的口令，两个框一起填上。 */
function generate(): void {
  const value = generatePassphrase()
  generated.value = value
  passphrase.value = value
  confirm.value = value
}

async function copyGenerated(): Promise<void> {
  if (generated.value === "") return
  try {
    await navigator.clipboard.writeText(generated.value)
  } catch (error) {
    notify(`复制口令失败：${describeError(error)}`, "error")
    return
  }
  flash()
}
</script>

<template>
  <div>
    <div class="mt-1.5 flex items-center gap-1.5">
      <Input
        v-model="passphrase"
        type="password"
        placeholder="新口令"
        class="h-8 flex-1 text-13 md:text-13"
        autocomplete="new-password"
        spellcheck="false"
        data-vault-new-passphrase
      />
      <button
        type="button"
        class="flex h-8 shrink-0 items-center gap-1 rounded-md px-2 text-12 text-muted-foreground ring-1 ring-line/70 transition-colors hover:bg-muted hover:text-foreground"
        title="生成一个 16 位口令（大写 / 小写 / 数字 / 符号各至少一个）"
        data-vault-generate
        @click="generate"
      >
        <WandSparklesIcon class="size-3.5" />生成
      </button>
    </div>
    <Input
      v-model="confirm"
      type="password"
      placeholder="再输一遍"
      class="mt-1.5 h-8 text-13 md:text-13"
      autocomplete="new-password"
      spellcheck="false"
      data-vault-new-passphrase-confirm
    />

    <!-- 生成的明文：唯一一次能看见它的地方。 -->
    <div v-if="generated !== ''" class="mt-1.5 rounded-md bg-muted px-2 py-1.5" data-vault-generated>
      <div class="flex items-center gap-1.5">
        <code class="min-w-0 flex-1 select-all break-all font-mono text-12 text-foreground">{{ generated }}</code>
        <button
          type="button"
          class="grid size-6 shrink-0 place-items-center rounded text-muted-foreground transition-colors hover:bg-card hover:text-foreground"
          :title="copied ? '已复制' : '复制口令'"
          data-vault-generated-copy
          @click="copyGenerated"
        >
          <CheckIcon v-if="copied" class="size-3.5" />
          <CopyIcon v-else class="size-3.5" />
        </button>
      </div>
      <p class="mt-1 text-11 text-muted-foreground">这是唯一一次能看见它的地方 —— 先复制或抄下来，提交之后就再也看不到了。</p>
    </div>

    <p v-if="passphrase !== '' && passphraseProblem(passphrase) !== ''" class="mt-1 text-11 text-destructive">
      {{ passphraseProblem(passphrase) }}
    </p>
    <p v-else-if="confirm !== '' && passphrase !== confirm" class="mt-1 text-11 text-destructive">两次输入的口令不一致</p>
  </div>
</template>

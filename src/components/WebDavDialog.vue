<script setup lang="ts">
import { ref, watch } from "vue"
import { ArrowUpIcon, FolderIcon, LoaderCircleIcon, ServerIcon } from "@lucide/vue"
import { AlertDialog, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { useWorkspace } from "@/composables/useWorkspace"
import { describeError } from "@/lib/errors"
import { loadWebDavConfig } from "@/lib/fs/webdav"
import { createDavClient, normalizeDavUrl } from "@/lib/fs/webdav/client"
import type { DavClient } from "@/lib/fs/webdav/client"
import { BTN_TEXT } from "@/components/ui/button/recipes"

/**
 * 连接 WebDAV 的对话框。
 *
 * 分两步是有意的：**先真的连上、列过目录，才允许「打开」**。WebDAV 的失败方式太多
 * （地址写成分享链接、用了登录密码而不是应用密码、服务器不认 PROPFIND），
 * 如果点一次「确定」就关窗、把错误丢到主界面，用户得反复重开对话框改参数；在这里卡住，
 * 错误与输入框同屏，改完再点就是。
 *
 * 目录只列文件夹：这一步是选「库放在哪」，不是浏览文件。
 */
const props = defineProps<{
  open: boolean
}>()

const emit = defineEmits<{ close: [] }>()

const { openWebDav, fsError } = useWorkspace()

const url = ref("")
const username = ref("")
const password = ref("")

/** `form` 还没连上；`browse` 已连通，正在选目录。 */
const phase = ref<"form" | "browse">("form")
const site = ref<string[]>([])
const folders = ref<string[]>([])
const busy = ref(false)
const error = ref("")

/** 已连通的客户端。切回表单时清掉，避免「改了密码但还在用旧凭据列目录」。 */
let client: DavClient | null = null

watch(
  () => props.open,
  async (open) => {
    if (!open) return
    // 每次打开都回到表单，但把上次的地址与账号填好 —— 换服务器是少数情况。
    phase.value = "form"
    site.value = []
    folders.value = []
    error.value = ""
    client = null
    const saved = await loadWebDavConfig()
    if (saved !== null) {
      url.value = saved.url
      username.value = saved.username
      password.value = saved.password
    }
  },
)

function foldersOf(entries: readonly { name: string; isFolder: boolean }[]): string[] {
  return entries
    .filter((entry) => entry.isFolder)
    .map((entry) => entry.name)
    .sort((left, right) => left.localeCompare(right, "zh-Hans-CN"))
}

/** 存下来的地址可能没带结尾斜杠（旧记录、手改），比之前先归一再比。 */
function sameServer(stored: string, normalized: string): boolean {
  try {
    return normalizeDavUrl(stored) === normalized
  } catch {
    return false
  }
}

async function showFolder(dav: DavClient, segments: string[]): Promise<void> {
  folders.value = foldersOf(await dav.list(segments))
  site.value = segments
}

async function connect(): Promise<void> {
  if (busy.value) return
  busy.value = true
  error.value = ""
  try {
    const dav = createDavClient({
      url: url.value,
      username: username.value.trim(),
      password: password.value,
    })
    const entries = await dav.list([])
    client = dav
    folders.value = foldersOf(entries)
    site.value = []
    phase.value = "browse"

    // 上次选的就是这个服务器时，直接进到那个目录 —— 用户点「连接」正是想回到原处。
    // 目录已经被删掉不算失败：停在根目录让用户重选，比弹一句「找不到」再让人重连温和。
    const saved = await loadWebDavConfig()
    if (saved !== null && sameServer(saved.url, dav.baseUrl) && saved.path !== "") {
      const segments = saved.path.split("/").filter((part) => part !== "")
      try {
        await showFolder(dav, segments)
      } catch {
        await showFolder(dav, [])
      }
    }
  } catch (caught) {
    client = null
    error.value = describeError(caught)
  } finally {
    busy.value = false
  }
}

async function enterFolder(name: string): Promise<void> {
  const dav = client
  if (dav === null || busy.value) return
  busy.value = true
  error.value = ""
  try {
    await showFolder(dav, [...site.value, name])
  } catch (caught) {
    error.value = describeError(caught)
  } finally {
    busy.value = false
  }
}

async function goUp(): Promise<void> {
  const dav = client
  if (dav === null || site.value.length === 0 || busy.value) return
  busy.value = true
  error.value = ""
  try {
    await showFolder(dav, site.value.slice(0, -1))
  } catch (caught) {
    error.value = describeError(caught)
  } finally {
    busy.value = false
  }
}

/** 已经连通过一次，改地址就得重新连 —— 把表单放回来。 */
function backToForm(): void {
  phase.value = "form"
  client = null
  folders.value = []
  site.value = []
  error.value = ""
}

async function confirm(): Promise<void> {
  if (busy.value) return
  busy.value = true
  error.value = ""
  try {
    const ok = await openWebDav({
      url: normalizeDavUrl(url.value),
      username: username.value.trim(),
      password: password.value,
      path: site.value.join("/"),
      active: true,
    })
    if (ok) emit("close")
    else error.value = fsError.value === "" ? "打开失败" : fsError.value
  } catch (caught) {
    error.value = describeError(caught)
  } finally {
    busy.value = false
  }
}
</script>

<template>
  <AlertDialog :open="open" @update:open="emit('close')">
    <AlertDialogContent class="max-w-md">
      <AlertDialogHeader>
        <AlertDialogTitle class="flex items-center gap-1.5 text-14">
          <ServerIcon class="size-4" />
          连接 WebDAV
        </AlertDialogTitle>
        <AlertDialogDescription class="text-12 leading-relaxed">
          笔记直接存在服务器上，保存即上传；没有本地副本，断网时打不开。坚果云请用「应用密码」，不是登录密码。
        </AlertDialogDescription>
      </AlertDialogHeader>

      <div class="flex flex-col gap-2.5">
        <label class="flex flex-col gap-1">
          <span class="text-12 text-muted-foreground">服务器地址</span>
          <Input
            v-model="url"
            class="h-8 text-13"
            placeholder="https://dav.jianguoyun.com/dav/"
            :disabled="phase === 'browse'"
          />
        </label>

        <div class="flex gap-2">
          <label class="flex min-w-0 flex-1 flex-col gap-1">
            <span class="text-12 text-muted-foreground">用户名</span>
            <Input
              v-model="username"
              class="h-8 text-13"
              placeholder="登录邮箱"
              :disabled="phase === 'browse'"
            />
          </label>
          <label class="flex min-w-0 flex-1 flex-col gap-1">
            <span class="text-12 text-muted-foreground">密码</span>
            <Input
              v-model="password"
              type="password"
              class="h-8 text-13"
              placeholder="应用密码"
              :disabled="phase === 'browse'"
            />
          </label>
        </div>
      </div>

      <p v-if="error !== ''" class="text-12 leading-relaxed text-destructive">{{ error }}</p>

      <!-- 连上之后才出现的目录选择。只列文件夹，层级用「上一级」退，不做完整面包屑：
           笔记库通常就一两层，多一行面包屑反而占掉列表高度。 -->
      <div v-if="phase === 'browse'" class="flex flex-col gap-1.5 rounded-[10px] border p-2">
        <div class="flex items-center gap-2">
          <button
            type="button"
            class="grid size-6 shrink-0 place-items-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:pointer-events-none disabled:opacity-40"
            :disabled="site.length === 0 || busy"
            aria-label="上一级"
            @click="goUp"
          >
            <ArrowUpIcon class="size-3.5" />
          </button>
          <span class="min-w-0 flex-1 truncate text-12 text-muted-foreground">
            {{ site.length === 0 ? "服务器根目录" : site.join(" / ") }}
          </span>
          <button type="button" class="text-12 text-muted-foreground hover:text-foreground" @click="backToForm">
            改配置
          </button>
        </div>

        <div class="flex max-h-40 flex-col overflow-y-auto">
          <button
            v-for="name in folders"
            :key="name"
            type="button"
            class="flex h-7 shrink-0 items-center gap-1.5 rounded-md px-1.5 text-left text-13 transition-colors hover:bg-muted disabled:opacity-50"
            :disabled="busy"
            @click="enterFolder(name)"
          >
            <FolderIcon class="size-3.5 shrink-0 text-muted-foreground" />
            <span class="truncate">{{ name }}</span>
          </button>
          <p v-if="folders.length === 0" class="px-1.5 py-2 text-12 text-muted-foreground">
            这个目录下没有子文件夹，可以直接在这里建库
          </p>
        </div>
      </div>

      <AlertDialogFooter>
        <AlertDialogCancel as-child>
          <Button variant="ghost" size="sm" :class="BTN_TEXT">取消</Button>
        </AlertDialogCancel>
        <Button
          v-if="phase === 'form'"
          size="sm"
          class="gap-1.5 text-13"
          :disabled="busy || url.trim() === '' || username.trim() === ''"
          @click="connect"
        >
          <LoaderCircleIcon v-if="busy" class="size-3.5 animate-spin" />
          {{ busy ? "连接中…" : "连接" }}
        </Button>
        <Button v-else size="sm" class="gap-1.5 text-13" :disabled="busy" @click="confirm">
          <LoaderCircleIcon v-if="busy" class="size-3.5 animate-spin" />
          {{ busy ? "打开中…" : "在这里打开" }}
        </Button>
      </AlertDialogFooter>
    </AlertDialogContent>
  </AlertDialog>
</template>

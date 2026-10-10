<script setup lang="ts">
import type { CreateTarget } from "@/types/workspace"
import { FolderIcon, FolderOpenIcon, PlusIcon, SearchIcon, SlidersHorizontalIcon } from "@lucide/vue"
import { computed, ref } from "vue"
import { Button } from "@/components/ui/button"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import { Input } from "@/components/ui/input"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { useWorkspace } from "@/composables/useWorkspace"
import CreateDialog from "./CreateDialog.vue"
import FileTree from "./FileTree.vue"

defineProps<{ width: number }>()

const { query, rootName, hasRoot, scanning, fsHint, openRoot } = useWorkspace()

/** 挂起的命名对话框目标。null 表示关着。 */
const createTarget = ref<CreateTarget | null>(null)

/** 树的根层新建（父目录 = 工作区根，路径为空串）。空库时这里是唯一的入口。 */
function requestCreate(kind: CreateTarget["kind"]) {
  if (!hasRoot.value) return
  createTarget.value = { parentPath: "", kind }
}

/**
 * 悬停提示。
 *
 * 未选目录时要同时说清「点了会发生什么」和「这个平台能记住多少」；已选目录时只剩一个动作，
 * 再挂平台说明是多余信息 —— 那是每次都要重新选目录的人才需要知道的。
 */
const workspaceTip = computed(() =>
  hasRoot.value ? "点击更换目录" : `选择一个存放笔记的文件夹 · ${fsHint.value}`,
)

/**
 * shadcn 的 Input 把 modelValue 声明为 `string | number`，直接 v-model 到 `Ref<string>`
 * 会类型不匹配。这里用显式绑定把值收窄回 string —— 不用类型断言。
 */
function setQuery(value: string | number) {
  query.value = String(value)
}
</script>

<template>
  <aside
    class="flex flex-none flex-col overflow-hidden rounded-block bg-card shadow-block"
    :style="{ width: `${width}px` }"
  >
    <div class="flex h-[42px] flex-none items-center gap-1 pr-2 pl-4">
      <span class="text-[13px] font-medium tracking-[0.01em]">WebNote</span>
      <span class="flex-1" />
      <!-- 全局新建：落在工作区根目录。每个文件夹行另有自己的 `+`，这一处是根层入口，
           也是空库时唯一的入口（此时树里一行都没有）。没选目录时不给点 ——
           按下去不知道往哪儿建，禁用比报错好。 -->
      <DropdownMenu v-if="hasRoot">
        <DropdownMenuTrigger as-child>
          <button
            type="button"
            class="grid size-6 place-items-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            aria-label="新建"
          >
            <PlusIcon class="size-4" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem class="gap-2 text-[13px]" @select="requestCreate('note')">
            <span>新建笔记</span>
          </DropdownMenuItem>
          <DropdownMenuItem class="gap-2 text-[13px]" @select="requestCreate('table')">
            <span>新建数据表</span>
          </DropdownMenuItem>
          <DropdownMenuItem class="gap-2 text-[13px]" @select="requestCreate('folder')">
            <span>新建文件夹</span>
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>

    <!-- 工作区行：当前根目录 + 换目录。未选目录时这一行就是入口本身，
         不再额外塞一个「新建文件夹」之类的空按钮 —— 点了没反应的按钮比没有更糟。 -->
    <div class="flex-none px-2.5 pb-2">
      <Tooltip>
        <TooltipTrigger as-child>
          <button
            type="button"
            class="flex h-7 w-full items-center gap-1.5 rounded-md px-1.5 text-[12px] transition-colors hover:bg-muted"
            :class="hasRoot ? 'text-muted-foreground' : 'font-medium text-foreground'"
            @click="openRoot"
          >
            <FolderOpenIcon class="size-3.5 shrink-0" />
            <span class="min-w-0 flex-1 truncate text-left">
              {{ scanning ? "正在读取…" : hasRoot ? rootName : "打开文件夹" }}
            </span>
            <FolderIcon v-if="hasRoot" class="size-3.5 shrink-0 opacity-45" />
          </button>
        </TooltipTrigger>
        <TooltipContent>{{ workspaceTip }}</TooltipContent>
      </Tooltip>
    </div>

    <div class="flex-none px-2.5 pb-2">
      <div
        class="flex h-[30px] items-center gap-1.5 rounded-[10px] bg-muted px-2.5 transition-colors focus-within:bg-muted-strong"
      >
        <SearchIcon class="size-3.5 shrink-0 text-muted-foreground" />
        <Input
          :model-value="query"
          placeholder="搜索笔记…"
          class="h-full rounded-none border-0 bg-transparent px-0 text-[13px] shadow-none focus-visible:border-transparent focus-visible:ring-0 md:text-[13px]"
          @update:model-value="setQuery"
        />
      </div>
    </div>

    <FileTree @create="(parentPath, kind) => (createTarget = { parentPath, kind })" />

    <div class="flex h-[38px] flex-none items-center gap-2 px-3.5 text-muted-foreground">
      <Button
        variant="ghost"
        size="xs"
        class="-ml-2 gap-1.5 text-[13px] text-muted-foreground hover:text-foreground"
      >
        <SlidersHorizontalIcon class="size-3.5" />
        <span>设置</span>
      </Button>
    </div>

    <CreateDialog :target="createTarget" @close="createTarget = null" />
  </aside>
</template>

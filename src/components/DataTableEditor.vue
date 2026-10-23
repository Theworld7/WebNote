<script setup lang="ts">
import type { DataColumn } from "@/types/data-table"
import type { DataRow } from "@/types/data-table"
import type { DataColumnType, DataSelectOption } from "@/types/data-table"
import { computed, ref } from "vue"
import { ImagePlusIcon, PlusIcon, Trash2Icon, XIcon } from "@lucide/vue"
import { isFileDrag, isImageFile, pickImageFile, readImageFile } from "@/lib/image"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { useWorkspace } from "@/composables/useWorkspace"
import { useTableEntry } from "@/composables/useTableEntry"
import * as dt from "@/lib/data-table"
import { MAX_DATA_TABLE_COLUMNS } from "@/types/data-table"

/**
 * 数据表编辑器 —— 编辑那**一个** `.tbl` 文件的界面。
 *
 * 它是「共享真源」这件事的落点：所有的编辑都在这里发生（或经由引用块，走同一个注册表），
 * 于是任何一处改动都立刻反映到所有引用它的笔记上。它自己不持有数据副本 —— 数据在
 * 注册表里，这里只是它的一个视图。
 *
 * 与笔记里的 `TableBlockView` 刻意不同：
 * - **不受「表格效果」偏好影响**。那个偏好解决的是「表格比正文列宽宽」的问题，而这里
 *   没有正文列 —— 表就是窗口的内容，永远按窗口宽 + 横向滚动（见 GLOSSARY.md）。
 * - **列有类型**，列头是一个下拉菜单（改类型、删列），不是纯文本。
 * - **行不设上限**，这正是数据表存在的理由（见 GLOSSARY.md 的「Data table bound」）。
 *
 * 单元格用朴素 `input` 而不是 `contenteditable`：格子装的是**数据**，不是正文 ——
 * 富文本、行内标记、非受控 DOM 那一整套在这里没有意义，而它会带来一堆复杂度。
 *
 * 取数与改表走 `useTableEntry` 共用 seam（与四个引用块同一条）。编辑器按路径换实例
 * （EditorSurface 给了 key），所以路径在实例生命周期内不变，watch 只是闲着；
 * 「卸载时释放挂载那一刻的路径」的口径由 seam 内部保证。
 */
const { activePath } = useWorkspace()

const { state, table, columns, rows, change } = useTableEntry(() => activePath.value)

/** 单行统计，给状态栏用。 */
const summary = computed(() => {
  if (table.value === null) return ""
  return `${columns.value.length} 列 · ${rows.value.length} 行`
})

// ---- 单元格 ----

function displayOf(row: DataRow, column: DataColumn): string {
  return dt.valueText(dt.cellValue(row, column), column)
}

function commitCell(row: DataRow, column: DataColumn, event: Event): void {
  const target = event.target
  if (!(target instanceof HTMLInputElement)) return
  const parsed = dt.parseCellInput(target.value, column.type)
  if (parsed === dt.cellValue(row, column)) return
  void change((current) => dt.replaceRow(current, dt.setCell(row, column.id, parsed)))
}

function commitOnEnter(event: Event): void {
  const target = event.target
  if (target instanceof HTMLInputElement) target.blur()
}

function toggleCheck(row: DataRow, column: DataColumn, event: Event): void {
  const target = event.target
  if (!(target instanceof HTMLInputElement)) return
  void change((current) => dt.replaceRow(current, dt.setCell(row, column.id, target.checked)))
}

// ---- select 选项 ----

/**
 * 格子的原始值（选项 id）。不能用 `displayOf` —— 它给的是选项**名字**，而 select
 * 元素的选中项要按 id 对上，名字只是显示。
 */
function optionIdOf(row: DataRow, column: DataColumn): string {
  const value = dt.cellValue(row, column)
  return typeof value === "string" ? value : ""
}

function commitOption(row: DataRow, column: DataColumn, event: Event): void {
  const target = event.target
  if (!(target instanceof HTMLSelectElement)) return
  const next = target.value === "" ? null : target.value
  if (next === dt.cellValue(row, column)) return
  void change((current) => dt.replaceRow(current, dt.setCell(row, column.id, next)))
}

function addColumnOption(column: DataColumn, event: Event): void {
  const target = event.target
  if (!(target instanceof HTMLInputElement)) return
  const name = target.value.trim()
  target.value = ""
  if (name === "") return
  void change((current) => dt.addOption(current, column.id, name))
}

function renameColumnOption(column: DataColumn, option: DataSelectOption, event: Event): void {
  const target = event.target
  if (!(target instanceof HTMLInputElement)) return
  const name = target.value.trim()
  // 名字清空不算删除（删除是隔壁那个 ✕），退回原名。
  if (name === "" || name === option.name) {
    target.value = option.name
    return
  }
  void change((current) => dt.renameOption(current, column.id, option.id, name))
}

function removeColumnOption(column: DataColumn, optionId: string): void {
  void change((current) => dt.removeOption(current, column.id, optionId))
}

// ---- 图片列 ----

/** 图片不是文本输入，不走 `parseCellInput`：文件读成 data URI 后直接落格。 */

/** 正被文件拖拽悬停的图片格，`rowId:columnId`，给落点高亮用。 */
const dropKey = ref("")

function cellKey(row: DataRow, column: DataColumn): string {
  return row.id + ":" + column.id
}

function onCellDragOver(event: DragEvent, row: DataRow, column: DataColumn): void {
  if (column.type !== "image") return
  if (!isFileDrag(event.dataTransfer)) return
  event.preventDefault()
  dropKey.value = cellKey(row, column)
}

function onCellDragLeave(column: DataColumn): void {
  if (column.type !== "image") return
  dropKey.value = ""
}

async function onCellDrop(event: DragEvent, row: DataRow, column: DataColumn): Promise<void> {
  if (column.type !== "image") return
  if (!isFileDrag(event.dataTransfer)) return
  event.preventDefault()
  dropKey.value = ""
  // 拖进来的不是图片就安静吃掉，别让浏览器去打开那个文件。
  const file = pickImageFile(event.dataTransfer)
  if (file === null) return
  await setImage(row, column, file)
}

async function onPick(event: Event, row: DataRow, column: DataColumn): Promise<void> {
  const target = event.target
  if (!(target instanceof HTMLInputElement) || target.files === null) return
  const file = target.files[0]
  // 先清空再读：清掉后重选同一个文件也能触发 change。
  target.value = ""
  if (file === undefined) return
  await setImage(row, column, file)
}

async function setImage(row: DataRow, column: DataColumn, file: File): Promise<void> {
  if (!isImageFile(file)) return
  const uri = await readImageFile(file)
  await change((current) => dt.replaceRow(current, dt.setCell(row, column.id, uri)))
}

function clearImage(row: DataRow, column: DataColumn): void {
  void change((current) => dt.replaceRow(current, dt.setCell(row, column.id, null)))
}

// ---- 行列 ----

function addRow(): void {
  void change((current) => dt.addRow(current))
}

function addColumn(): void {
  void change((current) => dt.addColumn(current))
}

function removeRow(rowId: string): void {
  void change((current) => dt.removeRow(current, rowId))
}

function removeColumn(columnId: string): void {
  void change((current) => dt.removeColumn(current, columnId))
}

function setColumnType(columnId: string, type: DataColumnType): void {
  void change((current) => dt.setColumnType(current, columnId, type))
}

function renameColumnAt(column: DataColumn, event: Event): void {
  const target = event.target
  if (!(target instanceof HTMLInputElement)) return
  const name = target.value.trim()
  if (name === column.name) return
  void change((current) => dt.renameColumn(current, column.id, name === "" ? column.name : name))
}

const atColumnLimit = computed(() => columns.value.length >= MAX_DATA_TABLE_COLUMNS)

const COLUMN_TYPE_ITEMS = [
  { type: "text", label: "文本" },
  { type: "number", label: "数字" },
  { type: "date", label: "日期" },
  { type: "select", label: "单选" },
  { type: "checkbox", label: "勾选" },
  { type: "image", label: "图片" },
] satisfies readonly { type: DataColumnType; label: string }[]

/** 菜单外框与菜单项，与块手柄的两套菜单同一套参数。 */
const MENU = "w-[176px] rounded-island p-1.5 shadow-pop ring-1 ring-line/70"
const ITEM = "gap-2.5 rounded-[7px] px-2 py-1"
const MARKER = "w-5.5 shrink-0 text-center font-mono text-[12px] text-muted-foreground"
</script>

<template>
  <!-- 读不到。文件被删或移走 —— 与引用块同一个立场：说明白，不喊错。 -->
  <div v-if="state !== 'loading' && table === null" class="flex flex-1 items-center justify-center p-8">
    <div class="max-w-sm text-center">
      <p class="text-[13px] text-foreground/80">这个数据表读不到</p>
      <p class="mt-1.5 font-mono text-[12px] text-muted-foreground">{{ activePath }}</p>
      <p class="mt-3 text-[12px] text-muted-foreground">
        文件可能已被移动或删除，也可能不是合法的数据表文件。
      </p>
    </div>
  </div>

  <div v-else-if="table !== null" class="flex min-h-0 flex-1 flex-col gap-2 p-3">
    <!-- 工具条：加行加列在左，统计在右。 -->
    <div class="flex shrink-0 items-center gap-1 px-1">
      <Button
        variant="ghost"
        size="sm"
        class="h-7 gap-1 rounded-[7px] px-2 text-[12px] text-muted-foreground hover:text-foreground"
        @click="addRow"
      >
        <PlusIcon class="size-3" />行
      </Button>
      <Button
        variant="ghost"
        size="sm"
        class="h-7 gap-1 rounded-[7px] px-2 text-[12px] text-muted-foreground hover:text-foreground disabled:opacity-40"
        :disabled="atColumnLimit"
        @click="addColumn"
      >
        <PlusIcon class="size-3" />列
      </Button>

      <div class="flex-1" />

      <span class="pr-1 font-mono text-[12px] text-muted-foreground">{{ summary }}</span>
    </div>

    <!-- 表格：自己横向滚动，永远铺满窗口宽度（不受「表格效果」偏好影响）。 -->
    <div class="table-scrollbar min-h-0 flex-1 overflow-auto rounded-lg border border-line">
      <table class="w-full border-separate border-spacing-0 text-[13px]">
        <thead>
          <tr>
            <!-- 行号列。固定短宽度，不参与列模型。 -->
            <th class="sticky left-0 z-10 w-9 border-r border-b border-line bg-muted/60 px-2 py-1.5 text-right font-mono text-[11px] font-normal text-muted-foreground/70">
              #
            </th>
            <th
              v-for="column in columns"
              :key="column.id"
              class="min-w-32 border-r border-b border-line bg-muted/40 px-1.5 py-1 align-middle"
            >
              <div class="flex items-center gap-1">
                <!-- 列名可改：直接编输入框。 -->
                <input
                  class="min-w-0 flex-1 bg-transparent font-medium text-foreground/90 outline-none"
                  :value="column.name"
                  @keydown.enter.prevent="commitOnEnter"
                  @blur="(event: Event) => renameColumnAt(column, event)"
                >
                <DropdownMenu>
                  <DropdownMenuTrigger as-child>
                    <button
                      type="button"
                      class="shrink-0 rounded-[5px] px-1 font-mono text-[11px] text-muted-foreground/70 hover:bg-muted hover:text-foreground"
                    >
                      {{ dt.columnTypeLabel(column.type) }}
                    </button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent :class="MENU" align="end">
                    <DropdownMenuLabel class="px-2 pb-1 pt-1.5 text-[11px] font-normal text-muted-foreground">
                      列类型
                    </DropdownMenuLabel>
                    <DropdownMenuItem
                      v-for="item in COLUMN_TYPE_ITEMS"
                      :key="item.type"
                      :class="ITEM"
                      @select="setColumnType(column.id, item.type)"
                    >
                      <span :class="MARKER">{{ column.type === item.type ? "✓" : "" }}</span>
                      <span>{{ item.label }}</span>
                    </DropdownMenuItem>
                    <template v-if="column.type === 'select'">
                      <DropdownMenuSeparator class="mx-2 my-1 bg-line" />
                      <DropdownMenuLabel class="px-2 pb-1 pt-1.5 text-[11px] font-normal text-muted-foreground">
                        选项
                      </DropdownMenuLabel>
                      <!-- 选项维护就地下拉里做:改名的格子存的是 id,改名不动任何一行;
                           删除会把引用它的格子清空(见 lib/data-table 的 removeOption)。
                           输入框上的 @keydown.stop 是**必须**的:不挡住冒泡,菜单的 typeahead
                           会把这些按键当成「跳到匹配项」。代价是 Esc 关不掉这个菜单,
                           点外部仍可关。 -->
                      <div class="max-h-44 space-y-0.5 overflow-y-auto px-2 pb-1">
                        <div v-for="option in column.options" :key="option.id" class="flex items-center gap-1">
                          <input
                            class="min-w-0 flex-1 rounded border border-line bg-transparent px-1.5 py-0.5 text-[12px] outline-none"
                            :value="option.name"
                            @click.stop
                            @keydown.stop
                            @keydown.enter.prevent="renameColumnOption(column, option, $event)"
                            @blur="(event: Event) => renameColumnOption(column, option, event)"
                          >
                          <button
                            type="button"
                            class="shrink-0 rounded p-0.5 text-muted-foreground hover:text-destructive"
                            aria-label="删除该选项"
                            @click.stop="removeColumnOption(column, option.id)"
                          >
                            <XIcon class="size-3" />
                          </button>
                        </div>
                        <input
                          class="w-full rounded border border-dashed border-line bg-transparent px-1.5 py-0.5 text-[12px] outline-none placeholder:text-muted-foreground/50"
                          placeholder="新增选项，回车确认"
                          @click.stop
                          @keydown.stop
                          @keydown.enter.prevent="addColumnOption(column, $event)"
                        >
                      </div>
                    </template>
                    <DropdownMenuSeparator class="mx-2 my-1 bg-line" />
                    <DropdownMenuItem
                      variant="destructive"
                      :class="ITEM"
                      :disabled="columns.length <= 1"
                      @select="removeColumn(column.id)"
                    >
                      <span :class="MARKER">✕</span>
                      <span>删除本列</span>
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
            </th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="(row, rowIndex) in rows" :key="row.id" class="group/drow">
            <th class="sticky left-0 z-10 border-r border-b border-line bg-muted/30 px-2 py-1 text-right font-mono text-[11px] font-normal text-muted-foreground/60">
              <!-- 悬停换成删除钮:行号改用 invisible 让位不撤宽度,钮绝对定位叠在原位 ——
                   两态占同一格,列宽不变,表格不跳动。 -->
              <span class="group-hover/drow:invisible">{{ rowIndex + 1 }}</span>
              <button
                type="button"
                class="absolute inset-y-0 right-2 hidden items-center text-muted-foreground hover:text-destructive group-hover/drow:flex"
                aria-label="删除本行"
                @click="removeRow(row.id)"
              >
                <Trash2Icon class="size-3" />
              </button>
            </th>
            <!-- 数字列右对齐 + 等宽数字，与引用块同一条判据（`dt.isNumberColumn`）。
                 表头保持左对齐：那儿是可编辑的列名，右对齐会让光标贴右边缘。 -->
            <td
              v-for="column in columns"
              :key="column.id"
              class="border-r border-b border-line px-1.5 py-1 align-middle last:border-r-0"
              :class="[
                dt.isNumberColumn(column) && 'text-right tabular-nums',
                dropKey === cellKey(row, column) && 'ring-2 ring-inset ring-selection-strong',
              ]"
              @dragover="onCellDragOver($event, row, column)"
              @dragleave="onCellDragLeave(column)"
              @drop="onCellDrop($event, row, column)"
            >
              <!-- 图片格：选图 / 缩略图 / 清除，不是文本输入。 -->
              <div v-if="column.type === 'image'" class="flex items-center justify-center">
                <label
                  v-if="dt.cellValue(row, column) === null"
                  class="flex cursor-pointer items-center gap-1 rounded-[5px] px-1.5 py-0.5 text-[12px] text-muted-foreground/50 hover:bg-muted hover:text-muted-foreground"
                >
                  <ImagePlusIcon class="size-3" />图片
                  <input type="file" accept="image/*" class="hidden" @change="onPick($event, row, column)">
                </label>
                <div v-else class="group/img relative">
                  <!-- loading=lazy + decoding=async：格子存的是整图 data URI，一张表可能
                       几十张、总量几十 MB，挂载即全部解码会把首帧拖住数秒。
                       视口外的先不解，滚到附近再解。高度给到 h-16：太小的缩略图会把
                       右上角的清除钮挤成主要命中区，容易误触。 -->
                  <img
                    :src="String(dt.cellValue(row, column))"
                    alt=""
                    loading="lazy"
                    decoding="async"
                    class="h-16 w-full rounded-lg object-cover"
                  >
                  <button
                    type="button"
                    class="absolute right-0.5 top-0.5 hidden rounded bg-background/80 p-1 text-muted-foreground hover:text-destructive reduce-transparency:bg-background group-hover/img:block"
                    aria-label="清除图片"
                    @click.stop="clearImage(row, column)"
                  >
                    <XIcon class="size-3" />
                  </button>
                </div>
              </div>
              <input
                v-else-if="column.type === 'checkbox'"
                type="checkbox"
                class="size-3.5 align-middle accent-foreground"
                :checked="dt.cellValue(row, column) === true"
                @change="(event: Event) => toggleCheck(row, column, event)"
              >
              <!-- 单选格：下拉选已有选项。空项给「—」，选中即清空该格。
                   选项在列头菜单里维护 —— 名字可改，格子存的是 id，改名不动数据。 -->
              <select
                v-else-if="column.type === 'select'"
                class="w-full cursor-pointer bg-transparent outline-none"
                :value="optionIdOf(row, column)"
                @change="(event: Event) => commitOption(row, column, event)"
              >
                <option value="">—</option>
                <option v-for="option in column.options" :key="option.id" :value="option.id">{{ option.name }}</option>
              </select>
              <input
                v-else
                class="w-full bg-transparent outline-none placeholder:text-muted-foreground/40"
                :class="dt.isNumberColumn(column) && 'text-right tabular-nums'"
                :value="displayOf(row, column)"
                :placeholder="column.type === 'date' ? 'YYYY-MM-DD' : ''"
                @keydown.enter.prevent="commitOnEnter"
                @blur="(event: Event) => commitCell(row, column, event)"
              >
            </td>
          </tr>

          <!-- 末尾的「加一行」行：点一下就到下一行，比回工具条找按钮快。 -->
          <tr>
            <th class="sticky left-0 z-10 border-r border-line bg-muted/30" />
            <td :colspan="columns.length" class="border-line px-1.5 py-0">
              <button
                type="button"
                class="flex w-full items-center gap-1 rounded-[5px] px-1 py-0.5 text-left text-[12px] text-muted-foreground/50 hover:bg-muted hover:text-muted-foreground"
                @click="addRow"
              >
                <PlusIcon class="size-3" />新记录
              </button>
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  </div>

  <!-- 读盘 + 解析的等待期（state 停在 loading）：给一句提示而不是空白，
       否则大表打开时界面像死了。读不到的分支在上面已经截走，走到这里的都还在读。 -->
  <div v-else class="flex flex-1 items-center justify-center p-8">
    <p class="text-[12px] text-muted-foreground">正在读取数据表…</p>
  </div>
</template>

import type { CreateTarget, TreeTarget } from "@/types/workspace"
import { ref } from "vue"

/**
 * 命名 / 重命名 / 删除三个对话框的挂起目标。
 *
 * 对话框本身只在侧栏（`AppSidebar`）里画一次，而**打开它的入口有两处**：文件树的行菜单
 * 和编辑器标签的右键菜单（ADR-0046）。目标状态放在模块作用域，两处都只是把目标填上，
 * 不必为了共用把对话框提到 `App` 再逐层往下钻 props。
 */
const createTarget = ref<CreateTarget | null>(null)
const renameTarget = ref<TreeTarget | null>(null)
const deleteTarget = ref<TreeTarget | null>(null)

export function useTreeDialogs() {
  function requestCreate(parentPath: string, kind: CreateTarget["kind"]): void {
    createTarget.value = { parentPath, kind }
  }

  function requestRename(path: string, kind: TreeTarget["kind"]): void {
    renameTarget.value = { path, kind }
  }

  function requestRemove(path: string, kind: TreeTarget["kind"]): void {
    deleteTarget.value = { path, kind }
  }

  return {
    createTarget,
    renameTarget,
    deleteTarget,
    closeCreate: () => (createTarget.value = null),
    closeRename: () => (renameTarget.value = null),
    closeRemove: () => (deleteTarget.value = null),
    requestCreate,
    requestRename,
    requestRemove,
  }
}

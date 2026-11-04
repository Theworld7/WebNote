import type { FileNode } from "@/types/workspace"
import type { FsRoot, WorkspaceFs } from "../types"
import { joinPath, toSegments } from "@/lib/paths"
import { isTauriRuntime } from "../runtime"
import {
  MAX_DEPTH,
  fileNode,
  folderNode,
  isBrowsableDir,
  isBrowsableFile,
  sortNodes,
} from "../policy"
import { DavError, createDavClient } from "./client"

/**
 * WebDAV 工作区。
 *
 * 与另外两份实现的分别只在「根」是什么：这里远端目录本身就是库，读写都直接落到
 * 服务器，没有本地副本，因此也没有合并、冲突、离线这些概念 —— 连不上就是连不上，
 * 保存失败就是保存失败，都会如实报出来。
 *
 * 代价明摆着：断网时打不开笔记。这是「直接当工作区」这个选择的固有形状，不是缺陷；
 * 需要离线可用就得做一整套同步引擎，那是另一件事。
 */

export interface WebDavConfig {
  /** 服务器地址（结尾斜杠由客户端补）。 */
  url: string
  username: string
  password: string
  /** 服务器上放笔记的目录，相对 `url`，空串表示就是它本身。用 `/` 分段。 */
  path: string
  /** 上次打开的就是它。启动时据此决定重连远端还是回到本地目录。 */
  active: boolean
}

/** 浏览器端存 `localStorage`，桌面端存 app config 目录的 `webdav.json`。 */
const STORE_KEY = "webnote.webdav"

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null
}

/**
 * 从 `unknown` 收窄成配置。
 *
 * 存储里的东西可能是上一版写的、也可能被手改过，所以逐字段验证而不是断言 ——
 * 类型断言在这里只会把「配置坏了」变成运行时到处 undefined。
 */
function parseConfig(value: unknown): WebDavConfig | null {
  if (!isRecord(value)) return null
  const url = value.url
  const username = value.username
  const password = value.password
  const path = value.path
  if (
    typeof url !== "string" ||
    typeof username !== "string" ||
    typeof password !== "string" ||
    typeof path !== "string"
  ) {
    return null
  }
  return { url, username, password, path, active: value.active === true }
}

export async function loadWebDavConfig(): Promise<WebDavConfig | null> {
  if (isTauriRuntime()) {
    const { invoke } = await import("@tauri-apps/api/core")
    const stored = await invoke<unknown>("load_webdav_config")
    return parseConfig(stored)
  }
  try {
    const raw = localStorage.getItem(STORE_KEY)
    return raw === null ? null : parseConfig(JSON.parse(raw))
  } catch {
    return null
  }
}

/** 传 `null` 抹掉记录（忘掉账号）。 */
export async function saveWebDavConfig(config: WebDavConfig | null): Promise<void> {
  if (isTauriRuntime()) {
    const { invoke } = await import("@tauri-apps/api/core")
    await invoke("save_webdav_config", { config })
    return
  }
  if (config === null) localStorage.removeItem(STORE_KEY)
  else localStorage.setItem(STORE_KEY, JSON.stringify(config))
}

/**
 * 记住 / 取消「上次用的是 WebDAV」。
 *
 * 不删账号：换回本地目录只是这次不用它了，下次想连回来不该重新填一遍密码。
 */
export async function setWebDavActive(active: boolean): Promise<void> {
  const config = await loadWebDavConfig()
  if (config === null || config.active === active) return
  await saveWebDavConfig({ ...config, active })
}

/** 配置里的远端目录 → 路径段。存的是 `/` 分隔，不是工作区那套 `" / "`。 */
function siteSegments(config: WebDavConfig): string[] {
  return config.path.split("/").filter((part) => part !== "")
}

/** 调试与展示用的把配置变成根句柄。与 `createWebDavFs` 内部的根必须同源。 */
export function webDavRootOf(config: WebDavConfig): FsRoot {
  return { kind: "webdav", url: createDavClient(config).folderUrlOf(siteSegments(config)) }
}

export function createWebDavFs(config: WebDavConfig): WorkspaceFs {
  const client = createDavClient(config)
  const site = siteSegments(config)
  const root = webDavRootOf(config)

  /** 工作区路径 → 远端路径段。所有动作都从这里出发，别处不再手拼。 */
  function remote(path: string): string[] {
    return [...site, ...toSegments(path)]
  }

  async function walk(path: string, depth: number): Promise<FileNode[]> {
    const entries = await client.list(remote(path))
    const nodes: FileNode[] = []
    for (const entry of entries) {
      if (entry.isFolder) {
        if (depth >= MAX_DEPTH || !isBrowsableDir(entry.name)) continue
        const childPath = joinPath(path, entry.name)
        nodes.push(folderNode(path, entry.name, await walk(childPath, depth + 1)))
        continue
      }
      if (isBrowsableFile(entry.name)) nodes.push(fileNode(path, entry.name))
    }
    return sortNodes(nodes)
  }

  return {
    kind: "webdav",
    canRestore: true,
    hint: "WebDAV · 保存直接写回服务器，断网时打不开",

    /**
     * 远端目录没法用「选目录」对话框挑 —— 入口是那张连接表单（`WebDavDialog`）。
     * 走到这里说明调用方拿驱动当本地那份用了，返回当前根至少不会把它带偏。
     */
    async pickRoot() {
      return root
    },

    /** 探测一次根目录：还在就恢复，被删了返回 `null` 让调用方回落到本地目录。 */
    async restoreRoot() {
      return (await client.stat(site)) ? root : null
    },

    rootName() {
      if (site.length > 0) return site[site.length - 1]!
      // 根就是服务器本身时，用主机名当名字：`dav.jianguoyun.com` 比一个空串好认。
      return new URL(client.baseUrl).host
    },

    async scanTree() {
      return walk("", 0)
    },

    async scanDir(_root, path) {
      const entries = await client.list(remote(path))
      const nodes: FileNode[] = []
      for (const entry of entries) {
        if (entry.isFolder) {
          if (!isBrowsableDir(entry.name)) continue
          nodes.push(folderNode(path, entry.name, []))
          continue
        }
        if (isBrowsableFile(entry.name)) nodes.push(fileNode(path, entry.name))
      }
      return sortNodes(nodes)
    },

    async exists(_root, path) {
      return client.stat(remote(path))
    },

    async readNote(_root, path) {
      return client.readText(remote(path))
    },

    async readBinary(_root, path) {
      return client.readBytes(remote(path))
    },

    /**
     * 没有「交给播放器自己去取」的地址：取文件要带 Basic 认证头，而 `<video src>` 发不了。
     * 返回 `null` 让调用方退回 `readBinary`（整段读进内存再包 blob）—— 大视频会吃内存，
     * 这是 WebDAV 工作区绕不开的一处代价。
     */
    streamUrl() {
      return null
    },

    async writeNote(_root, path, html) {
      await client.writeText(remote(path), html)
    },

    async writeBinary(_root, path, bytes) {
      await client.writeBytes(remote(path), bytes)
    },

    async createNote(_root, path, html) {
      try {
        await client.writeText(remote(path), html, { createOnly: true })
      } catch (error) {
        // 412 是 `If-None-Match: *` 的拒绝，语义正是「已存在」。
        if (error instanceof DavError && error.status === 412) {
          throw new Error(`已存在同名文件：${path}`)
        }
        throw error
      }
    },

    async createFolder(_root, path) {
      const segments = remote(path)
      // 逐级建：WebDAV 的 MKCOL 不会替你把父目录补上（父级缺失回 409）。
      for (let index = 1; index <= segments.length; index += 1) {
        await client.makeFolder(segments.slice(0, index))
      }
    },

    async move(_root, from, to) {
      if (await client.stat(remote(to))) throw new Error(`已存在同名文件：${to}`)
      await client.move(remote(from), remote(to))
    },

    async rename(_root, from, to) {
      if (await client.stat(remote(to))) throw new Error(`已存在同名文件：${to}`)
      await client.move(remote(from), remote(to))
    },

    async remove(_root, path) {
      await client.remove(remote(path))
    },

    absolutePath(_root, path) {
      // 根自己按目录 URL 给（带结尾斜杠），与 `webDavRootOf` 同形 —— 会话快照拿它当键，
      // 两处不一致就会在「重开应用」时读不到上次的标签。
      if (path === "") return client.folderUrlOf(site)
      return client.urlOf(remote(path))
    },

    /** 远端没有系统文件管理器，也没有「用本机浏览器打开」这回事。 */
    async revealInFileManager() {
      return false
    },

    async openInBrowser() {
      return false
    },
  }
}

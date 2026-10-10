#!/usr/bin/env node
/**
 * 图标自检：把生成的 SVG 重新解析一遍，对着 icon.tokens.json 验收。
 *
 * 这里校的是「SVG 这一侧渲染得对不对」——因为这台机器的沙箱起不了无头浏览器，
 * 没法把 SVG 光栅化出来比像素。位图那一侧由 design/icon/rasterize.py 自己渲染，
 * 两边共用同一份 tokens，所以把 tokens → SVG 的结构核准，视觉就不会跑偏。
 *
 * 校的项：
 *   - 是合法 XML，根节点是 1024×1024、viewBox 正确、没有不透明底
 *   - 每个 url(#…) 引用都能在本文件里找到定义（写错 id 是最容易犯的错）
 *   - 背景路径的外接盒正好是 1024×1024，且采样点回代超椭圆方程误差 < 0.5px
 *   - 面板圆角矩形的左上/右下落在 tokens 上的位置
 *   - 折角三角形与折缝的两个端点
 *   - 字形三笔的端点坐标
 *
 * 用法：node design/icon/verify.mjs
 */

import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const REPO = join(HERE, '..', '..')
const ICONS = join(REPO, 'src-tauri', 'icons')
const tokens = JSON.parse(readFileSync(join(HERE, 'icon.tokens.json'), 'utf8'))

const CANVAS = tokens.geometry.canvas
const N = tokens.geometry.exponent
const HALF = CANVAS / 2

let failures = 0
function check(name, ok, detail = '') {
  console.log(`${ok ? 'OK  ' : 'FAIL'} ${name}${detail ? ` · ${detail}` : ''}`)
  if (!ok) failures++
}

/* ── 极简 XML 解析：够用就好，只要元素、属性和自闭合 ── */

function parseTags(text) {
  const tags = []
  const re = /<([a-zA-Z][\w:-]*)((?:\s+[\w:-]+\s*=\s*"[^"]*")*)\s*(\/?)>|<\/([a-zA-Z][\w:-]*)>/g
  let m
  while ((m = re.exec(text))) {
    if (m[4]) {
      tags.push({ closing: m[4] })
      continue
    }
    const attrs = {}
    const ar = /([\w:-]+)\s*=\s*"([^"]*)"/g
    let a
    while ((a = ar.exec(m[2] || ''))) attrs[a[1]] = a[2]
    tags.push({ name: m[1], attrs, selfClosing: m[3] === '/' })
  }
  return tags
}

/**
 * 从路径 d 里取出**落在曲线上的锚点**。
 * 不能直接扫数字：C 的控制点和 A 的圆弧标志都不是锚点，会把外接盒算歪。
 * 这里按字符位置解析，遇到不认识的指令直接报错，而不是悄悄错位。
 */
function anchors(d) {
  const CMDS = 'MLHVCZmlhvczaA'
  const isCmd = (ch) => CMDS.includes(ch)
  let i = 0
  let cur = [0, 0]
  let start = [0, 0]
  const out = []

  const skipSep = () => {
    while (i < d.length && /[\s,]/.test(d[i])) i++
  }
  const num = () => {
    skipSep()
    const m = /^-?\d*\.?\d+(?:[eE][-+]?\d+)?/.exec(d.slice(i))
    if (!m) throw new Error(`位置 ${i} 处期望数字，实际是 "${d.slice(i, i + 12)}"`)
    i += m[0].length
    return Number(m[0])
  }

  while (i < d.length) {
    skipSep()
    if (i >= d.length) break
    const cmd = d[i]
    if (!isCmd(cmd)) throw new Error(`没处理的路径指令：${cmd}（位置 ${i}）`)
    i++
    if (cmd === 'M' || cmd === 'L') {
      cur = [num(), num()]
      if (cmd === 'M') start = cur
      out.push(cur)
    } else if (cmd === 'H') {
      cur = [num(), cur[1]]
      out.push(cur)
    } else if (cmd === 'V') {
      cur = [cur[0], num()]
      out.push(cur)
    } else if (cmd === 'C') {
      num(); num(); num(); num()
      cur = [num(), num()]
      out.push(cur)
    } else if (cmd === 'A') {
      // rx ry x-axis-rotation large-arc-flag sweep-flag x y —— 六个参数，不是五个
      num(); num(); num(); num(); num()
      cur = [num(), num()]
      out.push(cur)
    } else if (cmd === 'Z' || cmd === 'z') {
      cur = start
    }
  }
  return out
}

/** 超椭圆隐函数残差（像素）；点以画布左上为原点。 */
function squircleResidual(x, y) {
  const px = (x - HALF) / HALF
  const py = (y - HALF) / HALF
  const v = Math.abs(px) ** N + Math.abs(py) ** N - 1
  const gx = (N * Math.abs(px) ** (N - 1)) / HALF
  const gy = (N * Math.abs(py) ** (N - 1)) / HALF
  return Math.abs(v) / Math.hypot(gx, gy)
}

/* ── 逐个文件验收 ── */

const targets = [
  ['webnote-icon.svg', 'light', ['background', 'sheet', 'mark']],
  ['webnote-icon-dark.svg', 'dark', ['background', 'sheet', 'mark']],
  ['layers/background.svg', 'light', ['background']],
  ['layers/sheet.svg', 'light', ['sheet']],
  ['layers/mark.svg', 'light', ['mark']],
  ['layers/background-dark.svg', 'dark', ['background']],
  ['layers/sheet-dark.svg', 'dark', ['sheet']],
  ['layers/mark-dark.svg', 'dark', ['mark']],
]

const bgPathOf = tokens => tokens // 占位，避免未使用告警

for (const [rel, , expectedLayers] of targets) {
  console.log(`\n── ${rel}`)
  const text = readFileSync(join(ICONS, rel), 'utf8')
  const tags = parseTags(text)

  // 1. 根节点与画布
  const svg = tags.find((t) => t.name === 'svg')
  check('根节点是 svg', !!svg)
  check(
    `viewBox = 0 0 ${CANVAS} ${CANVAS}`,
    svg?.attrs.viewBox === `0 0 ${CANVAS} ${CANVAS}`,
    svg?.attrs.viewBox,
  )
  check(
    '没有不透明底（图标要自带圆角，不是方块）',
    !/<rect[^>]*width="1024"[^>]*height="1024"/.test(text) && !svg?.attrs.style,
  )

  // 2. 引用完整性
  const defined = new Set(tags.filter((t) => t.attrs?.id).map((t) => t.attrs.id))
  const used = [...text.matchAll(/url\(#([^)]+)\)/g)].map((m) => m[1])
  const dangling = [...new Set(used)].filter((u) => !defined.has(u))
  check(`url(#…) 引用全部有定义（${new Set(used).size} 个）`, dangling.length === 0, dangling.join(', '))

  // 3. 分层齐全（id 形如 wn-background-background / wn-sheet-background）
  for (const layer of expectedLayers) {
    check(`含 ${layer} 层`, text.includes(`id="wn-${layer}`))
  }
  check(
    '不含不该有的层',
    ['background', 'sheet', 'mark']
      .filter((l) => !expectedLayers.includes(l))
      .every((l) => !text.includes(`id="wn-${l}-`)),
  )

  // 4. 背景：外接盒 + 超椭圆残差
  //    生成的坐标就是画布坐标（左上为原点）
  if (expectedLayers.includes('background')) {
    const bgPath = text.match(/<path d="(M [^"]+)" fill="url\(#wn-bg\)"/)?.[1]
    check('背景路径存在', !!bgPath)
    if (bgPath) {
      const pts = anchors(bgPath)
      const xs = pts.map((p) => p[0])
      const ys = pts.map((p) => p[1])
      check(
        `背景外接盒 ≈ ${CANVAS}×${CANVAS}`,
        Math.abs(Math.min(...xs)) < 1 &&
          Math.abs(Math.min(...ys)) < 1 &&
          Math.abs(Math.max(...xs) - CANVAS) < 1 &&
          Math.abs(Math.max(...ys) - CANVAS) < 1,
        `x ${Math.min(...xs).toFixed(1)}…${Math.max(...xs).toFixed(1)}, y ${Math.min(...ys).toFixed(1)}…${Math.max(...ys).toFixed(1)}`,
      )
      let worst = 0
      for (const [x, y] of pts) worst = Math.max(worst, squircleResidual(x, y))
      check('背景是超椭圆（残差 < 0.5px）', worst < 0.5, `最大残差 ${worst.toFixed(4)}px`)
    }
  }

  // 5. 面板：圆角矩形落在 tokens 的位置
  const sheetPath = text.match(/<path d="(M [^"]+)" fill="url\(#wn-sheet\)"/)?.[1]
  if (expectedLayers.includes('sheet')) {
    const s = tokens.sheet
    check('面板路径存在', !!sheetPath)
    if (sheetPath) {
      const pts = anchors(sheetPath)
      check(
        '面板左上角 = tokens.sheet',
        Math.abs(pts[0][0] - (s.x + s.radius)) < 0.01 && Math.abs(pts[0][1] - s.y) < 0.01,
        `(${pts[0][0]}, ${pts[0][1]}) 期望 (${s.x + s.radius}, ${s.y})`,
      )
      check(
        `面板圆角 ${s.radius}，右下角 (${s.x + s.size}, ${s.y + s.size})`,
        sheetPath.includes(
          `A ${s.radius} ${s.radius} 0 0 1 ${s.x + s.size - s.radius} ${s.y + s.size}`,
        ),
      )
      // 外接盒必须正好是面板本身，尺寸/参数写错会立刻在这里露出来
      const xs = pts.map((p) => p[0])
      const ys = pts.map((p) => p[1])
      check(
        `面板外接盒 = ${s.size}×${s.size}（${s.x}…${s.x + s.size}, ${s.y}…${s.y + s.size}）`,
        Math.min(...xs) === s.x &&
          Math.max(...xs) === s.x + s.size &&
          Math.min(...ys) === s.y &&
          Math.max(...ys) === s.y + s.size,
        `x ${Math.min(...xs)}…${Math.max(...xs)}, y ${Math.min(...ys)}…${Math.max(...ys)}`,
      )
    }
    const f = tokens.sheet
    const fx = f.x + f.size
    const fcx = fx - f.fold
    check(
      '折角三角与折缝端点正确',
      text.includes(`M ${fcx} ${f.y} L ${fx} ${f.y + f.fold} L ${fcx} ${f.y + f.fold} Z`) &&
        text.includes(`M ${fcx} ${f.y} L ${fx} ${f.y + f.fold}" fill="none"`),
    )
  }

  // 6. 字形：三笔端点（同样是画布坐标）
  const g = tokens.glyph
  const gcx = g.center[0]
  const gcy = g.center[1]
  if (expectedLayers.includes('mark')) {
    const open = `M ${gcx - g.spread} ${gcy - g.height / 2} L ${gcx - g.spread - 50} ${gcy} L ${gcx - g.spread} ${gcy + g.height / 2}`
    const close = `M ${gcx + g.spread} ${gcy - g.height / 2} L ${gcx + g.spread + 50} ${gcy} L ${gcx + g.spread} ${gcy + g.height / 2}`
    const slash = `M ${gcx + g.slashSpread} ${gcy - g.slashHeight / 2} L ${gcx - g.slashSpread} ${gcy + g.slashHeight / 2}`
    check('尖括号两笔端点正确', text.includes(open) && text.includes(close))
    check('斜线端点正确', text.includes(slash))
    check(`字形线宽 ${g.stroke}`, text.includes(`stroke-width="${g.stroke}"`))
    // 字形必须落在面板之内，不能压到折角或出框
    const s = tokens.sheet
    check(
      '字形在面板内（左右各留 ≥ 40px）',
      gcx - g.spread - 50 > s.x + 40 && gcx + g.spread + 50 < s.x + s.size - 40,
    )
    check(
      '字形不碰折角',
      gcy - g.slashHeight / 2 > s.y + 8 && gcx + g.spread + 50 < s.x + s.size - s.fold,
    )
    for (const [i, row] of tokens.bars.rows.entries()) {
      const x = (CANVAS - row.width) / 2
      check(`正文行 ${i + 1} 居中`, text.includes(`x="${x}" y="${row.y}" width="${row.width}"`))
      check(
        `正文行 ${i + 1} 在面板内且不与字形重叠`,
        row.y > gcy + g.height / 2 + 20 && row.y + tokens.bars.height < s.y + s.size - 20,
      )
    }
  }

  // 7. 深/浅外观确实用了不同的配色
  if (expectedLayers.includes('background')) {
    const grad = text.match(/<linearGradient id="wn-bg"[\s\S]*?<\/linearGradient>/)?.[0] ?? ''
    const theme = targets.find((t) => t[0] === rel)[1]
    const hex = (rgb) => `rgb(${rgb[0]} ${rgb[1]} ${rgb[2]})`
    check(
      '背景渐变的色标与 tokens.themes 一致',
      tokens.themes[theme].bg.every(([, rgb]) => grad.includes(hex(rgb))),
      grad.match(/stop-color="[^"]+"/g)?.join(' '),
    )
  }
}

console.log(
  failures === 0
    ? '\n全部通过。'
    : `\n${failures} 项未通过。`,
)
process.exit(failures === 0 ? 0 : 1)

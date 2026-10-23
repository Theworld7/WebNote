#!/usr/bin/env node
/**
 * 图标自检：把生成的 SVG 重新解析一遍，对着 icon.tokens.json 验收。
 *
 * 这里校的是「SVG 这一侧结构对不对」——因为这台机器的沙箱起不了无头浏览器，
 * 没法把 SVG 光栅化出来比像素。位图那一侧由 design/icon/rasterize.py 自己渲染，
 * 两边共用同一份 tokens，所以把 tokens → SVG 的结构核准，视觉就不会跑偏。
 *
 * 校的项：
 *   - 是合法 XML，根节点是 1024×1024、viewBox 正确
 *   - 每个 url(#…) 引用都能在本文件里找到定义（写错 id 是最容易犯的错）
 *   - 背景路径的外接盒正好是 1024×1024，且采样点回代超椭圆方程误差 < 0.5px
 *   - 面板圆角矩形落在 tokens 上的位置，且**几何中心就在画布中心**
 *   - 折角三角形与折缝的两个端点
 *   - 字形三笔的端点坐标、线宽、是否越出面板 / 压到折角
 *   - 两套母版的可读性下限：小尺寸母版在 32px 下线宽 ≥ 1.25px，完整版在 64px 下 ≥ 1.5px
 *   - layers/ 那三份给 Icon Composer 的层：背景必须是正方形不透明且不含任何烘焙光效，
 *     面板层不能带高光描边（否则和系统镜面高光叠成双层）
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
const SMALL_MAX = tokens.small.maxSize

// 可读性下限：小尺寸母版要服务到 32px（任务栏 / 列表视图），完整版从阈值往上一档算 64px。
const LEGIBLE_AT_32 = 1.25
const LEGIBLE_AT_64 = 1.5

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
      num()
      num()
      num()
      num()
      cur = [num(), num()]
      out.push(cur)
    } else if (cmd === 'A') {
      // rx ry x-axis-rotation large-arc-flag sweep-flag x y —— 六个参数，不是五个
      num()
      num()
      num()
      num()
      num()
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

/** 字形三笔的期望路径，大母版与小尺寸母版各算一遍。 */
function glyphPaths(g) {
  const [gcx, gcy] = g.center
  return {
    open: `M ${gcx - g.spread} ${gcy - g.height / 2} L ${gcx - g.spread - g.head} ${gcy} L ${gcx - g.spread} ${gcy + g.height / 2}`,
    close: `M ${gcx + g.spread} ${gcy - g.height / 2} L ${gcx + g.spread + g.head} ${gcy} L ${gcx + g.spread} ${gcy + g.height / 2}`,
    slash: `M ${gcx + g.slashSpread} ${gcy - g.slashHeight / 2} L ${gcx - g.slashSpread} ${gcy + g.slashHeight / 2}`,
  }
}

/** 字形外接盒（含线宽），用来判断有没有越界。 */
function glyphBox(g) {
  const [gcx, gcy] = g.center
  const half = g.stroke / 2
  return {
    left: gcx - g.spread - g.head - half,
    right: gcx + g.spread + g.head + half,
    top: gcy - Math.max(g.height, g.slashHeight) / 2 - half,
    bottom: gcy + Math.max(g.height, g.slashHeight) / 2 + half,
  }
}

/* ── 逐个文件验收 ── */
//
// marks: 'big' | 'small' —— 这个文件里的标记用哪套几何
// composer: true —— 这是给 Icon Composer 的层，背景不是 squircle 而是方形不透明

const FULL = ['background', 'sheet', 'mark']

const targets = [
  { rel: 'webnote-icon.svg', theme: 'light', layers: FULL, marks: 'big' },
  { rel: 'webnote-icon-dark.svg', theme: 'dark', layers: FULL, marks: 'big' },
  {
    rel: 'webnote-icon-small.svg',
    theme: 'light',
    layers: FULL,
    marks: 'small',
  },
  {
    rel: 'webnote-icon-small-dark.svg',
    theme: 'dark',
    layers: FULL,
    marks: 'small',
  },
  {
    rel: 'layers/background.svg',
    theme: 'light',
    layers: ['background'],
    marks: 'big',
    composer: true,
  },
  {
    rel: 'layers/sheet.svg',
    theme: 'light',
    layers: ['sheet'],
    marks: 'big',
    composer: true,
  },
  {
    rel: 'layers/mark.svg',
    theme: 'light',
    layers: ['mark'],
    marks: 'big',
    composer: true,
  },
  {
    rel: 'layers/background-dark.svg',
    theme: 'dark',
    layers: ['background'],
    marks: 'big',
    composer: true,
  },
  {
    rel: 'layers/sheet-dark.svg',
    theme: 'dark',
    layers: ['sheet'],
    marks: 'big',
    composer: true,
  },
  {
    rel: 'layers/mark-dark.svg',
    theme: 'dark',
    layers: ['mark'],
    marks: 'big',
    composer: true,
  },
]

for (const t of targets) {
  const { rel, theme, layers: expectedLayers, marks, composer } = t
  console.log(`\n── ${rel}`)
  const text = readFileSync(join(ICONS, rel), 'utf8')
  const tags = parseTags(text)

  // 1. 根节点与画布
  const svg = tags.find((tag) => tag.name === 'svg')
  check('根节点是 svg', !!svg)
  check(
    `viewBox = 0 0 ${CANVAS} ${CANVAS}`,
    svg?.attrs.viewBox === `0 0 ${CANVAS} ${CANVAS}`,
    svg?.attrs.viewBox,
  )

  // 2. 引用完整性
  const defined = new Set(tags.filter((tag) => tag.attrs?.id).map((tag) => tag.attrs.id))
  const used = [...text.matchAll(/url\(#([^)]+)\)/g)].map((m) => m[1])
  const dangling = [...new Set(used)].filter((u) => !defined.has(u))
  check(
    `url(#…) 引用全部有定义（${new Set(used).size} 个）`,
    dangling.length === 0,
    dangling.join(', '),
  )

  // 3. 分层齐全（id 形如 wn-background-background / wn-sheet-background）
  for (const layer of expectedLayers) {
    check(`含 ${layer} 层`, text.includes(`id="wn-${layer}`))
  }
  check(
    '不含不该有的层',
    ['background', 'sheet', 'mark']
      .filter((layer) => !expectedLayers.includes(layer))
      .every((layer) => !text.includes(`id="wn-${layer}-`)),
  )

  // 4. 背景
  const isComposerBg = composer && expectedLayers.includes('background')
  const bgPath = text.match(/<path d="(M [^"]+)" fill="url\(#wn-bg\)"/)?.[1]
  const bgRect = text.match(
    /<rect x="0" y="0" width="(\d+)" height="(\d+)" fill="url\(#wn-bg\)"\/>/,
  )

  if (isComposerBg) {
    // Icon Composer 要的是「正方形、全出血、不透明」的底：系统自己套圆角遮罩
    check(
      `背景是正方形不透明（${CANVAS}×${CANVAS}）`,
      bgRect !== null && Number(bgRect[1]) === CANVAS && Number(bgRect[2]) === CANVAS,
      bgRect?.[0],
    )
    check(
      '背景不带任何烘焙光效（光晕 / 暗角 / 镜面高光）',
      !text.includes('wn-glow') && !text.includes('wn-vignette') && !text.includes('wn-rim'),
    )
  } else if (expectedLayers.includes('background')) {
    check('没有不透明方块底（图标要自带圆角，不是方块）', bgRect === null && !svg?.attrs.style)
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
  const s = tokens.sheet
  const sheetPath = text.match(/<path d="(M [^"]+)" fill="url\(#wn-sheet\)"/)?.[1]
  if (expectedLayers.includes('sheet')) {
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
      // 主体占比：HIG 没给 App 图标的数值，只能借 macOS 文稿图标那两条标尺 ——
      // 中心图像占画布一半是下限那条线，背景图 80% 是上限，面板落在中间。
      const ratio = s.size / CANVAS
      check(
        `主体占画布宽 ${(ratio * 100).toFixed(1)}%，在 55%–80% 之间`,
        ratio >= 0.55 && ratio <= 0.8,
        '低于 55% 就是「贴纸浮在背景上」，高于 80% 会被圆角遮罩和系统光效吃掉边缘',
      )
      // 重心：面板是画面上最重的形，它偏了整枚图标就偏了
      check(
        '面板几何中心 = 画布中心',
        Math.abs((Math.min(...ys) + Math.max(...ys)) / 2 - HALF) < 0.5 &&
          Math.abs((Math.min(...xs) + Math.max(...xs)) / 2 - HALF) < 0.5,
        `中心 (${(Math.min(...xs) + Math.max(...xs)) / 2}, ${(Math.min(...ys) + Math.max(...ys)) / 2})`,
      )
    }
    const fcx = s.x + s.size - s.fold
    const fx = s.x + s.size
    // 折角不是盖在圆角矩形上的一张三角形贴纸：面板自己必须沿折缝断开。
    // 只要面板右上还留着那段 A 圆弧，折缝外侧就会多出一个圆角（曾鼓出 46.5px）。
    check(
      `折角处不画圆角（面板断口 ${fcx},${s.y} → ${fx},${s.y + s.fold}）`,
      sheetPath.includes(`H ${fcx} L ${fx} ${s.y + s.fold}`) &&
        !sheetPath.includes(`A ${s.radius} ${s.radius} 0 0 1 ${fx} ${s.y + s.radius}`),
      '折缝外侧不应残留面板圆角',
    )
    check(
      `折角 ${s.fold} ≥ 面板圆角 ${s.radius}`,
      s.fold >= s.radius,
      '否则折缝起点落进圆角弧里，面板断口接不上折角三角形',
    )
    check(
      '面板层按断口裁剪（折缝处的亮边不溢到背景）',
      text.includes('clip-path="url(#wn-sheetClip)"'),
    )
    check(
      '折角三角与折缝端点正确',
      text.includes(`M ${fcx} ${s.y} L ${fx} ${s.y + s.fold} L ${fcx} ${s.y + s.fold} Z`) &&
        text.includes(`M ${fcx} ${s.y} L ${fx} ${s.y + s.fold}" fill="none"`),
    )
    // Icon Composer 会自己给前景层加镜面高光，烘焙的描边留着就是双层
    if (composer) {
      check('面板层不带高光描边（系统会自己加）', !text.includes('wn-sheetRim'))
    } else {
      check('面板层带上缘接光描边', text.includes('wn-sheetRim'))
      check(
        '上缘接光在折缝处收口（不留半截高光悬在断口外）',
        text.includes(`M ${s.x + s.radius} ${s.y} H ${fcx}`),
      )
    }
  }

  // 6. 字形：三笔端点
  const g = marks === 'small' ? tokens.small.glyph : tokens.glyph
  if (expectedLayers.includes('mark')) {
    const paths = glyphPaths(g)
    check('尖括号两笔端点正确', text.includes(paths.open) && text.includes(paths.close))
    check('斜线端点正确', text.includes(paths.slash))
    check(`字形线宽 ${g.stroke}`, text.includes(`stroke-width="${g.stroke}"`))

    const box = glyphBox(g)
    check(
      '字形在面板内（四周各留 ≥ 40px）',
      box.left > s.x + 40 &&
        box.right < s.x + s.size - 40 &&
        box.top > s.y + 40 &&
        box.bottom < s.y + s.size - 40,
      `左 ${(box.left - s.x).toFixed(0)} / 右 ${(s.x + s.size - box.right).toFixed(0)} / 上 ${(box.top - s.y).toFixed(0)} / 下 ${(s.y + s.size - box.bottom).toFixed(0)}`,
    )
    // 折角是右上角那块三角形，绕开它有两条路：整个字形在它左侧，或者整个在它下方
    const foldLeft = s.x + s.size - s.fold
    const clearRight = box.right < foldLeft
    const clearBelow = box.top > s.y + s.fold
    check(
      '字形不碰折角',
      clearRight || clearBelow,
      `字形右缘 ${box.right.toFixed(0)} vs 折角左缘 ${foldLeft}；字形上缘 ${box.top.toFixed(0)} vs 折角下缘 ${s.y + s.fold}`,
    )

    // 正文行：只有大母版有。小尺寸母版把它们换成更大的字形，这是 HIG 说的
    // 「考虑降低小尺寸版本的复杂性」，不是漏画。
    const barCount = (text.match(/<rect /g) ?? []).length
    if (marks === 'small') {
      check('小尺寸母版没有正文行', barCount === 0, `找到 ${barCount} 个 rect`)
    } else {
      check(`正文行 ${tokens.bars.rows.length} 根`, barCount === tokens.bars.rows.length)
      for (const [i, row] of tokens.bars.rows.entries()) {
        const x = (CANVAS - row.width) / 2
        check(`正文行 ${i + 1} 居中`, text.includes(`x="${x}" y="${row.y}" width="${row.width}"`))
        check(
          `正文行 ${i + 1} 在面板内且不与字形重叠`,
          row.y > box.bottom + 20 && row.y + tokens.bars.height < s.y + s.size - 20,
        )
      }
    }

    // 可读性门槛：小尺寸母版服务到 32px，完整版从阈值往上一档（64px）
    if (marks === 'small') {
      const px = (g.stroke / CANVAS) * 32
      check(`32px 下线宽 ≥ ${LEGIBLE_AT_32}px`, px >= LEGIBLE_AT_32, `${px.toFixed(2)}px`)
      check(`小尺寸母版只用于 ≤${SMALL_MAX}px`, 32 <= SMALL_MAX)
    } else {
      const px = (g.stroke / CANVAS) * 64
      check(`64px 下线宽 ≥ ${LEGIBLE_AT_64}px`, px >= LEGIBLE_AT_64, `${px.toFixed(2)}px`)
    }
  }

  // 7. 深/浅外观确实用了不同的配色
  if (expectedLayers.includes('background')) {
    const grad = text.match(/<linearGradient id="wn-bg"[\s\S]*?<\/linearGradient>/)?.[0] ?? ''
    const hex = (rgb) => `rgb(${rgb[0]} ${rgb[1]} ${rgb[2]})`
    check(
      '背景渐变的色标与 tokens.themes 一致',
      tokens.themes[theme].bg.every(([, rgb]) => grad.includes(hex(rgb))),
      grad.match(/stop-color="[^"]+"/g)?.join(' '),
    )
  }
}

console.log(failures === 0 ? '\n全部通过。' : `\n${failures} 项未通过。`)
process.exit(failures === 0 ? 0 : 1)

import type { ClassValue } from "clsx"
import { clsx } from "clsx"
import { extendTailwindMerge } from "tailwind-merge"

/**
 * 自定义字号档位得登记给 tailwind-merge（档位定义在 `style.css` 的 `--text-*`）。
 *
 * 它只认得 Tailwind 内置的字号刻度，看到 `text-30` 会归进**文字颜色**组 —— 于是与
 * `text-foreground/90` 同组互斥，合并时把字号悄悄吃掉。表现是标题掉回正文大小，
 * 没有任何报错。旧的 `text-[30px]` 因为有单位被认成字号，换成档位名之后才踩到这坑。
 */
const twMerge = extendTailwindMerge({
  extend: {
    classGroups: {
      "font-size": [{ text: ["11", "12", "13", "14", "16", "18", "22", "26", "30"] }],
    },
  },
})

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

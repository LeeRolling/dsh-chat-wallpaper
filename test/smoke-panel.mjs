// 设置面板的宿主侧逻辑测试：alpha 解析 + 图片清单
import fs from 'node:fs'
import { join } from 'node:path'

const SRC = new URL('../lib/index.js', import.meta.url)
const m = await import(SRC)

let fails = 0
const ok = (cond, label, extra) => {
  console.log(`  ${cond ? '✓' : '✗'} ${label}${extra ? '  ' + extra : ''}`)
  if (!cond) fails++
}

console.log('=== alphaOf：从颜色串取 alpha（滑块要用）===')
console.log('   第一版用宽松正则把 rgb(255,255,255) 解析成 alpha=255（抓到蓝通道）—— 这里就是防它回归\n')
const cases = [
  ['rgba(8,10,16,.50)', 0.5],
  ['rgba(8,10,16,0.50)', 0.5],
  ['rgba(6,8,14,.38)', 0.38],
  ['rgba(22,24,32,0.74)', 0.74],
  ['rgba(253,250,254,.80)', 0.8],
  ['rgb(255,255,255)', 1],            // ← 没有 alpha，必须回落 1（不是 255！）
  ['rgb(8,10,16)', 1],
  ['rgba(8 10 16 / 0.5)', 0.5],
  ['rgba(8 10 16 / 50%)', 0.5],
  ['rgba(8,10,16,1)', 1],
  ['rgba(8,10,16,0)', 0],
  ['garbage', 1],
  ['', 1],
  [null, 1],
  [undefined, 1],
  ['rgba(1,2,3,7)', 1],               // 越界 → 回落 1
]
for (const [input, want] of cases) {
  const got = m.__alphaOf(input)
  ok(got === want, `${JSON.stringify(input)} → ${want}`, got === want ? '' : `实际 ${got}`)
}

console.log('\n=== 丢图目录 + 图片清单 ===')
const dir = m.__imageDir()
console.log('  丢图目录:', dir)
ok(typeof dir === 'string' && dir.includes('.dsh'), '目录在 $DSH_HOME 下')
console.log('  当前目录里的图:', JSON.stringify(m.__listImages()))
console.log('  （现在没图是正常的 —— 用户丢进去就会出现在设置面板里）')

console.log(`\n${fails === 0 ? '✓ 全部通过' : `✗ ${fails} 项失败`}\n`)
process.exit(fails === 0 ? 0 : 1)

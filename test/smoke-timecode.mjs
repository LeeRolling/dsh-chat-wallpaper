// 时间码解析测试 —— 这个数学错了，循环点就会落在错误的帧上
import fs from 'node:fs'

const SRC = new URL('../lib/index.js', import.meta.url)
const mod = await import(SRC)

let fails = 0
const ok = (cond, label, extra) => {
  console.log(`  ${cond ? '✓' : '✗'} ${label}${extra ? '  ' + extra : ''}`)
  if (!cond) fails++
}

const near = (a, b, eps = 1e-9) => typeof a === 'number' && Math.abs(a - b) < eps

console.log('=== parseTimecode ===')
console.log('  用户给的是 DaVinci 时间码，我们要的是秒 —— 这一段算错，循环点就错了\n')

const cases = [
  ['00:00:05:23', 24, 5 + 23 / 24, '5 秒 23 帧 @24fps'],
  ['00:00:07:00', 24, 7, '整秒'],
  ['0:00:01:12', 24, 1.5, '1 秒 12 帧 = 半秒'],
  ['00:00:05:23', 30, 5 + 23 / 30, '同样时间码但 30fps'],
  ['00:00:00:00', 24, 0, '零'],
  ['01:00:00:00', 24, 3600, '一小时'],
  ['00:01:30:12', 24, 90.5, '分秒帧混合'],
  [5.958, 24, 5.958, '数字直接当秒'],
  ['5.958', 24, 5.958, '数字字符串也当秒'],
  ['', 24, null, '空字符串 → null（= 不启用）'],
  ['   ', 24, null, '只有空格 → null'],
  ['garbage', 24, null, '垃圾值 → null'],
  ['00:00:5', 24, null, '格式不全 → null'],
  [null, 24, null, 'null → null'],
  [undefined, 24, null, 'undefined → null'],
  [NaN, 24, null, 'NaN → null'],
]
for (const [input, fps, want, label] of cases) {
  const got = mod.parseTimecode(input, fps)
  const good = want === null ? got === null : near(got, want)
  ok(good, `${JSON.stringify(input)} @${fps}fps → ${want === null ? 'null' : want.toFixed(4) + 's'}`, good ? `(${label})` : `实际 ${got}`)
}

console.log('\n=== 交叉验证：和 MP4 里的真实时长对一下 ===')
console.log('  视频 169 帧 @24fps → 时长 =', (169 / 24).toFixed(6), 's')
console.log('  loopStart 00:00:05:23 →', mod.parseTimecode('00:00:05:23', 24).toFixed(6), 's')
const tail = 169 / 24 - mod.parseTimecode('00:00:05:23', 24)
console.log('  剩余尾巴 =', tail.toFixed(6), 's')
ok(near(tail, 1.0834, 0.001), '尾巴长度 ≈ 1.0834s，与用户导出的 loop 文件（1.083s）吻合', tail.toFixed(4) + 's')

console.log(`\n${fails === 0 ? '✓ 全部通过' : `✗ ${fails} 项失败`}\n`)
process.exit(fails === 0 ? 0 : 1)

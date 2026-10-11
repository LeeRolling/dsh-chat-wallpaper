import { fileURLToPath } from 'node:url'
// 造一个"故意没修"的副本来证明回归测试真的抓得住那个 bug
//
// 去掉 teardown() 里的 `current = null` 和 observer.disconnect()（也就是 bug 原状），
// 其余一模一样。跑 smoke-once.mjs 指向它 → 应该在「场景 E 复活」那里红。
import fs from 'node:fs'

const SRC = fileURLToPath(new URL('../lib/client.js', import.meta.url))
const OUT = fileURLToPath(new URL('./client.nofix.js', import.meta.url))

let code = fs.readFileSync(SRC, 'utf8')

const FIXED = `    function teardown() {
      current = null
      if (observer) {
        try { observer.disconnect() } catch (e) { /* 忽略 */ }
        observer = null
      }
      removeCss()`

const BROKEN = `    function teardown() {
      removeCss()`

if (!code.includes(FIXED)) {
  console.error('✗ 锚点没找到 —— client.js 的 teardown 结构变了，先看一眼再改这个脚本')
  process.exit(1)
}
code = code.replace(FIXED, BROKEN)
fs.writeFileSync(OUT, code, 'utf8')
console.log('ok 已生成未修复副本:', OUT)
console.log('   区别 = 去掉了 teardown() 里的 current=null + observer.disconnect()')

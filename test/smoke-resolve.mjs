import fs from 'node:fs'
import { existsSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { homedir } from 'node:os'
const HOME = process.env.DSH_HOME ?? join(homedir(), '.dsh')
console.log('  DSH_HOME =', HOME)
console.log('  配置存在 :', existsSync(join(HOME, 'chat-wallpaper.json')))
const dirs = [join(HOME, 'boot-animation', 'videos'), join(HOME, 'boot-animation')]
for (const d of dirs) {
  let files = []
  try { files = readdirSync(d).filter(f => /\.(mp4|webm|mov|m4v)$/i.test(f)) } catch {}
  console.log(`  片库 ${d.replace(/\\/g,'/')}  →  ${files.length ? files.join(', ') : '(目录不存在或没有视频)'}`)
}
// 兜底素材
const profiles = join(HOME, 'profiles')
for (const p of readdirSync(profiles)) {
  const f = join(profiles, p, 'node_modules', 'dsh-boot-animation', 'media', 'deepseek-cyberpunk-intro.mp4')
  if (existsSync(f)) console.log('  兜底素材 :', f.replace(/\\/g,'/'), `(${(statSync(f).size/1048576).toFixed(2)} MB)`)
}
console.log('')
console.log('  → 三级回落：配置 video → 用户片库 → 内置 cyberpunk')
console.log('    现在会解析到【内置 cyberpunk】；你把超分版丢进 videos/ 后会自动切到它，不用改配置')

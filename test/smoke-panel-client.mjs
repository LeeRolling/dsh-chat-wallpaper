/**
 * 设置页（settings.section）客户端测试
 *
 * 覆盖：
 *   A. 注册：bundle 加载 / inject slots / settings.section 的 id、label、order
 *   B. 挂载：设置槽位给的宿主要能挂出 #dsh-cw-panel（不再有左下角浮钮）
 *   C. 数据：/images → 当前背景、缩略图、纱、横幅、开场模式
 *   D. 两层 CSS 独立：壁纸收场不会带走设置页（panel.css 还在、DOM 还在）
 *   E. 纱的浓度：0 ~ 100%，80% 观感不变，100% 两个渐变停靠点全不透明
 *   F. 重播开场：先关设置页再重播；只读设置页不会泄漏 DOM
 */
import { fileURLToPath } from 'node:url'
import fs from 'node:fs'
import vm from 'node:vm'

const FILE = process.argv[2] || fileURLToPath(new URL('../lib/client.js', import.meta.url))
const code = fs.readFileSync(FILE, 'utf8')

let fails = 0
const ok = (cond, label, extra) => {
  console.log(`  ${cond ? '✓' : '✗'} ${label}${extra ? '  ' + extra : ''}`)
  if (!cond) fails++
}

/* ── 迷你 DOM（够 panel + 壁纸层用）────────────────────────────────────── */
function splitClasses(el) {
  return String(el.className || '').split(/\s+/).filter(Boolean)
}

class Element {
  constructor(tag) {
    this.tagName = String(tag).toUpperCase()
    this.children = []
    this.parentNode = null
    this.className = ''
    this.id = ''
    this._text = ''
    this.dataset = {}
    this.attributes = {}
    this.handlers = {}
    this.style = { setProperty() {}, removeProperty() {} }
    this.name = ''
    this.value = ''
    this.checked = false
    this.min = ''
    this.max = ''
    this.step = ''
    this.title = ''
    this.type = ''
    this.src = ''
    this.alt = ''
    /* <video> 需要的能力 */
    this.currentTime = 0
    this.duration = 7.0417
    this.paused = true
    this.readyState = 4
    this.playbackRate = 1
    this.muted = false
    this.loop = false
  }
  get firstChild() { return this.children[0] ?? null }
  get classList() {
    const el = this
    return {
      add(...cs) { el.className = [...new Set([...splitClasses(el), ...cs])].join(' ') },
      remove(...cs) { el.className = splitClasses(el).filter((c) => !cs.includes(c)).join(' ') },
      contains(c) { return splitClasses(el).includes(c) },
      toggle(c) { if (this.contains(c)) { this.remove(c); return false } this.add(c); return true },
    }
  }
  get textContent() {
    if (this.children.length > 0) return this.children.map((c) => c.textContent).join('')
    return this._text
  }
  set textContent(v) {
    this._text = String(v)
    for (const c of this.children) c.parentNode = null
    this.children = []
  }
  play() { this.paused = false; return Promise.resolve() }
  pause() { this.paused = true }
  load() {}
  addEventListener(type, fn) { (this.handlers[type] ||= []).push(fn) }
  fire(type) { for (const fn of this.handlers[type] || []) fn({ type, target: this }) }
  setAttribute(name, value) { this.attributes[name] = String(value) }
  getAttribute(name) { return this.attributes[name] ?? null }
  removeAttribute(name) { delete this.attributes[name] }
  appendChild(child) {
    if (child.parentNode) child.parentNode.removeChild(child)
    child.parentNode = this
    this.children.push(child)
    return child
  }
  insertBefore(child, ref) {
    if (child.parentNode) child.parentNode.removeChild(child)
    child.parentNode = this
    const i = ref === null || ref === undefined ? -1 : this.children.indexOf(ref)
    if (i < 0) this.children.push(child)
    else this.children.splice(i, 0, child)
    return child
  }
  removeChild(child) {
    const i = this.children.indexOf(child)
    if (i >= 0) this.children.splice(i, 1)
    child.parentNode = null
    return child
  }
  remove() { if (this.parentNode) this.parentNode.removeChild(this) }
  querySelector(sel) { return this.querySelectorAll(sel)[0] ?? null }
  querySelectorAll(sel) { return findAll(this, sel) }
}

function matchesNode(node, sel) {
  const s = String(sel).trim()
  if (s.startsWith('#')) return node.id === s.slice(1)
  if (s.startsWith('.')) return splitClasses(node).includes(s.slice(1))
  const attr = /^([a-zA-Z][\w-]*)?\[([\w-]+)="([^"]*)"\]$/.exec(s)
  if (attr) {
    if (attr[1] && node.tagName !== attr[1].toUpperCase()) return false
    const key = attr[2]
    const value = attr[3]
    if (key === 'data-plugin-css') return node.dataset.pluginCss === value
    return node.getAttribute(key) === value || node[key] === value
  }
  return node.tagName === s.toUpperCase()
}
function findAll(root, sel) {
  const out = []
  const walk = (n) => { for (const c of n.children) { if (matchesNode(c, sel)) out.push(c); walk(c) } }
  walk(root)
  return out
}
function mkDoc() {
  const head = new Element('head')
  const body = new Element('body')
  const html = new Element('html')
  const doc = {
    readyState: 'loading',
    documentElement: html,
    head,
    body,
    activeElement: null,
    createElement(t) { return new Element(t) },
    addEventListener() {},
    getElementById(id) { return findAll(body, '#' + id)[0] ?? null },
    querySelector(sel) {
      const m = /data-plugin-css="([^"]+)"/.exec(sel)
      if (m) return head.children.find((t) => t.dataset.pluginCss === m[1]) ?? null
      return head.querySelector(sel) ?? body.querySelector(sel)
    },
  }
  return doc
}

/* ── 迷你 React（只提供组件用到的 hook）──────────────────────────────── */
const React = {
  useRef(init) { return { current: init } },
  useEffect(fn) { effects.push(fn) },
  useState(init) { return [init, () => {}] },
}
const effects = []
const jsx = (type, props) => ({ type, props: props ?? {} })

/* ── 载入 bundle ─────────────────────────────────────────────────────── */
const doc = mkDoc()
const fetched = []
let captured = null
const sandbox = {
  window: {
    __ModuleLoader__: { load(o) { captured = o } },
    innerWidth: 1280,
    sessionStorage: { store: {}, getItem(k) { return this.store[k] ?? null }, setItem(k, v) { this.store[k] = String(v) }, removeItem(k) { delete this.store[k] } },
    addEventListener() {}, removeEventListener() {},
  },
  document: doc,
  console: { log() {}, warn() {}, error() {} },
  fetch(url, opts) {
    fetched.push({ url: String(url), opts })
    const canned = (body) => Promise.resolve({ json: () => Promise.resolve(body) })
    if (String(url).includes('/images')) {
      return canned({
        ok: true, dropDir: 'C:/Users/example/.dsh/chat-wallpaper', dropDirExists: true,
        mode: 'once', placement: 'front',
        current: 'C:/Users/example/.dsh/chat-wallpaper/我的背景.jpg',
        images: [
          { name: '我的背景.jpg', url: '/chat-wallpaper/image?name=%E6%88%91', sizeKB: 820, mtime: '2026-10-11 20:00:00' },
          { name: 'cyberpunk.png', url: '/chat-wallpaper/image?name=cyberpunk.png', sizeKB: 1400, mtime: '2026-10-11 19:00:00' },
        ],
        veil: { light: 0.8, dark: 0.5 },
        banner: '人类与AI的日常',
        bannerOpacity: 0.12,
      })
    }
    if (String(url).includes('/config')) {
      return canned({ ok: true, source: 'your-library', file: 'x.mp4', loopStartSec: null, loopEndSec: null, imageOk: true, image: 'y.jpg', config: { mode: 'once', veilLightA: 'rgba(253,250,254,.8)', veilDarkA: 'rgba(8,10,16,.5)' } })
    }
    if (String(url).includes('/set')) return canned({ ok: true, applied: {} })
    return canned({ ok: true })
  },
  setTimeout: () => 0, clearTimeout() {}, setInterval: () => 0, clearInterval() {},
  requestAnimationFrame: () => 1, cancelAnimationFrame() {},
  MutationObserver: function () { this.observe = () => {}; this.disconnect = () => {} },
  getComputedStyle: () => ({ backgroundColor: 'rgb(20, 22, 28)' }), // 深色主题
}
sandbox.globalThis = sandbox
vm.createContext(sandbox)
vm.runInContext(code, sandbox, { filename: 'client.js' })

const mod = captured.factory((spec) => {
  if (spec === 'react') return React
  if (spec === 'react/jsx-runtime') return { jsx }
  throw new Error('unexpected require: ' + spec)
})
const flush = () => new Promise((r) => setImmediate(r))
const cssIds = () => doc.head.children.map((t) => t.dataset.pluginCss)

/* ── A. 注册 ─────────────────────────────────────────────────────────── */
console.log('=== A. settings.section 注册 ===')
ok(captured && captured.id === 'dsh-chat-wallpaper', 'bundle 注册 id = dsh-chat-wallpaper', captured && captured.id)
ok(Array.isArray(mod.inject) && mod.inject.includes('slots'), "exports.inject 含 'slots'", JSON.stringify(mod.inject))

const registrations = []
const fakeCtx = {
  slots: {
    inject(key, cb) { ok(key === 'settings.section', 'slots.inject 的是 settings.section', key); registrations.push(cb()) },
    register(options, Component) { registrations.push({ options, Component }); return () => {} },
  },
}
mod.apply(fakeCtx)
const entry = registrations.find((r) => r && r.options && r.Component)
ok(!!entry, '注册了设置页组件')
ok(entry?.options.name === 'settings.section', '槽位 name = settings.section')
ok(entry?.options.id === 'chat-wallpaper', '槽位 id = chat-wallpaper', entry?.options.id)
ok(entry?.options.label === '聊天背景', '导航名 = 聊天背景', entry?.options.label)
ok(typeof entry?.options.order === 'number', '槽位 order 是数字', entry?.options.order)

/* ── B. 挂载 ─────────────────────────────────────────────────────────── */
console.log('\n=== B. 挂到设置槽位给的宿主（不再有左下角浮钮）===')
let closeCalls = 0
const close = () => { closeCalls += 1 }
const element = entry.Component({ close })
const host = new Element('div')
doc.body.appendChild(host)
element.props.ref.current = host
const mount = effects.shift()
ok(typeof mount === 'function', '组件用 useEffect 管理挂载')
const unmount = mount()

const panel = host.children[0]
ok(!!panel && panel.id === 'dsh-cw-panel', '创建了 #dsh-cw-panel 并挂进宿主', panel && panel.id)
ok(findAll(host, '.cw-fab').length === 0, '没有左下角浮钮（.cw-fab）')
ok(findAll(host, '.cw-open').length === 0, '没有旧弹层开合类（.cw-open）')
ok(panel.textContent.includes('聊天背景'), '有页面标题「聊天背景」')
ok(findAll(panel, '.cw-sec').length === 6, '6 个分节', findAll(panel, '.cw-sec').length)
ok(cssIds().includes('dsh-chat-wallpaper/panel.css'), '设置页 CSS 已注入')
ok(!cssIds().includes('dsh-chat-wallpaper/main.css'), '此时还没注壁纸 CSS（只有设置页）')

/* ── C. 数据回填 ─────────────────────────────────────────────────────── */
console.log('\n=== C. /images 数据回填 ===')
await flush()
await flush()
ok(fetched.some((f) => f.url.includes('/chat-wallpaper/images')), '拉取了 /chat-wallpaper/images')
const thumbs = findAll(panel, '.cw-thumb')
ok(thumbs.length === 2, '★ 列出 2 张图', `实际 ${thumbs.length}`)
ok(thumbs.filter((t) => splitClasses(t).includes('cw-sel')).length === 1, '★ 当前生效的那张有选中标记（.cw-sel）')
ok(panel.querySelector('.cw-cur').textContent.includes('我的背景.jpg'), '显示当前背景文件名')
ok(panel.querySelector('.cw-veil-label').textContent.includes('深色'), '纱标签跟着当前主题（深色）')
ok(panel.querySelector('.cw-veil-val').textContent === '50%', '★ 深色主题下纱滑块显示 50%', panel.querySelector('.cw-veil-val').textContent)
const radios = panel.querySelectorAll('input[name="cw-mode"]')
ok(radios.length === 2, '模式单选有 2 个')
ok(radios.some((r) => r.value === 'once/front' && r.checked), '★ 当前是「全屏开场」→ 对应单选被勾上')
ok(panel.querySelector('.cw-banner-val').textContent === '12%', '横幅浓度回填 12%')
ok(panel.querySelector('.cw-text').value === '人类与AI的日常', '横幅文字回填')

/* ── D. 设置页 CSS 与壁纸 CSS 独立 ──────────────────────────────────── */
console.log('\n=== D. 壁纸收场不会带走设置页 ===')
const cfg = {
  mode: 'once', placement: 'front', objectFit: 'cover', opacity: 1, playbackRate: 1,
  veilDarkA: 'rgba(8,10,16,.5)', veilDarkB: 'rgba(6,8,14,.38)',
  veilLightA: 'rgba(253,250,254,.8)', veilLightB: 'rgba(250,247,253,.68)',
  sidebarDark: 'rgba(22,24,32,.74)', sidebarLight: 'rgba(255,255,255,.78)',
  fallbackDark: '#0b0d12', fallbackLight: '#f7f1f8',
}
mod.__applyNow(cfg)
ok(cssIds().includes('dsh-chat-wallpaper/main.css'), '壁纸 CSS 已注入')
mod.__teardown()
ok(!cssIds().includes('dsh-chat-wallpaper/main.css'), '壁纸收场 → 壁纸 CSS 被撤')
ok(cssIds().includes('dsh-chat-wallpaper/panel.css'), '★ 设置页 CSS 还在')
ok(host.children.includes(panel), '★ 设置页 DOM 也还在')

/* ── E. 纱的浓度 0 ~ 100% ────────────────────────────────────────────── */
console.log('\n=== E. 纱的浓度：上限 100%，100% = 完全盖住 ===')
const veilSlider = panel.querySelector('.cw-veil')
ok(veilSlider.min === '0', '滑块 min = 0')
ok(veilSlider.max === '100', '★ 滑块 max = 100（原来 80）', veilSlider.max)
ok(veilSlider.value === '50', '滑块回填当前值 50')
fetched.length = 0
veilSlider.value = '80'
veilSlider.fire('change')
await flush()
const body80 = String((fetched.find((f) => f.url.includes('/set')) || {}).opts?.body ?? '')
ok(body80.includes('rgba(6,8,14,0.61)'), '80% 时第二停靠点仍是 0.61（旧观感不变）', body80)
fetched.length = 0
veilSlider.value = '100'
veilSlider.fire('change')
await flush()
const body100 = String((fetched.find((f) => f.url.includes('/set')) || {}).opts?.body ?? '')
ok(body100.includes('rgba(8,10,16,1)') && body100.includes('rgba(6,8,14,1)'), '★ 100% 时两个停靠点 alpha 都是 1', body100)

/* ── F. 重播 / 卸载 ─────────────────────────────────────────────────── */
console.log('\n=== F. 重播开场 & 设置页卸载 ===')
const replayBtn = findAll(panel, '.cw-act').find((b) => String(b.textContent).includes('重播开场'))
ok(!!replayBtn, '★ 设置页里有「🔁 重播开场」按钮')
sandbox.__overlay = null
const cfg2 = { ...cfg }
mod.__applyNow(cfg2)
mod.__beginIntro(cfg2, '测试第一轮', false)
ok(!!doc.getElementById('dsh-chat-wallpaper'), '第一轮：开场已挂上')
mod.__teardown()
ok(!doc.getElementById('dsh-chat-wallpaper'), '模拟「已经收场了」')
replayBtn.fire('click')
ok(closeCalls === 1, '★ 点重播时先调用设置页的 close()')
ok(!!doc.getElementById('dsh-chat-wallpaper'), '★★ 点一下 → 开场立刻重播（不用重启 DSH）')

unmount()
ok(host.children.length === 0, '设置页卸载后 DOM 从宿主移除')
// 重新打开设置：同一个组件函数再渲染一次，副作用应把同一份 DOM 接回新宿主
const element2 = entry.Component({ close })
const host2 = new Element('div')
doc.body.appendChild(host2)
element2.props.ref.current = host2
const mount2 = effects.shift()
ok(typeof mount2 === 'function', '重新打开设置时会再次挂载')
mount2()
ok(host2.children.length === 1 && host2.children[0].id === 'dsh-cw-panel', '重新打开设置 → 设置页重新挂上')
ok(host2.children[0] === panel, '复用同一份 DOM（不重建）')

/* ── 汇总 ───────────────────────────────────────────────────────────── */
console.log(`\n${fails === 0 ? '✓ 全部通过' : `✗ ${fails} 项失败`}\n`)
process.exit(fails === 0 ? 0 : 1)

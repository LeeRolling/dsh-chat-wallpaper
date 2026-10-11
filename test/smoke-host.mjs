// 宿主半边的契约测试：Cordis 只认 default 导出，且必须是 { name, inject, apply }
const m = await import(new URL('../lib/index.js', import.meta.url))
const d = m.default
console.log('  name   :', d.name)
console.log('  inject :', JSON.stringify(d.inject))
console.log('  apply  :', typeof d.apply)
console.log(d.name === 'dsh-chat-wallpaper' && Array.isArray(d.inject) && typeof d.apply === 'function' ? '  ✓ 契约正确' : '  ✗ 契约不对')

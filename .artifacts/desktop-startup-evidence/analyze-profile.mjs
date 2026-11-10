import { readFileSync } from 'node:fs'

const file = process.argv[2]
const profile = JSON.parse(readFileSync(file, 'utf8'))
const nodes = new Map(profile.nodes.map(n => [n.id, n]))
const parent = new Map()
for (const node of profile.nodes) for (const child of node.children ?? []) parent.set(child, node.id)

const self = new Map()
let total = 0
for (let i = 0; i < profile.samples.length; i++) {
  const id = profile.samples[i]
  const dt = profile.timeDeltas[i] ?? 0
  self.set(id, (self.get(id) ?? 0) + dt)
  total += dt
}

function urlOf(node) {
  const cf = node.callFrame
  return cf.url || '(native)'
}
function packageOf(url) {
  const m = url.match(/app\.asar\/dsh\/node_modules\/(@[^/]+\/[^/]+|[^/]+)\//)
  if (m) return m[1]
  const m2 = url.match(/app\.asar\/dsh\/([^/]+)\//)
  if (m2) return `dsh/${m2[1]}`
  if (url.includes('app.asar/dsh/lib')) return 'dsh/lib(bundled)'
  if (url.startsWith('node:')) return 'node-internal'
  return url.slice(0, 80)
}

const rows = [...self.entries()].map(([id, us]) => ({ node: nodes.get(id), us })).filter(r => r.node)
const byPkg = new Map()
const byUrl = new Map()
const byFn = new Map()
for (const { node, us } of rows) {
  const url = urlOf(node)
  const pkg = packageOf(url)
  const fn = `${node.callFrame.functionName || '(anonymous)'} @ ${url.split('/').slice(-2).join('/')}:${node.callFrame.lineNumber}`
  byPkg.set(pkg, (byPkg.get(pkg) ?? 0) + us)
  byUrl.set(url, (byUrl.get(url) ?? 0) + us)
  byFn.set(fn, (byFn.get(fn) ?? 0) + us)
}

const top = (map, n) => [...map.entries()].sort((a, b) => b[1] - a[1]).slice(0, n)
console.log(`total sampled: ${(total / 1000).toFixed(0)}ms`)
console.log('\n== by package ==')
for (const [k, v] of top(byPkg, 25)) console.log(`${(v / 1000).toFixed(0).padStart(7)}ms  ${k}`)
console.log('\n== by file ==')
for (const [k, v] of top(byUrl, 20)) console.log(`${(v / 1000).toFixed(0).padStart(7)}ms  ${k}`)
console.log('\n== by function (self) ==')
for (const [k, v] of top(byFn, 30)) console.log(`${(v / 1000).toFixed(0).padStart(7)}ms  ${k}`)

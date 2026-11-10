/**
 * Measure the installed Desktop Host from spawn to ready.
 * Usage: node measure-host.mjs [profileDir]
 * Environment: DSH_INSTALL (default M:\deepseek\harness)
 */
import { spawn } from 'node:child_process'

const install = process.env.DSH_INSTALL ?? 'M:\\deepseek\\harness'
const runtimeDir = `${install}\\resources\\app.asar\\dsh`
const projectDir = process.argv[2] ?? process.env.PROJECT_DIR ?? 'C:\\Users\\lucky\\.dsh\\profiles\\desktop'
const primaryRuntime = `${install}\\resources\\runtime\\primary-runtime`
const pnpm = `${primaryRuntime}\\dependencies\\pnpm\\bin\\pnpm.mjs`
const nodeBin = `${install}\\resources\\runtime\\bin`
const entry = `${runtimeDir}\\node_modules\\@deepseek-ai\\dsh-desktop-host\\lib\\index.js`
const electron = `${install}\\DeepSeek Harness.exe`

const redact = line => line.replace(/token=[^&\s]+/gu, 'token=<redacted>')
const t0 = performance.now()
const mark = label => console.log(`${(performance.now() - t0).toFixed(0).padStart(6)}ms  ${label}`)

const child = spawn(electron, [
  '--expose-internals',
  entry,
  runtimeDir,
  projectDir,
  primaryRuntime,
  pnpm,
  nodeBin,
], {
  cwd: projectDir,
  env: { ...process.env, ELECTRON_RUN_AS_NODE: '1', DSH_CLIENT_VERSION: '0.2.2-rc.1' },
  stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
})

mark('host spawned')
let out = ''
let err = ''
child.stdout.setEncoding('utf8')
child.stderr.setEncoding('utf8')
child.stdout.on('data', (chunk) => {
  out += chunk
  for (const line of chunk.split('\n')) if (line.trim() !== '') console.log(`${(performance.now() - t0).toFixed(0).padStart(6)}ms  OUT ${redact(line).slice(0, 200)}`)
})
child.stderr.on('data', (chunk) => {
  err += chunk
  for (const line of chunk.split('\n')) if (line.trim() !== '') console.log(`${(performance.now() - t0).toFixed(0).padStart(6)}ms  ERR ${redact(line).slice(0, 200)}`)
})
child.on('message', (message) => {
  mark(`IPC ${message?.type}`)
  if (message?.type === 'ready') {
    mark('ready')
    setTimeout(() => { child.send({ type: 'shutdown' }) }, 50)
  }
})
child.on('close', (code) => {
  mark(`closed ${code}`)
  process.exit(0)
})
setTimeout(() => {
  console.log('timeout; killing host')
  child.kill('SIGKILL')
  process.exit(1)
}, 120000)

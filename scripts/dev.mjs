import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import net from 'node:net'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('../', import.meta.url))
const mode = process.argv[2] || 'rag'
if (!['rag', 'proxy', 'all'].includes(mode)) throw new Error('Use rag, proxy or all')
const python = path.join(root, 'llmchat_Rag/.venv', process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python')
const services = [
  { name: 'frontend', port: 3098, cwd: 'llm-chat', command: process.execPath,
    args: ['node_modules/vite/bin/vite.js', '--host', '127.0.0.1', '--strictPort'] },
  ...(mode !== 'proxy' ? [{ name: 'RAG', port: 14052, cwd: 'llmchat_Rag', command: python, args: ['server.py'] }] : []),
  ...(mode !== 'rag' ? [{ name: 'proxy', port: 11434, cwd: 'api-proxy', command: process.execPath, args: ['src/index.js'] }] : []),
]
for (const service of services) {
  if (!existsSync(service.command) || !existsSync(path.join(root, service.cwd, service.args[0]))) {
    throw new Error(`${service.name}: install dependencies first; see README.md`)
  }
  await new Promise((resolve, reject) => {
    const server = net.createServer()
    server.once('error', () => reject(new Error(`Port ${service.port} is busy. Stop the existing service first.`)))
    server.listen(service.port, '127.0.0.1', () => server.close(resolve))
  })
}
const children = []
let stopping = false
function stop(code) {
  if (stopping) return
  stopping = true
  for (const child of children) child.kill()
  process.stdin.pause()
  process.exitCode = code
}
for (const service of services) {
  console.log(`Starting ${service.name} on port ${service.port}`)
  const child = spawn(service.command, service.args, {
    cwd: path.join(root, service.cwd), windowsHide: true, stdio: 'inherit',
    env: { ...process.env, PYTHONIOENCODING: 'utf-8', API_HOST: '127.0.0.1', API_PORT: '14052', PORT: '11434' },
  })
  children.push(child)
  child.once('error', error => { console.error(error.message); stop(1) })
  child.once('exit', code => { if (!stopping) stop(code || 1) })
}
process.on('SIGINT', () => stop(0))
process.on('SIGTERM', () => stop(0))
process.stdin.on('data', data => {
  if (data.toString().trim() === 'stop' || data.includes(3)) stop(0)
})
console.log('Open http://localhost:3098 and select the matching connection mode. Ctrl+C stops this group.')

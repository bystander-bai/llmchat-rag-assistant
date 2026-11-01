import { spawn } from 'node:child_process'
import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('../', import.meta.url))
const python = path.join(root, 'llmchat_Rag/.venv', process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python')
const logDir = path.join(root, 'artifacts/check')
await mkdir(logDir, { recursive: true })
const checks = [
  ['frontend-lint', 'llm-chat', process.execPath, ['node_modules/eslint/bin/eslint.js', '.', '--ext', 'ts,tsx', '--report-unused-disable-directives', '--max-warnings', '0']],
  ['frontend-build', 'llm-chat', process.execPath, ['node_modules/typescript/bin/tsc']],
  ['python-dependencies', 'llmchat_Rag', python, ['-m', 'pip', 'check']],
]
async function run([name, cwd, command, args]) {
  let output = ''
  const child = spawn(command, args, { cwd: path.join(root, cwd), windowsHide: true,
    env: { ...process.env, PYTHONIOENCODING: 'utf-8', ANONYMIZED_TELEMETRY: 'False' } })
  child.stdout.on('data', chunk => { output += chunk })
  child.stderr.on('data', chunk => { output += chunk })
  const code = await new Promise(resolve => {
    child.once('error', error => { output += error.message; resolve(1) })
    child.once('close', code => resolve(code ?? 1))
  })
  await writeFile(path.join(logDir, `${name}.log`), output)
  console.log(`${code === 0 ? 'PASS' : 'FAIL'} ${name}`)
  if (code !== 0) console.error(output.slice(-4000))
  return code
}
// TypeScript and Vite share one build log and execute in order.
const codes = await Promise.all(checks.map(async check => {
  const code = await run(check)
  if (check[0] !== 'frontend-build' || code !== 0) return code
  return run(['frontend-bundle', 'llm-chat', process.execPath, ['node_modules/vite/bin/vite.js', 'build']])
}))
process.exitCode = codes.some(code => code !== 0) ? 1 : 0
console.log(`Logs: ${logDir}`)

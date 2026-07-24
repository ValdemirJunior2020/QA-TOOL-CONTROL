import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const viteEntry = path.join(projectRoot, 'node_modules', 'vite', 'bin', 'vite.js')
const children = []
let shuttingDown = false

function startNode(scriptPath, label) {
  const child = spawn(process.execPath, [scriptPath], {
    cwd: projectRoot,
    stdio: 'inherit',
    windowsHide: false,
  })

  children.push(child)

  child.on('error', (error) => {
    console.error(`${label} could not start:`, error.message)
    shutdown(1)
  })

  child.on('exit', (code, signal) => {
    if (!shuttingDown && code !== 0) {
      console.error(`${label} stopped unexpectedly${signal ? ` (${signal})` : ` with code ${code}`}.`)
      shutdown(code ?? 1)
    }
  })
}

function shutdown(code = 0) {
  if (shuttingDown) return
  shuttingDown = true

  for (const child of children) {
    if (!child.killed) {
      child.kill('SIGTERM')
    }
  }

  setTimeout(() => process.exit(code), 250)
}

process.on('SIGINT', () => shutdown(0))
process.on('SIGTERM', () => shutdown(0))

startNode(path.join(projectRoot, 'server', 'local-api.mjs'), 'Local API')
startNode(viteEntry, 'Vite')

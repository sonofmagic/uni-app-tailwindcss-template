import { spawn } from 'node:child_process'
import process from 'node:process'

// Each command owns a process group. Never terminate the IDE or simulator that
// a command connects to: those processes are outside this group.
export function signalCommand(child, signal = 'SIGTERM') {
  if (!child?.pid) return
  try {
    if (process.platform !== 'win32') process.kill(-child.pid, signal)
    else child.kill(signal)
  }
  catch (error) {
    if (error.code !== 'ESRCH') throw error
  }
}

export function runCommand(command, args = [], {
  cwd, env = process.env, timeoutMs = 30_000, killGraceMs = 1_000,
  signal, onData, onSpawn, onClose,
} = {}) {
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) throw new Error('Command timeout must be positive')
  return new Promise((resolve) => {
    let output = ''
    let stdout = ''
    let stderr = ''
    let timedOut = false
    let aborted = false
    let timer
    let killTimer
    let finished = false
    let spawnFailed = false
    const child = spawn(command, args, {
      cwd, env: { ...env, FORCE_COLOR: '0' },
      detached: process.platform !== 'win32', stdio: ['ignore', 'pipe', 'pipe'],
    })
    onSpawn?.(child)
    function terminate() {
      if (killTimer) return
      signalCommand(child)
      killTimer = setTimeout(() => signalCommand(child, 'SIGKILL'), killGraceMs)
    }
    function abort() { aborted = true; terminate() }
    for (const [name, stream] of [['stdout', child.stdout], ['stderr', child.stderr]]) {
      stream.on('data', (chunk) => {
        const text = chunk.toString()
        output += text
        if (name === 'stdout') stdout += text
        else stderr += text
        onData?.(text, name)
      })
    }
    child.on('error', error => { spawnFailed = true; output += `${error.message}\n`; stderr += `${error.message}\n` })
    child.on('close', (code, exitSignal) => {
      if (finished) return
      finished = true
      clearTimeout(timer)
      // If the parent exits before its children, still terminate the owned group.
      if (timedOut || aborted) signalCommand(child, 'SIGKILL')
      clearTimeout(killTimer)
      signal?.removeEventListener('abort', abort)
      onClose?.(child)
      if (timedOut) output += `Command timed out after ${timeoutMs}ms\n`
      resolve({ code: timedOut ? 124 : aborted ? 130 : spawnFailed ? 1 : code ?? 1, signal: exitSignal, output, stdout, stderr, timedOut, aborted })
    })
    timer = setTimeout(() => { timedOut = true; terminate() }, timeoutMs)
    signal?.addEventListener('abort', abort, { once: true })
    if (signal?.aborted) abort()
  })
}

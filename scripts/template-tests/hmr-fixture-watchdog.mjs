#!/usr/bin/env node

import { existsSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs'
import process from 'node:process'

const ownerPid = Number(process.argv[2])
const backupFile = process.argv[3]

if (!Number.isInteger(ownerPid) || ownerPid <= 0 || !backupFile) {
  process.exit(1)
}

const timer = setInterval(() => {
  if (isRunning(ownerPid)) {
    return
  }
  clearInterval(timer)
  restoreBackup()
}, 250)

function isRunning(pid) {
  try {
    process.kill(pid, 0)
    return true
  }
  catch {
    return false
  }
}

function restoreBackup() {
  if (!existsSync(backupFile)) {
    return
  }
  const backup = JSON.parse(readFileSync(backupFile, 'utf8'))
  if (typeof backup.original !== 'string' || typeof backup.target !== 'string') {
    process.exitCode = 1
    return
  }
  const tempFile = `${backup.target}.hmr-watchdog-restore`
  writeFileSync(tempFile, backup.original, 'utf8')
  renameSync(tempFile, backup.target)
  unlinkSync(backupFile)
}

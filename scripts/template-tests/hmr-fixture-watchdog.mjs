#!/usr/bin/env node

import { existsSync, mkdirSync, readFileSync, renameSync, rmdirSync, rmSync, unlinkSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import process from 'node:process'

const ownerPid = Number(process.argv[2])
const backupFile = process.argv[3]

if (!Number.isInteger(ownerPid) || ownerPid <= 0 || !backupFile) process.exit(1)

const timer = setInterval(() => {
  if (isRunning(ownerPid)) return
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
  if (!existsSync(backupFile)) return
  const backup = JSON.parse(readFileSync(backupFile, 'utf8'))
  if (!Array.isArray(backup?.files)) {
    process.exitCode = 1
    return
  }
  for (const file of backup.files) {
    if (file.existed) {
      mkdirSync(path.dirname(file.path), { recursive: true })
      const tempFile = `${file.path}.hmr-watchdog-restore`
      writeFileSync(tempFile, file.content, 'utf8')
      renameSync(tempFile, file.path)
    }
    else {
      rmSync(file.path, { force: true })
      try {
        rmdirSync(path.dirname(file.path))
      }
      catch {}
    }
  }
  unlinkSync(backupFile)
}

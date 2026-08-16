import { spawn } from 'node:child_process'
import { existsSync, promises as fs, mkdirSync, renameSync, rmdirSync, rmSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'
import { applyEdits, modify, parse } from 'jsonc-parser'

export const targetVueFile = path.resolve('src/pages/__daily_hmr__/index.vue')
const pagesFile = path.resolve('src/pages.json')
const tailwindEntry = path.resolve('src/tailwind.css')
const backupFile = path.resolve('.hmr-artifacts/.fixture-backup.json')
const routePath = 'pages/__daily_hmr__/index'

const states = {
  initial: {
    text: 'hmr-initial',
    pseudo: 'hmr_initial',
    heightClass: 'h-[96rpx]',
    radiusClass: 'rounded-[18rpx]',
    colorClass: 'bg-[#16a34a]',
  },
  updated: {
    text: 'hmr-updated',
    pseudo: 'hmr_updated',
    heightClass: 'h-[128rpx]',
    radiusClass: 'rounded-[30rpx]',
    colorClass: 'bg-[#dc2626]',
  },
}

export async function createFixtureController() {
  await recoverInterruptedFixture()
  const pagesOriginal = await fs.readFile(pagesFile, 'utf8')
  const targetExisted = existsSync(targetVueFile)
  const targetOriginal = targetExisted ? await fs.readFile(targetVueFile, 'utf8') : undefined
  const backup = {
    files: [
      { content: pagesOriginal, existed: true, path: pagesFile },
      { content: targetOriginal, existed: targetExisted, path: targetVueFile },
    ],
  }
  await fs.mkdir(path.dirname(backupFile), { recursive: true })
  await fs.mkdir(path.dirname(targetVueFile), { recursive: true })
  await fs.writeFile(backupFile, `${JSON.stringify(backup)}\n`, 'utf8')
  await writeProbeRoute(pagesOriginal)

  const watchdog = spawn(process.execPath, [
    fileURLToPath(new URL('./hmr-fixture-watchdog.mjs', import.meta.url)),
    String(process.pid),
    backupFile,
  ], { detached: true, stdio: 'ignore' })
  watchdog.unref()

  let restored = false
  const restoreSync = () => {
    if (restored) return
    restoreBackupSync(backup)
    restored = true
    rmSync(backupFile, { force: true })
    watchdog.kill('SIGTERM')
  }

  return {
    async apply(stateName) {
      const state = states[stateName]
      if (!state) throw new Error(`Unknown HMR fixture state: ${stateName}`)
      await fs.writeFile(targetVueFile, renderFixture(state), 'utf8')
      const now = new Date()
      await Promise.all([
        fs.utimes(targetVueFile, now, now),
        fs.utimes(tailwindEntry, now, now),
      ])
    },
    async restore() {
      if (!restored) {
        await restoreBackup(backup)
        restored = true
      }
      await fs.rm(backupFile, { force: true })
      watchdog.kill('SIGTERM')
    },
    restoreSync,
  }
}

export function getFixtureState(stateName) {
  return states[stateName]
}

async function writeProbeRoute(source) {
  const document = parse(source)
  const pages = Array.isArray(document.pages) ? document.pages : []
  const nextPages = [
    { path: routePath, style: { navigationBarTitleText: 'Daily HMR' } },
    ...pages.filter(page => page?.path !== routePath),
  ]
  const edits = modify(source, ['pages'], nextPages, {
    formattingOptions: { insertSpaces: true, tabSize: 2 },
  })
  await fs.writeFile(pagesFile, applyEdits(source, edits), 'utf8')
}

async function recoverInterruptedFixture() {
  try {
    const backup = JSON.parse(await fs.readFile(backupFile, 'utf8'))
    assertBackup(backup)
    await restoreBackup(backup)
    await fs.rm(backupFile, { force: true })
  }
  catch (error) {
    if (error.code !== 'ENOENT') throw error
  }
}

async function restoreBackup(backup) {
  for (const file of backup.files) {
    if (file.existed) {
      await fs.mkdir(path.dirname(file.path), { recursive: true })
      const tempFile = `${file.path}.hmr-restore`
      await fs.writeFile(tempFile, file.content, 'utf8')
      await fs.rename(tempFile, file.path)
    }
    else {
      await fs.rm(file.path, { force: true })
      await removeEmptyParents(path.dirname(file.path), path.dirname(pagesFile))
    }
  }
}

function restoreBackupSync(backup) {
  for (const file of backup.files) {
    if (file.existed) {
      mkdirSync(path.dirname(file.path), { recursive: true })
      const tempFile = `${file.path}.hmr-restore`
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
}

async function removeEmptyParents(directory, stopAt) {
  let current = directory
  while (current.startsWith(stopAt) && current !== stopAt) {
    try {
      await fs.rmdir(current)
      current = path.dirname(current)
    }
    catch {
      return
    }
  }
}

function assertBackup(backup) {
  if (!Array.isArray(backup?.files) || backup.files.some(file => typeof file.path !== 'string' || typeof file.existed !== 'boolean')) {
    throw new Error(`Invalid fixture backup at ${backupFile}`)
  }
}

function renderFixture(state) {
  const color = state.colorClass.match(/#[0-9a-f]+/i)?.[0]
  const height = state.heightClass.slice(3, -1)
  const radius = state.radiusClass.slice(9, -1)
  return `<script setup>\nconst hmrProbeClass = '${state.colorClass} wx:border-blue-500 not-wx:border-rose-500'\nconst hmrProbeStyle = { backgroundColor: '${color}', borderColor: 'rgb(255, 35, 87)', borderRadius: '${radius}', fontWeight: '700', height: '${height}' }\n</script>\n\n<template>\n  <view class="min-h-screen p-2">\n    <view\n      data-hmr-probe="${state.text}"\n      data-hmr-pseudo="${state.pseudo}"\n      class="hmr-runtime-probe fixed left-2 top-2 z-50 flex w-[240rpx] items-center justify-center border-4 text-[24rpx] font-bold text-white ${state.heightClass} ${state.radiusClass} before:content-['${state.pseudo}']"\n      :class="hmrProbeClass"\n      :style="hmrProbeStyle"\n    >\n      ${state.text}\n    </view>\n  </view>\n</template>\n`
}

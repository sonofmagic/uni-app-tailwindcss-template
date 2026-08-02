import { spawn } from 'node:child_process'
import { existsSync, promises as fs, renameSync, unlinkSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

export const targetVueFile = path.resolve('src/components/WeappTailwindcss.vue')
const backupFile = path.resolve('.hmr-artifacts/.fixture-backup.json')

const scriptMarker = '// HMR_PROBE_SCRIPT'
const templateMarker = '<!-- HMR_PROBE_TEMPLATE -->'

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
  const original = await fs.readFile(targetVueFile, 'utf8')
  assertMarkers(original)
  await fs.mkdir(path.dirname(backupFile), { recursive: true })
  await fs.writeFile(backupFile, `${JSON.stringify({ original, target: targetVueFile })}\n`, 'utf8')
  const watchdog = spawn(process.execPath, [
    fileURLToPath(new URL('./hmr-fixture-watchdog.mjs', import.meta.url)),
    String(process.pid),
    backupFile,
  ], {
    detached: true,
    stdio: 'ignore',
  })
  watchdog.unref()

  let restored = false
  const restoreTempFile = `${targetVueFile}.hmr-restore`
  const restoreSync = () => {
    if (restored) {
      return
    }
    writeFileSync(restoreTempFile, original, 'utf8')
    renameSync(restoreTempFile, targetVueFile)
    restored = true
    if (existsSync(backupFile)) {
      unlinkSync(backupFile)
    }
    watchdog.kill('SIGTERM')
  }

  return {
    async apply(stateName) {
      const state = states[stateName]
      if (!state) {
        throw new Error(`Unknown HMR fixture state: ${stateName}`)
      }
      await fs.writeFile(targetVueFile, renderFixture(original, state), 'utf8')
      const now = new Date()
      await fs.utimes(targetVueFile, now, now)
    },
    async restore() {
      if (!restored) {
        await fs.writeFile(restoreTempFile, original, 'utf8')
        await fs.rename(restoreTempFile, targetVueFile)
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

function assertMarkers(source) {
  for (const marker of [scriptMarker, templateMarker]) {
    if (!source.includes(marker)) {
      throw new Error(`Missing ${marker} in ${path.relative(process.cwd(), targetVueFile)}`)
    }
  }
}

async function recoverInterruptedFixture() {
  try {
    const backup = JSON.parse(await fs.readFile(backupFile, 'utf8'))
    if (backup.target !== targetVueFile || typeof backup.original !== 'string') {
      throw new Error(`Invalid fixture backup at ${backupFile}`)
    }
    const tempFile = `${targetVueFile}.hmr-recover`
    await fs.writeFile(tempFile, backup.original, 'utf8')
    await fs.rename(tempFile, targetVueFile)
    await fs.rm(backupFile, { force: true })
  }
  catch (error) {
    if (error.code !== 'ENOENT') {
      throw error
    }
  }
}

function renderFixture(source, state) {
  const script = `${scriptMarker}\nconst hmrProbeClass = '${state.colorClass} wx:border-blue-500 not-wx:border-rose-500'`
  const template = `${templateMarker}\n    <view\n      data-hmr-probe="${state.text}"\n      class="\n        hmr-runtime-probe fixed left-2 top-2 z-50 flex w-[240rpx] items-center\n        justify-center border-4 text-[24rpx] font-bold text-white\n        ${state.heightClass} ${state.radiusClass}\n        before:content-['${state.pseudo}']\n      "\n      :class="hmrProbeClass"\n    >\n      ${state.text}\n    </view>`

  return source.replace(scriptMarker, script).replace(templateMarker, template)
}

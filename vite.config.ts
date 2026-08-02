import { existsSync } from 'node:fs'
import { utimes } from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'
import uni from '@dcloudio/vite-plugin-uni'
import { defineConfig } from 'vite'
import { WeappTailwindcss } from 'weapp-tailwindcss/vite'

// https://vitejs.dev/config/
export default defineConfig(async () => {
  // 新版本的 unplugin-auto-import 改成了只有 esm 格式的产物，而 uni-app 目前必须 cjs 格式
  // 所以需要改成动态 import 的写法来进行引入
  // 详见 https://github.com/sonofmagic/uni-app-vite-vue3-tailwind-vscode-template/issues/29
  const { default: AutoImport } = await import('unplugin-auto-import/vite')
  const projectRoot = fileURLToPath(new URL('.', import.meta.url))
  const bridgeFile = path.join(projectRoot, '.hmr-artifacts/.file-event-bridge')
  const bridgeTarget = path.join(projectRoot, 'src/components/WeappTailwindcss.vue')
  const tailwindEntry = path.join(projectRoot, 'src/tailwind.css')
  const hmrSmoke = process.env.HMR_SMOKE_USE_POLLING === 'true'
    || existsSync(bridgeFile)
  return {
    // uvtw 一定要放在 uni 后面
    plugins: [
      uni(),
      WeappTailwindcss({
        cssEntries: ['./src/tailwind.css'],
        rem2rpx: true,
      }),
      AutoImport({
        imports: ['vue', 'uni-app', 'pinia'],
        dts: './src/auto-imports.d.ts',
        eslintrc: {
          enabled: true,
        },
      }),
      {
        name: 'hmr-smoke-file-event-bridge',
        async watchChange(id) {
          if ((process.env.HMR_SMOKE_USE_POLLING === 'true' || existsSync(bridgeFile))
            && path.resolve(id) === bridgeTarget) {
            const now = new Date()
            await utimes(tailwindEntry, now, now)
          }
        },
      },
    ],
    // 内联 postcss 注册 tailwindcss
    css: {
      // https://vitejs.dev/config/shared-options.html#css-preprocessoroptions
      preprocessorOptions: {
        scss: {
          silenceDeprecations: ['legacy-js-api'],
        },
      },
    },
    server: hmrSmoke
      ? {
          watch: {
            interval: 200,
            usePolling: true,
          },
        }
      : undefined,
  }
})

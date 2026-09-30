import { icebreaker } from '@icebreakers/eslint-config'

export default icebreaker(
  {
    vue: true,
    betterTailwindcss: {
      entryPoint: './src/tailwind.css',
    },
    // This template uses uni-app, not the Wevu runtime targeted by miniProgram.
    miniProgram: false,
  },
  {
    ignores: [
      '.agents/**',
      '.claude/**',
      '.continue/**',
      'skills/**',
    ],
    // 规则可以在这里禁用
    rules: {
      'better-tailwindcss/enforce-canonical-classes': 'off',
      'better-tailwindcss/enforce-consistent-class-order': 'off',
      'better-tailwindcss/enforce-consistent-line-wrapping': 'off',
      'better-tailwindcss/no-conflicting-classes': 'off',
      'better-tailwindcss/no-unknown-classes': 'off',
    },
  },
  {
    files: ['src/**/*.{js,ts,vue}'],
    languageOptions: {
      globals: {
        uni: 'readonly',
        wx: 'readonly',
        my: 'readonly',
        tt: 'readonly',
        getApp: 'readonly',
        getCurrentPages: 'readonly',
      },
    },
  },
)

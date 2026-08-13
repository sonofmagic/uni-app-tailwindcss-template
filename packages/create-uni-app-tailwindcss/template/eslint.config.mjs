import { icebreaker } from '@icebreakers/eslint-config'

export default icebreaker(
  {
    vue: true,
    betterTailwindcss: {
      entryPoint: './src/tailwind.css',
    },
    weapp: true,
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
)

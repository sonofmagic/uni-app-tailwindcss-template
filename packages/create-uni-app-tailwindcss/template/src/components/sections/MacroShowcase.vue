<script setup lang="ts">
function copy(data: string) {
  uni.setClipboardData({
    data,
  })
}

const hashTag = '#'
const variantLines = [
  '@custom-variant wx {',
  `  /*  ${hashTag}ifdef  MP-WEIXIN  */`,
  '  @slot;',
  `  /*  ${hashTag}endif  */`,
  '}',
  '',
  '@custom-variant not-wx {',
  `  /*  ${hashTag}ifndef  MP-WEIXIN  */`,
  '  @slot;',
  `  /*  ${hashTag}endif  */`,
  '}',
]
const variantSnippet = variantLines.join('\n')
</script>

<template>
  <view
    class="
      rounded-[32rpx] border border-slate-100/70 bg-white/90 p-5
      shadow-[0_20px_45px_rgba(15,23,42,0.08)]
    "
  >
    <view class="text-xs uppercase tracking-[6rpx] text-slate-400">
      条件编译
    </view>
    <view class="text-2xl font-semibold text-slate-900">
      用 @custom-variant 直接表达宿主差异
    </view>
    <view class="mt-4 space-y-4">
      <view class="text-sm text-neutral-600">
        现在不再依赖 weapp-tailwindcss/css-macro，而是把宿主分支写成 wx / not-wx。
      </view>
      <view class="rounded-[24rpx] border border-dashed border-slate-200 bg-slate-50/80 p-4 text-sm text-slate-600">
        <view class="mb-2 flex items-center justify-between gap-3">
          <view class="text-neutral-400">
            配置示例
          </view>
          <text class="text-sky-400 underline" @click="copy(variantSnippet)">
            复制片段
          </text>
        </view>
        <view class="rounded-2xl bg-white/80 p-3 text-[24rpx] leading-6 text-slate-700">
          <view
            v-for="(line, index) in variantLines"
            :key="`${index}-${line}`"
            :class="{ 'mt-2': index === 6, 'pl-3': line.startsWith('  ') }"
          >
            {{ line || ' ' }}
          </view>
        </view>
      </view>

      <view class="grid gap-3">
        <view class="rounded-[24rpx] border border-slate-200 bg-white/70 p-4">
          <view class="flex items-center justify-between gap-3">
            <view class="font-semibold text-slate-800">
              宿主背景
            </view>
            <view class="text-[22rpx] text-slate-400">
              wx:bg-blue-500 not-wx:bg-red-500
            </view>
          </view>
          <view class="mt-3 rounded-2xl px-3 py-2 text-sm font-medium text-white wx:bg-blue-500 not-wx:bg-red-500">
            微信小程序为蓝色，不是微信小程序为红色。
          </view>
        </view>

        <view class="rounded-[24rpx] border border-slate-200 bg-white/70 p-4">
          <view class="flex items-center justify-between gap-3">
            <view class="font-semibold text-slate-800">
              文字强调
            </view>
            <view class="text-[22rpx] text-slate-400">
              wx:text-white not-wx:text-slate-900
            </view>
          </view>
          <view class="mt-3 rounded-2xl bg-slate-100 px-3 py-2 text-sm font-medium wx:bg-slate-900 wx:text-white not-wx:bg-rose-50 not-wx:text-slate-900">
            微信小程序强调白字，其他端保留深色文字。
          </view>
        </view>

        <view class="rounded-[24rpx] border border-slate-200 bg-white/70 p-4">
          <view class="flex items-center justify-between gap-3">
            <view class="font-semibold text-slate-800">
              边框与阴影
            </view>
            <view class="text-[22rpx] text-slate-400">
              wx:ring-2 not-wx:border
            </view>
          </view>
          <view class="mt-3 rounded-2xl px-3 py-2 text-sm font-medium text-slate-700 wx:ring-2 wx:ring-blue-200 not-wx:border not-wx:border-rose-200 not-wx:bg-rose-50">
            同一套标记在不同宿主呈现不同层次。
          </view>
        </view>
      </view>

      <view class="rounded-[24rpx] border border-slate-200/80 bg-white/60 p-4">
        <view class="text-sm font-semibold text-slate-700">
          页面里的实际写法
        </view>
        <view class="mt-2 grid gap-2 text-[24rpx] text-slate-600">
          <view class="rounded-xl bg-slate-900/5 px-3 py-2">
            wx:bg-blue-500 not-wx:bg-red-500
          </view>
          <view class="rounded-xl bg-slate-900/5 px-3 py-2">
            wx:text-white not-wx:text-slate-900
          </view>
          <view class="rounded-xl bg-slate-900/5 px-3 py-2">
            wx:ring-2 wx:ring-blue-200 not-wx:border not-wx:border-rose-200
          </view>
        </view>
      </view>
    </view>

    <view
      class="
        mt-4 rounded-[24rpx] border border-slate-200/80 bg-white/60 p-4
        shadow-inner
      "
    >
      <view class="text-sm font-semibold text-slate-700">
        更多文档
      </view>
      <view class="text-xs text-slate-500">
        点击复制链接
      </view>
      <view class="mt-3 flex flex-wrap gap-2 text-xs">
        <view
          class="
            rounded-full bg-slate-900/5 px-3 py-1 font-semibold text-slate-600
          "
          @click="copy('https://tw.icebreaker.top/')"
        >
          官网
        </view>
        <view
          class="
            rounded-full bg-slate-900/5 px-3 py-1 font-semibold text-slate-600
          "
          @click="copy('https://tw.icebreaker.top/docs/guide')"
        >
          Guide
        </view>
      </view>
    </view>
  </view>
</template>

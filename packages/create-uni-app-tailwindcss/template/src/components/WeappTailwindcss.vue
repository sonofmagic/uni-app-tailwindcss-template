<script setup>
function copy(data) {
  uni.setClipboardData({
    data,
  })
}
</script>

<template>
  <view class="space-y-1.5 px-4 text-center">
    <view class="px-[48px]">
      <image
        class="aspect-[1329/214] h-auto w-full"
        src="/static/images/weapp-tailwindcss.png"
        mode="aspectFit"
      />
    </view>
    <view
      class="flex items-center justify-center text-gray-600/75"
      @click="copy('https://github.com/sonofmagic/weapp-tailwindcss')"
    >
      <view class="i-[mdi--github-circle] mx-2 text-[32px] text-black" />
      <view class="text-[22px]">
        +
      </view>
      <view class="i-[mdi--star] mx-2 text-[32px] text-yellow-400" />
    </view>
    <view
      class="
        bg-linear-to-r from-green-400 to-sky-400 bg-clip-text text-2xl
        font-extrabold text-transparent underline
      "
      @click="copy('https://tw.icebreaker.top/')"
    >
      tw.icebreaker.top
    </view>
    <view class="text-xs text-gray-600/75">
      你可以在上方的官网上，找到大量的提效解决方案
    </view>
    <view class="text-xs text-gray-600/75">
      在使用这个模板之前，确保你安装了 Nodejs@22 和 Vscode，然后安装了 eslint 插件，本模板使用 eslint 进行错误校验和格式化
    </view>
    <view
      class="
        mb-2 text-center
        before:text-xs before:text-sky-400
        before:content-['现在，让我们开始神奇的_tailwindcss_开发之旅吧！']
      "
    />
  </view>
</template>

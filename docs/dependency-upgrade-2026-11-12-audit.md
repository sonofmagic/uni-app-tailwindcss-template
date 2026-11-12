# 2026-11-12 依赖审计复核

执行 `pnpm audit --json`，审计从 97 条降至 64 条，critical 从 3 条降至 0 条。下文逐项记录剩余 advisory、影响、依赖路径及保留原因。审计命中不等同于已确认的线上可利用漏洞。

| 等级 | 升级前 | 升级后 |
| --- | ---: | ---: |
| critical | 3 | 0 |
| high | 32 | 21 |
| moderate | 45 | 31 |
| low | 17 | 12 |
| 合计 | 97 | 64 |

`proxy-addr` 已在声明范围内刷新到 2.0.8。`oxfmt` 精确固定的 tinypool 旧补丁通过 `oxfmt>tinypool: 2.1.2` 定向覆盖修复；根工作区和生成模板同步配置，并通过 lint、构建与生成项目验证。

## 模块与实际路径

下表为每个模块的一条实际最短路径，`template` 表示 `packages/template`。其他路径、父包版本和依赖范围保存在本地忽略目录的 `audit-review.json`。父包范围已从实际安装包核对；下节列出全部 64 条 advisory 的具体影响与安全版本。

| 模块（版本；advisory 数） | 实际路径 | 保留原因 |
| --- | --- | --- |
| `jpeg-js`（0.3.7；2） | `template>@dcloudio/uni-mp-baidu>jimp>@jimp/types>@jimp/jpeg>jpeg-js` | DCloud 使用旧 Jimp；@jimp/jpeg 要求 ^0.3.4，修复版 0.4.x 超出范围。 |
| `phin`（2.9.3；1） | `template>@dcloudio/uni-mp-baidu>@dcloudio/uni-mp-weixin>jimp>@jimp/custom>@jimp/core>phin` | DCloud 使用旧 Jimp；@jimp/core 要求 ^2.9.1，advisory 未提供修复版本，需替换上游请求库。 |
| `vite`（5.2.8；20） | `template>vite` | 官方 UVM 固定为 5.2.8，保留当前 uni-app 编译器组合。 |
| `rollup`（4.14.3；2） | `template>@dcloudio/vite-plugin-uni>vite>rollup` | 官方 UVM 固定为 4.14.3，保留当前 uni-app 编译器组合。 |
| `esbuild`（0.20.2；1） | `template>vite>esbuild` | @dcloudio/uni-cli-shared 精确依赖 0.20.2；保留当前 DCloud 正式编译器链，等待配套升级。 |
| `cookie`（0.6.0；1） | `template>@dcloudio/vite-plugin-uni>express>cookie` | express 精确依赖 0.6.0；保留当前 DCloud 正式编译器链，等待配套升级。 |
| `path-to-regexp`（0.1.10；2） | `template>@dcloudio/vite-plugin-uni>express>path-to-regexp` | express 精确依赖 0.1.10；保留当前 DCloud 正式编译器链，等待配套升级。 |
| `send`（0.18.0；1） | `template>@dcloudio/vite-plugin-uni>express>serve-static>send` | serve-static 精确依赖 0.18.0；保留当前 DCloud 正式编译器链，等待配套升级。 |
| `qs`（6.11.0, 6.13.0；5） | `template>@dcloudio/vite-plugin-uni>express>qs` | express 精确依赖 6.11.0；body-parser 精确依赖 6.13.0；保留当前 DCloud 正式编译器链，等待配套升级。 |
| `postcss`（8.5.6；4） | `template>@dcloudio/uni-cli-shared>@dcloudio/uni-nvue-styler>postcss` | @dcloudio/uni-nvue-styler 精确依赖 8.5.6；保留当前 DCloud 正式编译器链，等待配套升级。 |
| `ws`（8.18.0；2） | `template>@dcloudio/uni-mp-baidu>ws` | @dcloudio/uni-mp-weixin 精确依赖 8.18.0；@dcloudio/uni-mp-baidu 精确依赖 8.18.0；保留当前 DCloud 正式编译器链，等待配套升级。 |
| `@babel/core`（7.25.2；1） | `template>@dcloudio/uni-mp-qq>@dcloudio/uni-cli-shared>@babel/core` | @dcloudio/uni-cli-shared 精确依赖 7.25.2；保留当前 DCloud 正式编译器链，等待配套升级。 |
| `adm-zip`（0.5.16；8） | `template>@dcloudio/uni-cli-shared>adm-zip` | @dcloudio/uni-cli-shared 精确依赖 0.5.16；保留当前 DCloud 正式编译器链，等待配套升级。 |
| `body-parser`（1.20.3；2） | `template>@dcloudio/vite-plugin-uni>express>body-parser` | express 精确依赖 1.20.3；保留当前 DCloud 正式编译器链，等待配套升级。 |
| `postcss-selector-parser`（6.1.2；2） | `template>@dcloudio/uni-h5>postcss-selector-parser` | @dcloudio/uni-cli-shared 精确依赖 6.1.2；@dcloudio/uni-h5 精确依赖 6.1.2；保留当前 DCloud 正式编译器链，等待配套升级。 |
| `katex`（0.16.47；1） | `template>@icebreakers/eslint-config>@antfu/eslint-config>@eslint/markdown>micromark-extension-math>katex` | 父包 micromark-extension-math 要求 ^0.16.0；修复版 >=0.18.2 超出范围。 |
| `source-map-js`（1.2.1；1） | `template>vue-i18n>vue>@vue/compiler-sfc>source-map-js` | uni-cli-shared 精确依赖 1.2.1；其他声明范围内的副本已刷新，DCloud 固定副本保留。 |
| `@vue/server-renderer`（3.4.21；1） | `template>vue>@vue/server-renderer` | Vue 及 DCloud 精确依赖 3.4.21，需与跨端 Vue 运行时一起升级。 |
| `@intlify/core-base`（9.14.5；2） | `template>vue-i18n>@intlify/core-base` | 保留当前 vue-i18n 9 配套版本及既有 9.14.5 override，等待配套升级。 |
| `vue-i18n`（9.14.5；2） | `template>vue-i18n` | 保留 uni-app 配套的 vue-i18n 9；安全修复跨主版本，需要独立验证 DCloud H5 运行时。 |
| `@intlify/shared`（9.14.5；1） | `template>vue-i18n>@intlify/shared` | vue-i18n/core-base/message-compiler 精确依赖 9.14.5，等待配套升级。 |
| `glob`（13.0.7；1） | `root>repoctl>@icebreakers/monorepo>@npmcli/config>@npmcli/map-workspaces>glob` | 父包 @npmcli/map-workspaces 要求 ^13.0.0；修复版 >=14.0.2 超出范围。 |
| `minimatch`（10.2.6；1） | `template>@icebreakers/eslint-config>eslint>minimatch` | ESLint 等父包要求 ^10.x；修复版 >=11.0.1 超出范围。 |

## 全部剩余 advisory

| 模块 | 等级 | advisory / 影响 | 安全版本范围 |
| --- | --- | --- | --- |
| `jpeg-js` | high | [Infinite loop in jpeg-js](https://github.com/advisories/GHSA-xvf7-4v9q-58w6) | `>=0.4.4` |
| `jpeg-js` | moderate | [Uncontrolled resource consumption in jpeg-js](https://github.com/advisories/GHSA-w7q9-p3jq-fmhm) | `>=0.4.0` |
| `phin` | moderate | [phin may include sensitive headers in subsequent requests after redirect](https://github.com/advisories/GHSA-x565-32qp-m3vf) | 未提供 |
| `vite` | moderate | [Vite's server.fs.deny is bypassed when using ?import&raw](https://github.com/advisories/GHSA-9cwx-2883-4wfx) | `>=5.2.14` |
| `vite` | moderate | [Vite DOM Clobbering gadget found in vite bundled scripts that leads to XSS](https://github.com/advisories/GHSA-64vr-g452-qvp3) | `>=5.2.14` |
| `rollup` | high | [DOM Clobbering Gadget found in rollup bundled scripts that leads to XSS](https://github.com/advisories/GHSA-gcx4-mw62-g8wm) | `>=4.22.4` |
| `esbuild` | moderate | [esbuild enables any website to send any requests to the development server and read the response](https://github.com/advisories/GHSA-67mh-4wv8-2f99) | `>=0.25.0` |
| `vite` | moderate | [Websites were able to send any requests to the development server and read the response in vite](https://github.com/advisories/GHSA-vg6x-rcgg-rjx6) | `>=5.4.12` |
| `vite` | moderate | [Vite bypasses server.fs.deny when using ?raw??](https://github.com/advisories/GHSA-x574-m823-4x7w) | `>=5.4.15` |
| `vite` | moderate | [Vite has an server.fs.deny bypass with an invalid request-target](https://github.com/advisories/GHSA-356w-63v5-8wf4) | `>=5.4.18` |
| `cookie` | low | [cookie accepts cookie name, path, and domain with out of bounds characters](https://github.com/advisories/GHSA-pxg6-pf52-xh8x) | `>=0.7.0` |
| `vite` | moderate | [Vite's server.fs.deny bypassed with /. for files under project root](https://github.com/advisories/GHSA-859w-5945-r5v3) | `>=5.4.19` |
| `vite` | moderate | [Vite allows server.fs.deny to be bypassed with .svg or relative paths](https://github.com/advisories/GHSA-xcj6-pq6g-qj4x) | `>=5.4.17` |
| `path-to-regexp` | high | [path-to-regexp contains a ReDoS](https://github.com/advisories/GHSA-rhx6-c78j-4q9w) | `>=0.1.12` |
| `vite` | low | [Vite middleware may serve files starting with the same name with the public directory](https://github.com/advisories/GHSA-g4jq-h2w9-997c) | `>=5.4.20` |
| `vite` | low | [Vite's server.fs settings were not applied to HTML files](https://github.com/advisories/GHSA-jqfw-vq24-v9c3) | `>=5.4.20` |
| `vite` | moderate | [vite allows server.fs.deny bypass via backslash on Windows](https://github.com/advisories/GHSA-93m4-6634-74q7) | `>=5.4.21` |
| `send` | low | [send vulnerable to template injection that can lead to XSS](https://github.com/advisories/GHSA-m6fv-jmcg-4jfg) | `>=0.19.0` |
| `vite` | moderate | [Vite has a server.fs.deny bypassed for inline and raw with ?import query](https://github.com/advisories/GHSA-4r4m-qw57-chr8) | `>=5.4.16` |
| `qs` | low | [qs's arrayLimit bypass in comma parsing allows denial of service](https://github.com/advisories/GHSA-w7fw-mjwx-w883) | `>=6.14.2` |
| `rollup` | high | [Rollup 4 has Arbitrary File Write via Path Traversal](https://github.com/advisories/GHSA-mw96-cpmx-2vgc) | `>=4.59.0` |
| `qs` | moderate | [qs's arrayLimit bypass in its bracket notation allows DoS via memory exhaustion](https://github.com/advisories/GHSA-6rw7-vpxm-498p) | `>=6.14.1` |
| `path-to-regexp` | high | [path-to-regexp vulnerable to Regular Expression Denial of Service via multiple route parameters](https://github.com/advisories/GHSA-37ch-88jc-xwx2) | `>=0.1.13` |
| `vite` | moderate | [Vite Vulnerable to Path Traversal in Optimized Deps .map Handling](https://github.com/advisories/GHSA-4w7w-66w2-5vf9) | `>=6.4.2` |
| `postcss` | moderate | [PostCSS has XSS via Unescaped </style> in its CSS Stringify Output](https://github.com/advisories/GHSA-qx2v-qp2m-jg93) | `>=8.5.10` |
| `ws` | moderate | [ws: Uninitialized memory disclosure](https://github.com/advisories/GHSA-58qx-3vcg-4xpx) | `>=8.20.1` |
| `qs` | moderate | [qs has a remotely triggerable DoS: qs.stringify crashes with TypeError on null/undefined entries in comma-format arrays when encodeValuesOnly is set](https://github.com/advisories/GHSA-q8mj-m7cp-5q26) | `>=6.15.2` |
| `vite` | high | [launch-editor vulnerable to command injection via the crafted request on Windows](https://github.com/advisories/GHSA-c27g-q93r-2cwf) | `>=5.4.9` |
| `vite` | moderate | [launch-editor: NTLMv2 hash disclosure via UNC path handling on Windows](https://github.com/advisories/GHSA-v6wh-96g9-6wx3) | `>=6.4.3` |
| `ws` | high | [ws: Memory exhaustion DoS from tiny fragments and data chunks](https://github.com/advisories/GHSA-96hv-2xvq-fx4p) | `>=8.21.0` |
| `@babel/core` | low | [@babel/core: Arbitrary File Read via sourceMappingURL Comment](https://github.com/advisories/GHSA-4x5r-pxfx-6jf8) | `>=7.29.6` |
| `adm-zip` | high | [adm-zip: Crafted ZIP file triggers 4GB memory allocation](https://github.com/advisories/GHSA-xcpc-8h2w-3j85) | `>=0.6.0` |
| `body-parser` | low | [body-parser vulnerable to denial of service when invalid limit value silently disables size enforcement](https://github.com/advisories/GHSA-v422-hmwv-36x6) | `>=1.20.6` |
| `postcss` | high | [PostCSS: Arbitrary file read and information disclosure via attacker-controlled sourceMappingURL in CSS comments](https://github.com/advisories/GHSA-6g55-p6wh-862q) | `>=8.5.12` |
| `postcss` | moderate | [PostCSS: incomplete fix of GHSA-6g55-p6wh-862q — attacker-controlled sourceMappingURL reads arbitrary .map files when from is unset](https://github.com/advisories/GHSA-fxqj-rqcc-2cmp) | `>=8.5.23` |
| `postcss` | high | [PostCSS: Path Traversal in Previous Source Map Auto-Loading (sourceMappingURL) leads to Arbitrary .map File Disclosure](https://github.com/advisories/GHSA-r28c-9q8g-f849) | `>=8.5.18` |
| `postcss-selector-parser` | low | [postcss-selector-parser allows denial of service through uncontrolled AST recursion](https://github.com/advisories/GHSA-w9m9-85wc-3x92) | `>=6.1.3` |
| `qs` | moderate | [qs: Denial of Service via Attacker Controlled isBuffer](https://github.com/advisories/GHSA-4mjr-xmp4-gh2g) | `>=6.16.0` |
| `adm-zip` | moderate | [adm-zip extraction follows destination symlinks, allowing arbitrary file overwrite](https://github.com/advisories/GHSA-vwc7-r8mq-g2x9) | `>=0.6.1` |
| `adm-zip` | high | [adm-zip: Uncontrolled memory allocation via the declared uncompressed size (DoS)](https://github.com/advisories/GHSA-7q85-xj36-vmfc) | `>=0.6.1` |
| `adm-zip` | high | [adm-zip: Decompression-bomb protection (fix for CVE-2026-39244) can be bypassed by declaring uncompressed size as 0](https://github.com/advisories/GHSA-rcw4-f5rp-g42v) | `>=0.6.1` |
| `adm-zip` | high | [adm-zip extraction preserves SUID/SGID bits from untrusted ZIPs -> local privilege escalation](https://github.com/advisories/GHSA-j5f4-cc29-5x44) | `>=0.6.1` |
| `adm-zip` | moderate | [adm-zip: Duplicate ZIP entry names: getEntry() and extractAllTo() resolve to different content](https://github.com/advisories/GHSA-p634-w6r4-rjp2) | `>=0.6.1` |
| `adm-zip` | moderate | [adm-zip: getDataAsync() bypasses the maxOutputLength size guard enforced by the synchronous getData() path](https://github.com/advisories/GHSA-c6fg-446q-cg94) | `>=0.6.1` |
| `adm-zip` | high | [adm-zip: Unhandled error event in async DEFLATE decompression crashes Node.js process (DoS)](https://github.com/advisories/GHSA-8238-w5pm-2374) | `>=0.6.1` |
| `katex` | low | [KaTeX: Existing prototype pollution can bypass trust restrictions](https://github.com/advisories/GHSA-238p-pmpm-9mq7) | `>=0.18.2` |
| `source-map-js` | high | [source-map-js allows event-loop denial of service through indexed source-map section offsets](https://github.com/advisories/GHSA-68fv-2mgg-jv7q) | `>=1.2.2` |
| `@vue/server-renderer` | high | [@vue/server-renderer: XSS via missing CR in attribute-name blacklist](https://github.com/advisories/GHSA-g2v6-rqmx-r4w6) | `>=3.5.42` |
| `vite` | moderate | [launch-editor: escapeCmdArgs() omits % escaping on Windows](https://github.com/advisories/GHSA-698v-4r3x-3vcv) | `>=6.4.4` |
| `vite` | moderate | [launch-editor: Editor CLI flag misinterpretation causing arbitrary command execution for some editors](https://github.com/advisories/GHSA-r825-w8mm-5pxw) | `>=6.4.4` |
| `vite` | high | [launch-editor: fs.existsSync() existence check can be bypassed on Windows](https://github.com/advisories/GHSA-587h-7wmj-h5pm) | `>=6.4.4` |
| `vite` | low | [Vite: Cross origin script execution through Vite custom middleware](https://github.com/advisories/GHSA-9jrq-w75r-8gcw) | `>=6.4.4` |
| `vite` | moderate | [Vite: Files outside server.fs.allow could be served when project paths match system paths on non-Windows machine](https://github.com/advisories/GHSA-rq7h-c2jc-7f22) | `>=6.4.4` |
| `body-parser` | high | [body-parser vulnerable to Denial of Service via trailing bytes after a compressed request body](https://github.com/advisories/GHSA-27r3-jxmh-p828) | `>=1.20.9` |
| `postcss-selector-parser` | moderate | [PostCSS: Quadratic complexity in flat selector parsing allows CPU exhaustion](https://github.com/advisories/GHSA-rj75-hqrm-r3gf) | `>=6.1.5` |
| `vite` | moderate | [vite: server.fs.deny bypass on Windows alternate paths](https://github.com/advisories/GHSA-fx2h-pf6j-xcff) | `>=6.4.3` |
| `@intlify/core-base` | low | [Vue I18n: escapeParameter does not escape named values when the same call also passes a list](https://github.com/advisories/GHSA-8rc2-428q-7ww3) | `>=11.4.14` |
| `vue-i18n` | low | [Vue I18n: escapeParameter does not escape named values when the same call also passes a list](https://github.com/advisories/GHSA-8rc2-428q-7ww3) | `>=11.4.14` |
| `@intlify/shared` | high | [Vue I18n: escapeParameter does not prevent XSS through srcdoc in translation messages](https://github.com/advisories/GHSA-83rm-6c8r-g728) | 未提供 |
| `@intlify/core-base` | high | [Vue I18n: escapeParameter does not prevent XSS through srcdoc in translation messages](https://github.com/advisories/GHSA-83rm-6c8r-g728) | 未提供 |
| `vue-i18n` | high | [Vue I18n: escapeParameter does not prevent XSS through srcdoc in translation messages](https://github.com/advisories/GHSA-83rm-6c8r-g728) | 未提供 |
| `qs` | moderate | [qs : qs.stringify with arrayFormat 'comma' throws an uncaught TypeError on array elements carrying a non-callable own toString (DoS)](https://github.com/advisories/GHSA-6pq8-jhm2-2vcw) | `>=6.16.1` |
| `glob` | moderate | [Glob: AbortSignal cancellation bypass allows post-timeout filesystem traversal](https://github.com/advisories/GHSA-3g3m-2fjr-6pw4) | `>=14.0.2` |
| `minimatch` | moderate | [minimatch has potential denial of service via globparts amplification](https://github.com/advisories/GHSA-g3hv-75wg-m249) | `>=11.0.1` |

未跨越上述父包约束做全局覆盖。后续优先跟踪 DCloud 新正式版、ESLint 和 repoctl 上游更新；配套升级后重新执行五端构建、HMR 与真实运行时验证。

原始审计位于 `packages/template/.hmr-artifacts/upgrade-2026-11-12/audit-before.json` 和 `audit-final.json`；完整逐项路径复核为同目录 `audit-review.json`。日志不提交，也不进入生成模板。

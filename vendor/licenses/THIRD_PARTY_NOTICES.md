# 第三方组件

应用代码为 MIT。以下组件保持独立，适用各自许可；模型许可全文和归属在 `vendor/models/`，依赖许可和来源在 `vendor/licenses/`，均随安装包保留。具体版本以 `package-lock.json` 为准。

| 组件 | 许可 | 上游及源码 |
| --- | --- | --- |
| Electron | MIT，附 Chromium notices | https://github.com/electron/electron （安装包包含 LICENSE、LICENSES.chromium.html） |
| sharp 0.35.5 | Apache-2.0 | https://github.com/lovell/sharp/tree/v0.35.5 |
| libvips 及预编译依赖 | LGPL-3.0 等 | https://github.com/libvips/libvips ，https://github.com/lovell/sharp-libvips （构建脚本及各依赖版本在其源码中，随包 notices 列出各库许可） |
| onnxruntime-node 1.24.3 | MIT | https://github.com/microsoft/onnxruntime/tree/v1.24.3 |
| heic-decode 2.1.0 | ISC（上游 package.json 声明） | https://github.com/catdad-experiments/heic-decode （仅作为 libheif-js 的调用封装，上游未附独立许可文本） |
| libheif-js 1.23.5 | LGPL-3.0 | https://github.com/catdad-experiments/libheif-js （Emscripten 构建流程在 scripts/，未修改该库） |
| libheif / HEVC 解码组件 | LGPL-3.0 等，依各组件 | https://github.com/strukturag/libheif ，https://github.com/strukturag/libde265 |

LGPL 库保持为独立的 Node / WASM / 动态库文件，未把它们的代码改写为本项目的 MIT 代码。允许按其协议替换库以调试修改版本，不以应用条款限制为此进行的逆向工程。分发者需要履行对应源码及构建材料的提供义务；上述链接提供上游源码与构建流程，库版本和安装用包完整性见 lockfile。第三方商标与测试照片中的人物不为本软件背书。

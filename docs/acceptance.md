# 本地验收记录

日期：2026-10-16。环境：macOS arm64、Node 26.7.0、Electron 44.7.0。

- `node scripts/test-all.mjs`：22 项通过，输出见 `test-results.txt`。全程使用随仓库内置的测试图片和模型，没有调用在线推理。
- `npx electron scripts/screenshot.js`：主进程、沙盒 preload、renderer 和工作线程联调通过；验证未知底色留空、缺规格报错，再实际生成并校验输出，截图为 `screenshot.png`。
- 本地 electron-builder mac-arm64 `--publish never` 打包检查通过。
- `npx electron scripts/test-packaged.cjs`：从打包后的 `app.asar` 启动工作线程，实际处理 PNG 和 HEIC，通过尺寸与大小校验。证明 ONNX、sharp 原生库、HEIC WASM 和 extraResources 模型路径可以协作。

测试图片为 NASA 公有领域人像；这组测试只能证明这些夹具和代码边界，不代表复杂发丝、侧脸和所有报名系统都能通过。自动裁剪依据人脸框估算头顶，最终照片仍需用户查看。

模型商用许可依据官方声明；MODNet 权重从已固定提交的社区导出镜像下载，不能声称已与官方 Drive 文件逐字节核对，详见 `vendor/models/manifest.json`。

GitHub 的 Test 工作流在 main 推送后检查 macOS arm64 与 Windows x64，并在两平台执行安装包内真实推理。Release 工作流只在版本 tag 上发布；此次未创建或推送任何 tag。

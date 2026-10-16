# 内置离线模型

两个 ONNX 文件实际随应用打包；运行期间不下载模型、不联网推理。`node scripts/verify-models.mjs` 检查大小及 SHA-256，`manifest.json` 记录固定版本来源。

- **MODNet 人像抠图**：上游 [ZHKKKe/MODNet](https://github.com/ZHKKKe/MODNet/tree/28165a451e4610c9d77cfdf925a94610bb2810fb)。上游 README 的 License 段明确将代码、模型和演示纳入 **Apache-2.0**，允许商业使用，许可原文随包保留。官方 ONNX 文档链接至 Google Drive。本次该下载地址无法连接，故使用固定提交的 [HarxSan/Modnet 社区镜像](https://github.com/HarxSan/Modnet/tree/8c6f9df04c2dcc2cef63aeb8f84ccd1764685d51)，镜像说明其使用官方权重及导出脚本；不能声称已与 Google Drive 文件逐字节对照。镜像 README 中“官方不发布预导出 ONNX”的表述与官方 ONNX 文档不一致，保留该文件仅作镜像来源记录，以官方文档为准。
- **YuNet 人脸检测**：来自 [OpenCV Zoo 固定提交](https://github.com/opencv/opencv_zoo/tree/47534e27c9851bb1128ccc0102f1145e27f23f98/models/face_detection_yunet)，文件 `face_detection_yunet_2023mar.onnx` 在本项目命名为 `yunet.onnx`。模型目录 **MIT** 许可，允许商业使用，原版权及许可文本随包保留。

## 输入与输出

已用 `onnxruntime-node` 实际打开两个模型，确认以下接口。

MODNet：`input` 为 float32 NCHW RGB，形状 `[batch_size, 3, height, width]`，尺寸应为 32 的倍数；按官方推理脚本以 `(v - 127.5) / 127.5` 归一化。输出 `output` 为 `[batch_size, 1, height, width]` 的前景 alpha。应用将长边缩至约 512、短边取 32 的倍数，保持比例后推理，再将 alpha 还原到原处理尺寸。

YuNet：`input` 为 `[1,3,640,640]` float32 NCHW BGR，像素原值 0–255；输出为步长 8/16/32 的 `cls_*`、`obj_*`、`bbox_*`、`kps_*`，供本地解码及 NMS 使用。

本目录保留上游许可、README 和推理示例以便核查；其中 Python 示例仅用于来源记录，不被桌面应用执行。

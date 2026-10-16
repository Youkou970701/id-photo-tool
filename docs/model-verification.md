# MODNet 权重官方来源核对（2026-10-16，Claude）

用户从 MODNet 官方 ONNX 文档（`onnx/README.md`）给的 Google Drive 链接手动下载了权重，Claude 在本机做了对比。

- 下载来源（macOS 下载元数据 `kMDItemWhereFroms`）：`https://drive.usercontent.google.com/download?id=1cgycTQlYXpTh26gB9FTnthE7AvruV8hd`，文件 ID 与官方文档链接一致
- 官方文件 SHA-256：`07c308cf0fc7e6e8b2065a12ed7fc07e1de8febb7dc7839d7b7f15dd66584df9`，25,888,640 字节
- 仓库 `vendor/models/modnet.onnx`：SHA-256 相同，`cmp` 逐字节相同

结论：随包的 MODNet 权重就是官方 Drive 上的文件。社区镜像只是当时的下载渠道，内容没有被改动。
`manifest.json` 和 `vendor/models/README.md` 里「无法与 Google Drive 文件逐字节核对」的说明可以更新为「已核对一致」。

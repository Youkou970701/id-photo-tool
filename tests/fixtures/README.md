# 测试图片来源

本目录只包含公开授权的测试图，不包含用户照片。文件随仓库提供，测试无需联网下载。

## astronaut.png

- 内容：NASA 宇航员 Eileen Collins，512 × 512 像素，RGB PNG。
- 下载来源：[scikit-image v0.24.0 固定版本](https://raw.githubusercontent.com/scikit-image/scikit-image/v0.24.0/skimage/data/astronaut.png)。
- 上游来源：NASA Great Images 数据库，见 [NASA 原图记录](https://flic.kr/p/r9qvLn)。
- 授权依据：[scikit-image 官方数据文档](https://scikit-image.org/docs/stable/api/skimage.data.html#skimage.data.astronaut)将此图注明为无已知版权限制、已进入公有领域。此处仅作为软件测试输入；不暗示 NASA 或照片人物为本软件背书。
- SHA-256：`88431cd9653ccd539741b555fb0a46b61558b301d4110412b5bc28b5e3ea6cb5`。

## astronaut.heic

- 内容：上述 PNG 经 macOS `sips` 转换得到的真实 HEIC/HEVC 图片，512 × 512 像素。
- 生成命令：`sips -s format heic astronaut.png --out astronaut.heic`。
- 来源及图片授权同上；用于验证真实 HEIC 输入解码，文件后缀并非伪装。
- SHA-256：`cf626d89b4e9ad10a407d048514dd6e0d1f01819fb0b4945c07defa8d9b6a3b5`。

测试可以在内存或临时目录中从这张公开图片生成竖图、横图、多人拼图、透明图和超大图，避免额外引入未知授权素材。

import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const defaultDirectory = fileURLToPath(new URL('../vendor/models/', import.meta.url));

/** Verify bundled bytes; never contacts a network or attempts a model download. */
export async function verifyModels(directory = defaultDirectory) {
  const manifest = JSON.parse(await readFile(path.join(directory, 'manifest.json'), 'utf8'));
  if (!Array.isArray(manifest.models) || manifest.models.length !== 2) {
    throw new Error('模型清单无效：需要两个人像处理模型。');
  }
  for (const model of manifest.models) {
    if (!['yunet.onnx', 'modnet.onnx'].includes(model.file) || !/^[a-f0-9]{64}$/.test(model.sha256)) {
      throw new Error('模型清单包含无效文件名或 SHA-256。');
    }
    const filename = path.join(directory, model.file);
    const info = await stat(filename);
    if (!info.isFile() || info.size !== model.bytes) throw new Error(`模型文件大小不匹配：${model.file}`);
    const hash = createHash('sha256');
    for await (const chunk of createReadStream(filename)) hash.update(chunk);
    if (hash.digest('hex') !== model.sha256) throw new Error(`模型校验失败：${model.file}`);
    if (model.licenseFile) await stat(path.join(directory, model.licenseFile));
  }
  if (new Set(manifest.models.map(model => model.file)).size !== 2) throw new Error('模型清单包含重复文件。');
  return manifest;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  verifyModels(process.argv[2]).then(manifest => {
    console.log(`✓ ${manifest.models.length} 个内置 ONNX 模型大小、SHA-256 与许可文件校验通过`);
  }).catch(error => {
    console.error(error.message);
    process.exitCode = 1;
  });
}

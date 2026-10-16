import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { processPhoto } = require('../src/photo');
const [file, width, height, minKB, maxKB, background = '#ffffff'] = process.argv.slice(2);
if (!file || !maxKB) { console.error('用法：node scripts/test.mjs <照片> <宽> <高> <最小KB> <最大KB> [#底色]'); process.exitCode = 1; }
else {
  const result = await processPhoto(file, { width:+width,height:+height,minKB:+minKB,maxKB:+maxKB,background }, console.error);
  const {preview,...summary} = result; console.log(summary); if (!result.ok) process.exitCode=1;
}

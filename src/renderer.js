'use strict';
const $ = (id) => document.getElementById(id);
const numericFields = ['width', 'height', 'minKB', 'maxKB'];
let file = null, output = null, busy = false, selection = 0, presets = [];
function status(text, type = '') { $('status').textContent = text; $('status').className = type; }
function setBusy(value) {
  busy = value;
  ['drop', 'preset', ...numericFields, 'background', 'background-picker'].forEach((id) => { $(id).disabled = value; });
  $('process').disabled = value || !file;
}
function clearOutput() {
  output = null; $('reveal').hidden = true; $('output-image').hidden = true;
  $('output-image').removeAttribute('src'); $('output-placeholder').hidden = false; $('output-placeholder').textContent = '生成后显示结果'; $('output-name').textContent = '';
}
async function choose(path) {
  if (!path || busy) return;
  const token = ++selection;
  file = null; clearOutput(); setBusy(true);
  $('input-image').hidden = true; $('input-placeholder').hidden = false;
  $('input-name').textContent = path.split(/[\\/]/).pop();
  status('读取照片…');
  try {
    const preview = await api.preview(path);
    if (token !== selection) return;
    if (typeof preview !== 'string' || !preview.startsWith('data:image/')) throw new Error('无法读取照片预览，请检查图片格式。');
    $('input-image').src = preview; $('input-image').hidden = false; $('input-placeholder').hidden = true;
    file = path; status('照片已就绪，请确认规格后生成。');
  } catch (error) { status(error.message || '读取照片失败。', 'bad'); }
  finally { if (token === selection) setBusy(false); }
}
$('drop').addEventListener('click', async () => {
  if (busy) return;
  try { await choose(await api.pick()); } catch (error) { status(error.message || '选择照片失败。', 'bad'); }
});
['dragover', 'dragenter'].forEach((type) => addEventListener(type, (event) => {
  event.preventDefault(); if (!busy) $('drop').classList.add('over');
}));
['dragleave', 'drop'].forEach((type) => addEventListener(type, (event) => { event.preventDefault(); $('drop').classList.remove('over'); }));
addEventListener('drop', async (event) => {
  if (busy) return;
  const files = Array.from(event.dataTransfer.files);
  if (files.length !== 1) { status('请一次只拖入一张照片。', 'bad'); return; }
  try { await choose(api.pathOf(files[0])); } catch (error) { status(error.message || '读取拖入文件失败。', 'bad'); }
});
$('preset').addEventListener('change', () => {
  clearOutput();
  const preset = presets[Number($('preset').value)];
  if ($('preset').value === '' || !preset) { $('preset-note').textContent = '请按报名公告填写要求。1 KB = 1024 字节。'; return; }
  numericFields.forEach((key) => { $(key).value = preset[key] ?? ''; });
  const bg = preset.background;
  const knownBackground = typeof bg === 'string' && /^#[\da-f]{6}$/i.test(bg);
  $('background').value = knownBackground ? bg : '';
  if (knownBackground) $('background-picker').value = bg;
  const incomplete = numericFields.some((key) => preset[key] == null) || !bg;
  $('preset-note').textContent = `${incomplete ? '该预设规格未核实，请根据官方公告自行填写并确认底色。' : '请核对本次报名公告，公告要求优先。'}${preset.note ? ` ${preset.note}` : ''}${preset.source ? ` 官方来源：${preset.source}` : ' 暂无可核实的官方来源。'} 1 KB = 1024 字节。`;
});
[...numericFields, 'background'].forEach((id) => $(id).addEventListener('input', clearOutput));
$('background').addEventListener('input', () => {
  if (/^#[\da-f]{6}$/i.test($('background').value.trim())) $('background-picker').value = $('background').value.trim();
});
function usePickerColor() {
  $('background').value = $('background-picker').value; clearOutput();
}
$('background-picker').addEventListener('input', usePickerColor);
// 点击色块即显式采用当前颜色；选中相同白色时原生控件可能不触发 input。
$('background-picker').addEventListener('click', usePickerColor);
api.onProgress((stage) => { if (busy) status(typeof stage === 'string' ? stage : '正在处理…'); });
$('process').addEventListener('click', async () => {
  if (busy || !file) return;
  clearOutput();
  const options = Object.fromEntries(numericFields.map((id) => [id, Number($(id).value)]));
  if (numericFields.some((id) => $(id).value.trim() === '') || !Number.isInteger(options.width) || !Number.isInteger(options.height) || options.width < 1 || options.height < 1 || !Number.isFinite(options.minKB) || !Number.isFinite(options.maxKB) || options.minKB < 0 || options.maxKB <= 0 || options.minKB > options.maxKB) {
    status('请填写完整规格：宽高为正整数，大小上限大于 0，下限不能大于上限。', 'bad'); return;
  }
  options.background = $('background').value.trim();
  if (!/^#[\da-f]{6}$/i.test(options.background)) {
    status('请选择底色，或填写 #RRGGBB 格式的颜色（如 #ffffff）。', 'bad'); return;
  }
  setBusy(true); status('开始处理…');
  try {
    const result = await api.process({ file, options });
    if (!result || !result.ok || !result.output) throw new Error(result?.note || '生成失败，未得到符合要求的文件。');
    if (!Number.isFinite(result.bytes) || result.bytes < Math.ceil(options.minKB * 1024) || result.bytes > Math.floor(options.maxKB * 1024) || result.width !== options.width || result.height !== options.height) throw new Error('输出规格校验失败，不能将此结果视为成功。');
    output = result.output;
    let preview = result.preview;
    try { if (!preview) preview = await api.preview(output); } catch { /* The saved file remains available when preview fails. */ }
    if (typeof preview === 'string' && preview.startsWith('data:image/')) { $('output-image').src = preview; $('output-image').hidden = false; $('output-placeholder').hidden = true; }
    else $('output-placeholder').textContent = '文件已保存，预览不可用';
    $('output-name').textContent = output.split(/[\\/]/).pop(); $('reveal').hidden = false;
    status(`已保存：${result.width} × ${result.height} 像素，${(result.bytes / 1024).toFixed(2)} KB（${result.bytes} 字节）。${result.note ? `\n${result.note}` : ''}`, 'ok');
  } catch (error) { status(error.message || '生成失败，请调整规格后重试。', 'bad'); }
  finally { setBusy(false); }
});
$('reveal').addEventListener('click', async () => {
  if (output) try { await api.reveal(output); } catch (error) { status(error.message || '无法打开文件所在位置。', 'bad'); }
});
(async () => {
  try {
    const data = await api.presets(); presets = Array.isArray(data) ? data : data.presets || [];
    presets.forEach((preset, index) => { const option = document.createElement('option'); option.value = String(index); option.textContent = preset.name || preset.id || `预设 ${index + 1}`; $('preset').appendChild(option); });
  } catch { $('preset-note').textContent = '预设加载失败，请按官方公告自定义规格。1 KB = 1024 字节。'; }
})();

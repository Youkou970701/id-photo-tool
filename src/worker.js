const { parentPort, workerData } = require('node:worker_threads');
const { processPhoto, previewPhoto } = require('./photo');
(async () => {
  const result = workerData.task === 'preview' ? await previewPhoto(workerData.file)
    : await processPhoto(workerData.file, workerData.options, stage => parentPort.postMessage({ stage }));
  parentPort.postMessage({ result });
})().catch(e => parentPort.postMessage({ error: e.message }));

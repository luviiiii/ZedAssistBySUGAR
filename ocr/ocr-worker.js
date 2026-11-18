/* ZED Assist - OCR worker.
 * A very small wrapper around the Tesseract WebAssembly core (vendor/tesseract-core-lstm.wasm.js) and the
 * English language data (vendor/eng.traineddata). Everything runs inside the browser: nothing is uploaded. */
/* global TesseractCore */
importScripts('../vendor/tesseract-core-lstm.wasm.js');

let mod = null;
let api = null;
let initPromise = null;

async function init(dataUrl) {
  mod = await TesseractCore({ TesseractProgress() {} });
  const res = await fetch(dataUrl);
  if (!res.ok) throw new Error('could not load eng.traineddata');
  mod.FS.writeFile('./eng.traineddata', new Uint8Array(await res.arrayBuffer()));
  api = new mod.TessBaseAPI();
  const status = api.Init(null, 'eng', 1 /* LSTM only */);
  if (status === -1) throw new Error('Tesseract init failed');
  api.SetVariable('user_defined_dpi', '300');
}

self.onmessage = async (e) => {
  const { id, type } = e.data;
  try {
    if (type === 'init') {
      initPromise = initPromise || init(e.data.dataUrl);
      await initPromise;
      self.postMessage({ id, ok: true });
      return;
    }
    if (type === 'recognize') {
      await initPromise;
      api.SetVariable('tessedit_pageseg_mode', String(e.data.psm || 6));
      api.SetVariable('tessedit_char_whitelist', e.data.whitelist || '');
      mod.FS.writeFile('/input', new Uint8Array(e.data.png));
      if (api.SetImageFile(1, 0) === 1) throw new Error('could not read image');
      api.Recognize(null);
      const text = api.GetUTF8Text();
      const conf = api.MeanTextConf();
      self.postMessage({ id, ok: true, text, conf });
      return;
    }
    throw new Error('unknown message ' + type);
  } catch (err) {
    self.postMessage({ id, ok: false, error: String((err && err.message) || err) });
  }
};

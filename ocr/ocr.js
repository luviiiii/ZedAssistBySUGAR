/* ZED Assist - reading the geo-stamp from a rendered page / image (browser only).
 * Needs: lib/stamp.js (ZA.parseStamp) loaded first. */
(function (root) {
  const ZA = (root.ZA = root.ZA || {});

  class OcrEngine {
    /** @param base  URL of the extension root ending in "/" (chrome.runtime.getURL('') or the page's folder) */
    constructor(base) {
      this.base = base;
      this.worker = null;
      this.nextId = 1;
      this.pending = new Map();
    }

    _call(msg, transfer) {
      return new Promise((resolve, reject) => {
        const id = this.nextId++;
        this.pending.set(id, { resolve, reject });
        this.worker.postMessage(Object.assign({ id }, msg), transfer || []);
      });
    }

    async init() {
      if (this.ready) return this.ready;
      this.worker = new Worker(this.base + 'ocr/ocr-worker.js');
      this.worker.onmessage = (e) => {
        const p = this.pending.get(e.data.id);
        if (!p) return;
        this.pending.delete(e.data.id);
        e.data.ok ? p.resolve(e.data) : p.reject(new Error(e.data.error));
      };
      this.worker.onerror = (e) => { this.pending.forEach((p) => p.reject(new Error(e.message || 'worker error'))); this.pending.clear(); };
      this.ready = this._call({ type: 'init', dataUrl: this.base + 'vendor/eng.traineddata' });
      return this.ready;
    }

    async recognize(canvas, opts) {
      await this.init();
      const blob = await new Promise((r) => canvas.toBlob(r, 'image/png'));
      const png = await blob.arrayBuffer();
      return this._call({ type: 'recognize', png, psm: (opts && opts.psm) || 6, whitelist: (opts && opts.whitelist) || '' }, [png]);
    }

    terminate() { if (this.worker) this.worker.terminate(); this.worker = null; this.ready = null; }
  }

  // ---- canvas helpers ----------------------------------------------------------------------
  function makeCanvas(w, h) {
    const c = document.createElement('canvas');
    c.width = Math.max(1, Math.round(w));
    c.height = Math.max(1, Math.round(h));
    return c;
  }

  function rotateCanvas(src, deg) {
    if (!deg) return src;
    const swap = deg === 90 || deg === 270;
    const c = makeCanvas(swap ? src.height : src.width, swap ? src.width : src.height);
    const g = c.getContext('2d');
    g.translate(c.width / 2, c.height / 2);
    g.rotate((deg * Math.PI) / 180);
    g.drawImage(src, -src.width / 2, -src.height / 2);
    return c;
  }

  function crop(src, x, y, w, h) {
    const c = makeCanvas(w, h);
    c.getContext('2d').drawImage(src, x, y, w, h, 0, 0, c.width, c.height);
    return c;
  }

  /** Keep only strongly blue pixels (the stamp colour) as black on white, with a white border. */
  function blueMask(src, upscale) {
    const k = upscale || 1;
    const pad = 12;
    const base = makeCanvas(src.width * k, src.height * k);
    const bg = base.getContext('2d', { willReadFrequently: true });
    bg.imageSmoothingEnabled = true;
    bg.drawImage(src, 0, 0, base.width, base.height);
    const img = bg.getImageData(0, 0, base.width, base.height);
    const d = img.data;
    // Graded score instead of a hard cut-off: anti-aliased thin strokes are only faintly blue.
    // score = how much bluer the pixel is than its red/green; 0..~100 maps to white..black.
    const LOW = 14, GAIN = 4.2;
    for (let i = 0; i < d.length; i += 4) {
      const r = d[i], g = d[i + 1], b = d[i + 2];
      const s = b - Math.max(r, g);
      let v = 255 - (s - LOW) * GAIN;
      v = v < 0 ? 0 : v > 255 ? 255 : v;
      d[i] = d[i + 1] = d[i + 2] = v;
      d[i + 3] = 255;
    }
    const out = makeCanvas(base.width + pad * 2, base.height + pad * 2);
    const og = out.getContext('2d');
    og.fillStyle = '#fff';
    og.fillRect(0, 0, out.width, out.height);
    og.putImageData(img, pad, pad);
    return out;
  }

  const STAMP_CHARS = '0123456789.,:-ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz ';

  /** Split the prepared (black text on white) image into its text lines using the row-darkness profile. */
  function splitLines(mask) {
    const w = mask.width, h = mask.height;
    const d = mask.getContext('2d', { willReadFrequently: true }).getImageData(0, 0, w, h).data;
    const dark = new Array(h).fill(0);
    for (let y = 0; y < h; y++) {
      let n = 0;
      for (let x = 0; x < w; x++) if (d[(y * w + x) * 4] < 110) n++;
      dark[y] = n;
    }
    const thr = Math.max(3, w * 0.006);
    let runs = [], start = -1;
    for (let y = 0; y <= h; y++) {
      const on = y < h && dark[y] > thr;
      if (on && start < 0) start = y;
      if (!on && start >= 0) { runs.push([start, y - 1]); start = -1; }
    }
    // merge runs separated by a tiny gap (the dots of i/j, accents, ':' etc.)
    const heights = runs.map((r) => r[1] - r[0] + 1).sort((a, b) => a - b);
    const med = heights.length ? heights[Math.floor(heights.length / 2)] : 0;
    const merged = [];
    runs.forEach((r) => {
      const last = merged[merged.length - 1];
      if (last && r[0] - last[1] < med * 0.3) last[1] = r[1]; else merged.push(r.slice());
    });
    const maxH = Math.max(0, ...merged.map((r) => r[1] - r[0] + 1));
    const keep = merged.filter((r) => r[1] - r[0] + 1 >= maxH * 0.4);
    return keep.map(([a, b]) => {
      const pad = Math.round((b - a + 1) * 0.35) + 6;
      const y0 = Math.max(0, a - pad), y1 = Math.min(h - 1, b + pad);
      return crop(mask, 0, y0, w, y1 - y0 + 1);
    });
  }

  /**
   * Read the stamp from a canvas holding a whole rendered page or photo.
   * @param opts {roi:{x,y,w,h}|null, rotations:[0,90,270,180], hint:{lat,lon}}
   * @returns {parsed fields..., rotation, roiUrl}
   */
  async function readStamp(engine, canvas, opts) {
    const o = opts || {};
    const rotations = o.rotations || [0, 90, 270, 180];
    let best = null;
    for (const rot of rotations) {
      const c = rotateCanvas(canvas, rot);
      const r = o.roi
        ? o.roi
        : { x: 0, y: 0, w: Math.round(c.width * 0.5), h: Math.max(120, Math.round(c.height * 0.2)) };
      const roi = crop(c, r.x, r.y, Math.min(r.w, c.width - r.x), Math.min(r.h, c.height - r.y));
      const scale = roi.width < 500 ? 4 : roi.width < 900 ? 3 : roi.width < 1400 ? 2 : 1;
      const mask = blueMask(roi, scale);

      // 1) line by line (single-line mode is much more accurate for numbers)
      let text = '', conf = 0;
      const lines = splitLines(mask);
      if (lines.length >= 2 && lines.length <= 6) {
        const out = [];
        for (const ln of lines) { const res = await engine.recognize(ln, { psm: 7, whitelist: STAMP_CHARS }); out.push(res.text.trim()); conf += res.conf; }
        text = out.join('\n'); conf /= lines.length;
      }
      let parsed = text ? ZA.parseStamp(text, { hint: o.hint }) : null;
      // 2) fall back to the whole block
      if (!parsed || !parsed.ok) {
        const res = await engine.recognize(mask, { psm: 6, whitelist: STAMP_CHARS });
        const p2 = ZA.parseStamp(res.text, { hint: o.hint });
        if (!parsed || p2.problems.length < parsed.problems.length) { parsed = p2; conf = res.conf; }
      }
      parsed.rotation = rot;
      parsed.conf = conf;
      if (!best || parsed.problems.length < best.problems.length) { best = parsed; best.roiUrl = roi.toDataURL('image/jpeg', 0.7); }
      if (parsed.ok) break;
    }
    return best;
  }

  ZA.OcrEngine = OcrEngine;
  ZA.readStamp = readStamp;
  ZA._canvas = { rotateCanvas, crop, blueMask, makeCanvas };
})(typeof self !== 'undefined' ? self : this);

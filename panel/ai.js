/* ZED Assist - optional AI eyes. Sends the clause's photos/pages to the Claude API (YOUR key, from the
 * browser) and gets back answers for the checklist. It only answers questions; rules and remarks stay in
 * lib/*.js. Anything it is unsure about comes back as null and Autopilot pauses on that clause. */
(function () {
  const ENDPOINT = 'https://api.anthropic.com/v1/messages';


  /** One request to the model. Model names starting with "gemini" use Google's free-tier API, anything else uses Claude. */
  let resolved = null; // model chosen automatically for this key
  const modelCache = {};
  async function listGeminiModels(apiKey) {
    if (modelCache[apiKey]) return modelCache[apiKey];
    const r = await fetch('https://generativelanguage.googleapis.com/v1beta/models?pageSize=200', { headers: { 'x-goog-api-key': apiKey } });
    if (!r.ok) return [];
    const d = await r.json();
    const ok = (d.models || []).filter((m) => (m.supportedGenerationMethods || []).includes('generateContent') && /flash/i.test(m.name) && !/(image|tts|live|audio|embed|robot|thinking|exp|vision|computer|omni|cyber)/i.test(m.name));
    const ver = (n) => { const v = (n.match(/(\d+(?:\.\d+)?)/) || [0, 0])[1]; return parseFloat(v); };
    // newest plain flash first, then flash-lite, then the rest
    return (modelCache[apiKey] = ok.map((m) => m.name.replace(/^models\//, '')).sort((a, b) => (/lite/.test(b) - /lite/.test(a)) || (/preview/.test(a) - /preview/.test(b)) || ver(b) - ver(a)));
  }
  // The free tier allows only a few requests per minute: keep a gap between calls and retry politely when told to wait.
  let lastCall = 0, ai503Wait = 0;
  const sleepMs = (ms) => new Promise((r) => setTimeout(r, ms));
  async function geminiOnce(apiKey, model, images, prompt, maxTokens, temperature, schema) {
    for (let attempt = 0; ; attempt++) {
      const wait = lastCall + 3000 - Date.now();
      if (wait > 0) await sleepMs(wait);
      lastCall = Date.now();
      try { return await geminiRaw(apiKey, model, images, prompt, maxTokens, temperature, schema); }
      catch (e) {
        if (e.quota && !e.noFree && attempt < 2) { await sleepMs(20000 + attempt * 20000); continue; }
        if (e.status >= 500 && attempt < 3) { await sleepMs((ai503Wait || 5000) * (attempt + 1)); continue; }   // "high demand" (503): usually passes within seconds
        throw e;
      }
    }
  }
  async function geminiRaw(apiKey, model, images, prompt, maxTokens, temperature, schema) {
    const parts = images.map((b64) => ({ inline_data: { mime_type: 'image/jpeg', data: b64 } }));
    parts.push({ text: prompt });
    const url = 'https://generativelanguage.googleapis.com/v1beta/models/' + encodeURIComponent(model) + ':generateContent';
    const res = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json', 'x-goog-api-key': apiKey },
      body: JSON.stringify({ contents: [{ parts }], generationConfig: Object.assign({ responseMimeType: 'application/json', temperature: temperature || 0, maxOutputTokens: maxTokens }, schema ? { responseSchema: schema } : {}) }) });
    if (res.status === 429) {
      const body = (await res.text()).replace(/\s+/g, ' ');
      const e = new Error('Free quota reached on ' + model + ' (HTTP 429): ' + body.slice(0, 160));
      e.quota = true; e.noFree = /limit:\s*0\b/.test(body); throw e;
    }
    if (res.status === 400 && schema) { return geminiRaw(apiKey, model, images, prompt, maxTokens, temperature, null); }
    if (!res.ok) { const e = new Error('AI request failed: HTTP ' + res.status + ' ' + (await res.text()).slice(0, 160)); e.status = res.status; throw e; }
    const d = await res.json();
    return ((d.candidates || [])[0]?.content?.parts || []).map((p) => p.text || '').join('');
  }
  /** One request to the model. Model names starting with "gemini" (or "auto") use Google's free-tier API, anything else uses Claude. */
  async function call({ apiKey, model, images, prompt, maxTokens, temperature, schema }) {
    if (/^(gemini|auto)/i.test(model)) {
      const wanted = /^auto/i.test(model) ? null : model;
      const cands = await listGeminiModels(apiKey);
      const order = [resolved, wanted, ...cands].filter((m, i, arr) => m && arr.indexOf(m) === i);
      if (!order.length) throw new Error('No Gemini model is available for this key. Check the key at aistudio.google.com/apikey');
      let last;
      for (const m of order.slice(0, 5)) {
        try { const t = await geminiOnce(apiKey, m, images, prompt, maxTokens, temperature, schema); resolved = m; return t; }
        catch (e) { last = e; if (!(e.quota || e.status === 404 || e.status === 400 || e.status >= 500)) throw e; }   // this model is not usable for free: try the next one
      }
      throw last;
    }
    const content = images.map((b64) => ({ type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: b64 } }));
    content.push({ type: 'text', text: prompt });
    const res = await fetch(ENDPOINT, { method: 'POST',
      headers: { 'content-type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01', 'anthropic-dangerous-direct-browser-access': 'true' },
      body: JSON.stringify({ model, max_tokens: maxTokens, messages: [{ role: 'user', content }] }) });
    if (!res.ok) throw new Error('AI request failed: HTTP ' + res.status + ' ' + (await res.text()).slice(0, 160));
    return ((await res.json()).content || []).map((p) => p.text || '').join('');
  }

  function noteLines(def) {
    return [
      def.code === 'SITE' ? 'Site exterior / name board: the board only has to show the unit name; an address on it is NOT required. But the board must look official and properly made (printed/painted/fixed), not a makeshift or handwritten sheet. If an address is shown it must match the address on record.' : '',
      def.code === '2.2' ? 'Rooms: working area (sign naming the area + working machines), toilet (sign on door; only the commode must be clean), raw material store (sign + raw input material), final product store (sign + the unit\'s OWN packaging: bags/boxes printed with the unit\'s name or brand). Own packaging is expected ONLY if the unit is a food-related business (decide this from the unit name, the product and the photos; answer the isFood key). If it is food-related and the final product store shows no packaging of the unit\'s own (plain/unbranded sacks, loose goods, or nothing), answer false for the packaging key. If it is NOT a food business, answer true for the packaging key.' : '',
      def.code === '3.2' ? 'Fire extinguisher slip: it may show both a "refilling date" (when it was last refilled) and a "refilling due date" (when the next refill is due). The input "feRefill" must be the DUE date (the later one). If only one date is shown, give that one. Handwriting is hard: if you are not sure of a digit, answer null instead of guessing.' : '',
      def.training ? 'This is a training record: the organisation name printed on it must equal the unit name on record; check topic, signatures and completeness.' : '',
    ].filter(Boolean).join('\n');
  }
  function toState(def, a) {
    const state = { checks: {}, inputs: {} };
    (def.checks || []).forEach((k) => { const v = a['check:' + k.id]; if (v === true || v === false) state.checks[k.id] = v; });
    (def.inputs || []).forEach((i) => {
      if (i.type === 'deliveryRows') state.inputs.rows = Array.isArray(a.rows) ? a.rows : [];
      else if (a['input:' + i.id]) state.inputs[i.id] = String(a['input:' + i.id]);
    });
    return state;
  }

  /** ONE request for the whole case: every photo/page plus the questions of every clause. Much faster than one call per clause. */
  function parseLoose(text) {
    const m = String(text).match(/\{[\s\S]*\}/);
    if (!m) throw new Error('AI gave no JSON');
    try { return JSON.parse(m[0]); } catch (e) { /* try a light repair */ }
    const fixed = m[0].replace(/,\s*([}\]])/g, '$1').replace(/([}\]"\d]|null|true|false)(\s*\n\s*")/g, '$1,$2');
    return JSON.parse(fixed);
  }

  async function askAll({ apiKey, model, c, items, defs, hints }) {
    const need = defs.filter((d) => (!d.nonNC && !d.alwaysYes) || d.code === '6.2');
    const idx = {};
    items.forEach((it, i) => { (idx[it.code] = idx[it.code] || []).push(i + 1); });
    const locCodes = new Set(defs.filter((d) => d.location).map((d) => d.code));
    const stampIdx = items.map((it, i) => (locCodes.has(it.code) ? i + 1 : null)).filter(Boolean);
    const blocks = need.map((d) => {
      const imgs = d.code === '6.2' ? [...(idx['6.2'] || []), ...(idx['6.3'] || []), ...(idx['7.1'] || [])] : (idx[d.code] || []);
      return `### Clause ${d.code} - ${d.title}\nUse image numbers: ${imgs.length ? imgs.join(', ') : 'NONE (answer every key with null)'}\n${noteLines(d)}\nanswers keys:\n${JSON.stringify(questionsFor(d, c), null, 1)}`;
    });
    const prompt = [
      'You are helping a ZED Bronze desktop assessor in India check MSME evidence. Be strict and literal; if something is not clearly visible answer null (never guess).',
      `Unit name on record: ${c.unitName}\nUnit address on record: ${c.unitAddress}\nToday: ${c.today}`,
      'The images, in order:', items.map((it, i) => `Image ${i + 1}: ${it.label} (clause ${it.code})`).join('\n'),
      `Geo-stamps: images ${stampIdx.join(', ') || '(none)'} may carry a blue stamp near the top-left with date, time, Lat and Long. Read each one exactly. The expected place is near lat ${c.refLat}, long ${c.refLon}; if the decimal point is hard to see, use that to place it, never invent digits. Use null when there is no stamp.`,
      blocks.join('\n\n'),
      hints || '',
      'Answer in the required JSON format. "stamps": one entry per image that has a stamp (image number, date as YYYY-MM-DD, lat, lon). "clauses": one entry per clause above with its code, "confidence" (high, medium or low), a one-sentence "notes", and "answers": a list of {key, value} using exactly the answer keys listed for that clause. For check keys the value is the text true or false, or null if you cannot tell. For the key "rows" the value is the JSON text of the list of orders. For other keys the value is the text exactly as written in the document, or null.',
    ].join('\n\n');
    let out = null, lastErr, lastText = '';
    for (let attempt = 0; attempt < 3 && !out; attempt++) {
      lastText = await call({ apiKey, model, images: items.map((it) => it.b64), prompt, maxTokens: 8000, temperature: attempt ? 0.4 : 0, schema: SCHEMA });
      try { out = parseLoose(lastText); } catch (e) { lastErr = e; }
    }
    if (!out) throw new Error('AI answer was not readable (' + (lastErr && lastErr.message) + ') near: ' + JSON.stringify(String(lastText).slice(0, 120)));
    return convert(out, need);
  }

  // structured output: the AI is forced to return exactly this shape, so the JSON is always valid
  const SCHEMA = { type: 'OBJECT', required: ['stamps', 'clauses'], properties: {
    stamps: { type: 'ARRAY', items: { type: 'OBJECT', required: ['image'], properties: { image: { type: 'INTEGER' }, date: { type: 'STRING', nullable: true }, lat: { type: 'NUMBER', nullable: true }, lon: { type: 'NUMBER', nullable: true } } } },
    clauses: { type: 'ARRAY', items: { type: 'OBJECT', required: ['code', 'answers'], properties: { code: { type: 'STRING' }, confidence: { type: 'STRING' }, notes: { type: 'STRING' },
      answers: { type: 'ARRAY', items: { type: 'OBJECT', required: ['key'], properties: { key: { type: 'STRING' }, value: { type: 'STRING', nullable: true } } } } } } } } };

  /** answers list [{key,value}] (or an old-style object) -> the flat object toState() expects */
  function flatAnswers(a) {
    if (!Array.isArray(a)) return a || {};
    const o = {};
    a.forEach((x) => {
      if (!x || !x.key) return;
      let v = x.value;
      if (/^check:/.test(x.key)) o[x.key] = /^true$/i.test(String(v)) ? true : /^false$/i.test(String(v)) ? false : undefined;
      else if (x.key === 'rows') { try { o.rows = JSON.parse(v); } catch (e) { o.rows = []; } }
      else o[x.key] = (v == null || /^null$/i.test(String(v)) || v === '') ? null : v;
    });
    return o;
  }
  function convert(out, need) {
    const byCode = {};
    if (Array.isArray(out.clauses)) out.clauses.forEach((r) => { if (r && r.code) byCode[r.code] = r; }); else Object.assign(byCode, out.clauses || {});
    const clauses = {};
    need.forEach((d) => { const r = byCode[d.code]; if (r) clauses[d.code] = { state: toState(d, flatAnswers(r.answers)), confidence: r.confidence || 'low', notes: r.notes || '' }; });
    const stamps = {};
    const list = Array.isArray(out.stamps) ? out.stamps.map((v) => [v && v.image, v]) : Object.entries(out.stamps || {});
    list.forEach(([k, v]) => { if (v && typeof v.lat === 'number' && typeof v.lon === 'number') stamps[+k] = { date: v.date || null, lat: v.lat, lon: v.lon }; });
    return { clauses, stamps };
  }

  function questionsFor(def, c) {
    const q = {};
    (def.checks || []).forEach((k) => { q['check:' + k.id] = k.label + ' (true / false / null if you cannot tell)'; });
    (def.inputs || []).forEach((i) => {
      if (i.type === 'deliveryRows') q['rows'] = 'list of orders, each {"order":"dd-mm-yy","dispatch":"dd-mm-yy","delivery":"dd-mm-yy"} exactly as written in the documents; [] if none';
      else q['input:' + i.id] = i.label + ' - exactly as written in the document, or null';
    });
    return q;
  }

  async function ask({ apiKey, model, def, c, images }) {
    const q = questionsFor(def, c);
    const prompt = [
      'You are helping a ZED Bronze desktop assessor in India check MSME evidence. Be strict and literal; if something is not clearly visible answer null (never guess).',
      `Unit name on record: ${c.unitName}\nUnit address on record: ${c.unitAddress}\nToday: ${c.today}`,
      `Clause ${def.code} - ${def.title}.`,
      def.code === '2.2' ? 'Rooms: working area (sign naming the area + working machines), toilet (sign on door; only the commode must be clean), raw material store (sign + raw input material), final product store (sign + the unit\'s OWN packaging: bags/boxes printed with the unit\'s name or brand). Own packaging is expected ONLY if the unit is a food-related business (decide this from the unit name, the product and the photos; answer the isFood key). If it is food-related and the final product store shows no packaging of the unit\'s own (plain/unbranded sacks, loose goods, or nothing), answer false for the packaging key. If it is NOT a food business, answer true for the packaging key.' : '',
      def.code === '3.2' ? 'Fire extinguisher slip: it may show both a "refilling date" (when it was last refilled) and a "refilling due date" (when the next refill is due). The input "feRefill" must be the DUE date (the later one). If only one date is shown, give that one. Handwriting is hard: if you are not sure of a digit, answer null instead of guessing.' : '',
      def.training ? 'This is a training record: the organisation name printed on it must equal the unit name on record; check topic, signatures and completeness.' : '',
      'Answer ONLY with JSON: {"answers": {...}, "confidence": "high"|"medium"|"low", "notes": "one short sentence"} where "answers" has exactly these keys:',
      JSON.stringify(q, null, 1),
    ].filter(Boolean).join('\n');
    const text = await call({ apiKey, model, images, prompt, maxTokens: 1200 });
    const m = text.match(/\{[\s\S]*\}/);
    if (!m) throw new Error('AI gave no JSON');
    const out = JSON.parse(m[0]);
    const state = { checks: {}, inputs: {} };
    const a = out.answers || {};
    (def.checks || []).forEach((k) => { const v = a['check:' + k.id]; if (v === true || v === false) state.checks[k.id] = v; });
    (def.inputs || []).forEach((i) => {
      if (i.type === 'deliveryRows') state.inputs.rows = Array.isArray(a.rows) ? a.rows : [];
      else if (a['input:' + i.id]) state.inputs[i.id] = String(a['input:' + i.id]);
    });
    return { state, confidence: out.confidence || 'low', notes: out.notes || '' };
  }

  /** Fallback when the local OCR cannot read a stamp: ask the model to read it (distance is still checked by code). */
  async function readStamp({ apiKey, model, image, hint }) {
    const prompt = 'This photo/page has a blue geo-location stamp (date, time, Lat, Long) printed near the top-left. Read it exactly. ' +
      `The expected area is near lat ${hint.lat}, long ${hint.lon}; if the decimal point is hard to see, use that to place it, but never invent digits. ` +
      'Answer ONLY with JSON: {"date":"YYYY-MM-DD" or null,"lat":number or null,"lon":number or null}';
    const text = await call({ apiKey, model, images: [image], prompt, maxTokens: 200 });
    const m = text.match(/\{[\s\S]*\}/); if (!m) return null;
    const o = JSON.parse(m[0]);
    return { date: o.date || null, lat: typeof o.lat === 'number' ? o.lat : null, lon: typeof o.lon === 'number' ? o.lon : null };
  }

  /** Checks a Gemini key: returns the model that will be used, or throws a readable error. */
  async function test(apiKey) {
    const r = await fetch('https://generativelanguage.googleapis.com/v1beta/models?pageSize=200', { headers: { 'x-goog-api-key': apiKey } });
    if (r.status === 400 || r.status === 403) throw new Error('This key was not accepted. Copy it again from aistudio.google.com/apikey');
    if (!r.ok) throw new Error('Could not reach Google AI (HTTP ' + r.status + ')');
    const m = await listGeminiModels(apiKey);
    if (!m.length) throw new Error('This key has no usable model');
    return m[0];
  }

  (typeof self !== 'undefined' ? self : this).ZA = Object.assign((typeof self !== 'undefined' ? self : this).ZA || {}, { ai: { ask, askAll, readStamp, test, _convert: convert, _flat: flatAnswers, _setWaits: (w) => { ai503Wait = w; } } });
})();

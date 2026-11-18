/* ZED Assist side panel. Proposes outcomes; the assessor confirms. Never touches Final Submit. */
(() => {
  const $ = (s) => document.querySelector(s);
  const h = (tag, attrs, ...kids) => {
    const e = document.createElement(tag);
    Object.entries(attrs || {}).forEach(([k, v]) => {
      if (k === 'class') e.className = v; else if (k.startsWith('on')) e.addEventListener(k.slice(2), v);
      else if (v !== false && v != null) e.setAttribute(k, v === true ? '' : v);
    });
    kids.flat().forEach((c) => { if (c != null && c !== false) e.append(c.nodeType ? c : document.createTextNode(String(c))); });
    return e;
  };
  const { CLAUSES, evaluateClause, getClause } = ZA;
  const DEF = { assessor: '', doneBy: '', url: '', secret: '', ok: 50, max: 100, today: '', auto: false, apiKey: '', model: 'auto', fillUncertain: true };
  let S = Object.assign({}, DEF);
  let tabId = null, C = null, engine = null;
  const EV = {};          // code -> [{label, thumb, roiUrl, stamp:{ok,lat,lon,date}}]
  const ST = {};          // code -> {checks, inputs, force, remark}
  const OVERRIDES = [];
  let LEARN = ZA.learn.blank();
  const loadLearn = async () => { try { const o = await chrome.storage.local.get('zl'); if (o.zl && o.zl.rules) LEARN = o.zl; } catch (e) { /* none */ } };
  const saveLearn = () => chrome.storage.local.set({ zl: LEARN });
  let lastResults = null, sheetState = { phone: '', serial: '', remarks: '' };

  /** plain-language versions of the technical errors */
  function friendly(t) {
    const m = String(t || '');
    if (/limit: 0|quota|429|RESOURCE_EXHAUSTED/i.test(m)) return 'The free AI is busy or its daily limit is used up. Wait a few minutes and press the button again.';
    if (/503|overloaded|high demand|UNAVAILABLE/i.test(m)) return 'The AI is very busy right now. Wait a minute and press the button again.';
    if (/API key|API_KEY_INVALID|401|403|PERMISSION/i.test(m)) return 'The AI key was not accepted. Open Advanced > Settings and paste your key again.';
    if (/not ready|Reload the case page|Open the case page/i.test(m)) return 'Please refresh the portal page (press F5) and press the button again.';
    if (/Failed to fetch|NetworkError|network/i.test(m)) return 'The internet seems to be off. Check it and try again.';
    return m;
  }
  const setStatus = (t, err) => {
    const s = $('#status'); s.textContent = err ? friendly(t) : (t || ''); s.className = 'status' + (err ? ' err' : '');
    const bar = $('#bar'), pr = /(\d+)\/(\d+)/.exec(t || '');
    if (bar) { bar.parentElement.hidden = !pr; if (pr) bar.style.width = Math.round(100 * pr[1] / Math.max(1, pr[2])) + '%'; }
  };
  const todayISO = () => S.today || (() => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; })();
  /** A stamp more than 300 km from the reference is a misread (or a photo with no stamp), never a real mismatch. */
  function plausible(st) {
    if (!st || st.lat == null || st.lon == null || !C || isNaN(C.refLat)) return st;
    const d = ZA.distanceMeters({ lat: C.refLat, lon: C.refLon }, { lat: st.lat, lon: st.lon });
    return d > 300000 ? { ok: false, lat: null, lon: null, date: st.date, misread: true } : st;
  }
  /** The safety training record is uploaded under 3.2 but is what clause 3.3 validates. */
  const evidenceCode = (code, label) => (code === '3.2' && /training/i.test(label || '') ? '3.3' : code);
  const state = (code) => (ST[code] = ST[code] || { checks: {}, inputs: {}, force: 'auto', remark: null });

  // ------------------------------------------------------------------ messaging
  async function activeTab() {
    const tabs = await chrome.tabs.query({ url: 'https://loginzed.msme.gov.in/Assessment/*' });
    const t = tabs.find((x) => x.active) || tabs[0];
    if (!t) throw new Error('Open the case page (Assessment) in a tab first.');
    tabId = t.id; return t.id;
  }
  async function send(msg) {
    const id = tabId || (await activeTab());
    try { return await chrome.tabs.sendMessage(id, msg); }
    catch (e) { tabId = null; throw new Error('The page is not ready. Reload the case page once and try again.'); }
  }
  const b64ToBytes = (b64) => { const bin = atob(b64); const u = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i); return u; };

  // ------------------------------------------------------------------ settings
  async function loadSettings() { const r = await chrome.storage.local.get('za'); S = Object.assign({}, DEF, r.za || {}); }
  function openSettings() {
    $('#sAssessor').value = S.assessor; $('#sDoneBy').value = S.doneBy; $('#sUrl').value = S.url; $('#sSecret').value = S.secret;
    $('#sToday').value = S.today; $('#sAuto').checked = !!S.auto; $('#sKey').value = S.apiKey; $('#sFill').checked = S.fillUncertain !== false; $('#sModel').value = S.model;
    $('#settings').showModal();
  }
  $('#sSave').addEventListener('click', async () => {
    S = { assessor: $('#sAssessor').value.trim(), doneBy: $('#sDoneBy').value.trim(), url: $('#sUrl').value.trim(), secret: $('#sSecret').value,
      today: $('#sToday').value.trim(), auto: $('#sAuto').checked, apiKey: $('#sKey').value.trim(), fillUncertain: $('#sFill').checked, model: $('#sModel').value.trim() || 'auto' };
    await chrome.storage.local.set({ za: S }); renderAll(); refreshUi();
  });
  $('#settingsBtn')?.addEventListener('click', openSettings);

  // ------------------------------------------------------------------ step 1: the case
  async function scan() {
    setStatus('Reading the case…');
    const r = await send({ action: 'getCase' });
    if (!r || !r.ok) throw new Error((r && r.error) || 'Could not read the page');
    C = r;
    if (!sheetState.serial) sheetState.serial = '';
    renderAll(); setStatus(`Read case ${C.zedId}. ${C.requirements.length} clauses, ${C.photos.length} photos.`);
  }

  // ------------------------------------------------------------------ step 2: evidence
  async function getEngine() {
    if (!engine) { engine = new ZA.OcrEngine(chrome.runtime.getURL('')); }
    return engine;
  }
  function canvasOf(img) { const c = document.createElement('canvas'); c.width = img.naturalWidth; c.height = img.naturalHeight; c.getContext('2d').drawImage(img, 0, 0); return c; }
  const thumbOf = (cv) => { const k = 160 / Math.max(cv.width, cv.height); const t = document.createElement('canvas'); t.width = Math.round(cv.width * k); t.height = Math.round(cv.height * k); t.getContext('2d').drawImage(cv, 0, 0, t.width, t.height); return t.toDataURL('image/jpeg', 0.6); };

  const bigOf = (cv) => { const k = Math.min(1, 1500 / Math.max(cv.width, cv.height)); const t = document.createElement('canvas'); t.width = Math.round(cv.width * k); t.height = Math.round(cv.height * k); t.getContext('2d').drawImage(cv, 0, 0, t.width, t.height); return t.toDataURL('image/jpeg', 0.8).split(',')[1]; };

  async function ocrItem(label, cv, wantStamp) {
    const item = { label, thumb: thumbOf(cv), big: bigOf(cv), stamp: { ok: false, lat: null, lon: null, date: null }, roiUrl: null };
    if (wantStamp) {
      try {
        const eng = await getEngine();
        // the stamp sits top-left of the photo, but the photo may fill only part of the page: widen step by step
        const W = cv.width, H = cv.height, rois = [
          { x: 0, y: 0, w: Math.round(W * 0.5), h: Math.round(H * 0.2) },
          { x: 0, y: 0, w: W, h: Math.round(H * 0.35) },
          { x: 0, y: 0, w: Math.round(W * 0.7), h: Math.round(H * 0.55) }];
        let st = null;
        for (const roi of rois) {
          const r = await ZA.readStamp(eng, cv, { roi, rotations: roi === rois[0] ? [0, 90, 270, 180] : [0], hint: { lat: C.refLat, lon: C.refLon } });
          if (!st || r.problems.length < st.problems.length) st = r;
          if (r.ok) break;
        }
        item.stamp = plausible({ ok: !!st.ok, lat: st.lat, lon: st.lon, date: st.date }); item.roiUrl = st.roiUrl;
      } catch (e) { item.err = String(e.message || e); }
    }
    return item;
  }

  async function loadDoc(url, label, wantStamp, onItem) {
    const f = await send({ action: 'fetch', url });
    if (!f || !f.ok) { onItem({ label, thumb: null, stamp: { ok: false }, err: 'Could not download (' + ((f && f.error) || '?') + ')' }); return; }
    const bytes = b64ToBytes(f.base64);
    const isPdf = /pdf/i.test(f.contentType) || (bytes[0] === 0x25 && bytes[1] === 0x50);
    if (isPdf) {
      pdfjsLib.GlobalWorkerOptions.workerSrc = chrome.runtime.getURL('vendor/pdf.worker.js');
      const pdf = await pdfjsLib.getDocument({ data: bytes, isEvalSupported: false }).promise;
      for (let p = 1; p <= Math.min(pdf.numPages, 15); p++) {
        const page = await pdf.getPage(p);
        const vp = page.getViewport({ scale: 3 });
        const cv = document.createElement('canvas'); cv.width = vp.width; cv.height = vp.height;
        await page.render({ canvasContext: cv.getContext('2d'), viewport: vp }).promise;
        onItem(await ocrItem(`${label} p${p}`, cv, wantStamp));
      }
    } else {
      const url2 = URL.createObjectURL(new Blob([bytes], { type: f.contentType || 'image/jpeg' }));
      const img = await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = () => rej(new Error('image failed')); i.src = url2; });
      onItem(await ocrItem(label, canvasOf(img), wantStamp)); URL.revokeObjectURL(url2);
    }
  }

  async function readEvidence() {
    if (!C) await scan();
    $('#evidence').disabled = true;
    try {
      const jobs = [];
      C.photos.forEach((p) => jobs.push({ code: /product/.test(p.kind) ? 'PRODUCT' : 'SITE', url: p.src, hrefAttr: p.src, label: p.label }));
      C.requirements.forEach((r) => r.evidences.forEach((e) => jobs.push({ code: evidenceCode(r.code, e.label), url: e.href, hrefAttr: e.hrefAttr, label: `${r.code} ${e.label}` })));
      Object.keys(EV).forEach((k) => delete EV[k]);
      let n = 0;
      for (const j of jobs) {
        n++; setStatus(`Reading ${n}/${jobs.length}: ${j.label}…`);
        await send({ action: 'markOpened', hrefAttr: j.hrefAttr });     // reveals the portal's Validate button
        const def = getClause(j.code);
        try {
          await loadDoc(j.url, j.label, !!(def && def.location), (it) => { (EV[j.code] = EV[j.code] || []).push(it); renderClause(j.code); });
        } catch (e) { (EV[j.code] = EV[j.code] || []).push({ label: j.label, thumb: null, stamp: { ok: false }, err: String(e.message || e) }); }
      }
      await scan(); setStatus('Documents read. Check each clause below, then fill.');
    } finally { $('#evidence').disabled = false; }
  }

  // ------------------------------------------------------------------ evaluation
  function ctxFor(code) {
    const def = getClause(code), ev = EV[code] || [];
    const ctx = { today: todayISO(), unitName: C && C.unitName, unitAddress: C && C.unitAddress, submissionDate: C && C.submissionDateISO };
    if (def.location && C && !isNaN(C.refLat)) {
      if (ev.length) ctx.location = ZA.checkLocation(ev.map((e) => ({ label: e.label, ok: e.stamp.ok && e.stamp.lat != null, lat: e.stamp.lat, lon: e.stamp.lon, date: e.stamp.date })),
        { lat: C.refLat, lon: C.refLon }, { submissionDate: C.submissionDateISO });
    }
    if (code === '3.2') ctx.serialDuplicate = !!state('3.2').dupe;
    return ctx;
  }
  function proposal(code) {
    const st = state(code), p = evaluateClause(code, st, ctxFor(code));
    let outcome = p.outcome, remark = st.remark != null ? st.remark : p.remark;
    if (st.force !== 'auto') {
      outcome = st.force;
      if (st.remark == null && st.force !== p.outcome && getClause(code).nonNC && st.force === 'no') { /* non-NC can never be No */ outcome = 'yes'; }
    }
    return { p, outcome, remark };
  }

  // ------------------------------------------------------------------ rendering
  function stampRow(code, i, e) {
    const s = e.stamp;
    const upd = (k) => (ev) => { const v = ev.target.value.trim(); s[k] = k === 'date' ? (v || null) : (v === '' ? null : parseFloat(v)); s.ok = s.lat != null && s.lon != null; renderClause(code); };
    let dist = '';
    if (C && s.lat != null && s.lon != null && !isNaN(C.refLat)) {
      const same = ZA.firstDecimals(s.lat) === ZA.firstDecimals(C.refLat) && ZA.firstDecimals(s.lon) === ZA.firstDecimals(C.refLon);
      dist = h('span', { class: 'badge ' + (same ? 'yes' : 'no') }, same ? 'location matches' : 'location differs');
    }
    return h('div', { class: 'stamp' },
      e.thumb ? h('img', { src: e.thumb }) : h('div'),
      h('div', {}, h('div', { class: 'small' }, e.label, e.err ? ' – ' + e.err : ''),
        e.roiUrl ? h('img', { class: 'roi', src: e.roiUrl }) : null,
        h('div', { class: 'f' }, h('input', { value: s.lat ?? '', placeholder: 'lat', onchange: upd('lat') }), h('input', { value: s.lon ?? '', placeholder: 'long', onchange: upd('lon') }),
          h('input', { value: s.date ?? '', placeholder: 'YYYY-MM-DD', onchange: upd('date') }), dist)));
  }

  function tri(code, id) {
    const st = state(code), v = st.checks[id];
    const set = (x) => () => { if (x === undefined) delete st.checks[id]; else st.checks[id] = x; renderClause(code); };
    return h('span', { class: 'tri' }, h('button', { class: v === true ? 'on' : '', onclick: set(true) }, 'OK'), ' ', h('button', { class: v === false ? 'on bad' : '', onclick: set(false) }, 'Not OK'), ' ', h('button', { onclick: set(undefined) }, '?'));
  }

  function inputEl(code, inp) {
    const st = state(code);
    if (inp.type === 'deliveryRows') {
      st.inputs.rows = st.inputs.rows || [{}, {}, {}];
      const t = h('table', { class: 'dr' }, h('tr', {}, h('td', { class: 'small' }, 'Order'), h('td', { class: 'small' }, 'Dispatch'), h('td', { class: 'small' }, 'Delivery')));
      st.inputs.rows.forEach((r) => t.append(h('tr', {}, ['order', 'dispatch', 'delivery'].map((k) => h('td', {}, h('input', { value: r[k] || '', placeholder: 'dd-mm-yy', onchange: (ev) => { r[k] = ev.target.value.trim(); renderClause(code); } }))))));
      return h('div', {}, h('div', { class: 'small' }, inp.label), t, h('button', { onclick: () => { st.inputs.rows.push({}); renderClause(code); } }, '+ row'));
    }
    return h('label', { class: 'small' }, inp.label, h('input', { value: st.inputs[inp.id] || '', onchange: (ev) => { st.inputs[inp.id] = ev.target.value.trim(); if (code === '3.2' && inp.id === 'feSerial') { sheetState.serial = st.inputs[inp.id]; st.dupe = false; } renderClause(code); } }));
  }

  async function fill(code, submit) {
    const { outcome, remark } = proposal(code);
    if (outcome === 'pending') return setStatus('Answer the open items first.', true);
    const def = getClause(code), yes = outcome === 'yes';
    if (!yes && !remark) return setStatus('Write the NC remark first.', true);
    if (submit && !def.nonNC) return setStatus('Submit is only offered for the non-NC clauses. Press Submit yourself.', true);
    const auto = proposal(code).p.outcome;
    if (auto !== 'pending' && auto !== outcome) OVERRIDES.push(`${code}: proposed ${auto}, assessor chose ${outcome}`);
    try {
      const msg = code === 'SITE' || code === 'PRODUCT' ? { action: 'fillBasic', kind: code, yes, remark, submit } : { action: 'fillClause', code, yes, remark, submit };
      const r = await send(msg);
      setStatus(r.ok ? `${code}: filled${r.submitted ? ' and submitted' : ' - check it and press Submit in the form'}.` : `${code}: ${r.error}`, !r.ok);
    } catch (e) { setStatus(e.message, true); }
  }

  function renderClause(code) {
    const old = document.getElementById('c-' + code), def = getClause(code), st = state(code);
    const { p, outcome, remark } = proposal(code);
    const req = C && C.requirements.find((r) => r.code === code);
    const done = req && req.conformance ? ` · portal: ${req.conformance}` : '';
    const card = h('div', { class: 'card', id: 'c-' + code },
      h('h3', {}, h('span', {}, `${def.code} ${def.title}`, h('span', { class: 'small' }, done)), h('span', { class: 'badge ' + outcome }, outcome === 'pending' ? 'needs input' : outcome.toUpperCase())),
      (def.location && (EV[code] || []).length) ? h('div', {}, (EV[code] || []).map((e, i) => stampRow(code, i, e))) : (def.location ? h('div', { class: 'small' }, 'No photos read yet - press “2. Read documents & photos”.') : null),
      (def.checks || []).map((k) => h('div', { class: 'chk-row' }, h('span', {}, k.label), tri(code, k.id))),
      (def.inputs || []).map((i) => inputEl(code, i)),
      code === '3.2' ? h('div', { class: 'row' }, h('button', { onclick: async () => { try { const d = await sheetCall({ action: 'checkSerial', serial: st.inputs.feSerial, month: (C.submissionDateISO || todayISO()).slice(0, 7) }); st.dupe = d.duplicates.length > 0; setStatus(st.dupe ? `Serial already used in ${d.duplicates.length} row(s) this month` : 'Serial is unique this month', st.dupe); renderClause(code); } catch (e) { setStatus(e.message, true); } } }, 'Check serial in sheet')) : null,
      p.reasons.length ? h('ul', { class: 'reasons' }, p.reasons.map((r) => h('li', {}, r))) : null,
      p.notes.length ? h('ul', { class: 'notes' }, p.notes.map((r) => h('li', {}, r))) : null,
      p.pending.length ? h('div', { class: 'small' }, 'Still needed: ', p.pending.join(', ')) : null,
      h('div', { class: 'row' }, !def.nonNC && !def.alwaysYes ? h('label', { class: 'small' }, 'Outcome ', h('select', { onchange: (ev) => { st.force = ev.target.value; renderClause(code); } }, ['auto', 'yes', 'no'].map((o) => h('option', { value: o, selected: st.force === o }, o === 'auto' ? 'as proposed' : 'force ' + o)))) : null),
      h('textarea', { onchange: (ev) => { st.remark = ev.target.value; } }, remark),
      h('div', { class: 'row' },
        h('button', { class: 'primary', disabled: outcome === 'pending', onclick: () => fill(code, false) }, 'Fill form'),
        def.nonNC && S.auto ? h('button', { disabled: outcome === 'pending', onclick: () => fill(code, true) }, 'Fill & Submit') : null));
    card.querySelector('textarea').value = remark;
    if (old) old.replaceWith(card); else $('#clauses').append(card);
  }

  function renderCase() {
    const b = $('#caseBox'); b.hidden = !C; if (!C) return;
    b.replaceChildren(h('div', { class: 'card' }, h('b', {}, C.unitName), h('div', { class: 'small' }, `${C.zedId} · ${C.unitAddress}`),
      h('div', { class: 'small' }, `Reference: ${C.refLat}, ${C.refLon} · submitted ${C.submissionDateISO || '?'} · assessor ${C.assessor}`),
      h('div', { class: 'row' }, h('button', { onclick: () => run(async () => { const r = await send({ action: 'setNotExempted' }); setStatus(`“Exempted from assessment” set to No on ${r.changed} item(s).`); }) }, 'Set “Exempted” = No')))); 
  }

  async function sheetCall(body) {
    if (!S.url) throw new Error('Set the Apps Script URL in settings (⚙).');
    const r = await fetch(S.url, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify(Object.assign({ secret: S.secret }, body)) });
    const j = await r.json(); if (!j.ok) throw new Error(j.error || 'Sheet error'); return j;
  }
  function renderSheet() {
    const b = $('#sheetBox'); b.hidden = !C; if (!C) return;
    const d = new Date(todayISO() + 'T12:00'); const dateTxt = `${d.getMonth() + 1}/${d.getDate()}/${d.getFullYear()}`;
    b.replaceChildren(h('div', { class: 'card' }, h('h3', {}, 'Google Sheet row (before you Accept)'),
      h('div', { class: 'small' }, `${dateTxt} · ${C.zedId} · ${C.unitName} · ${S.assessor || '(set assessor)'} · done by ${S.doneBy || '(set name)'}`),
      h('label', { class: 'small' }, 'Phone', h('input', { value: sheetState.phone, onchange: (e) => { sheetState.phone = e.target.value.trim(); } })),
      h('label', { class: 'small' }, 'Remarks (optional)', h('input', { value: sheetState.remarks, onchange: (e) => { sheetState.remarks = e.target.value.trim(); } })),
      h('div', { class: 'row' }, h('button', { class: 'primary', onclick: async () => { if (!confirm(`Add this case to the sheet?\n${C.zedId} ${C.unitName}`)) return; try { const r = await sheetCall({ action: 'addRow', row: { date: dateTxt, zedId: C.zedId, name: C.unitName, phone: sheetState.phone, serial: sheetState.serial, assessor: (S.assessor || C.assessor).toLowerCase(), doneBy: S.doneBy, email: '', remarks: sheetState.remarks } }); setStatus('Sheet row added (row ' + r.row + ').'); } catch (e) { setStatus(e.message, true); } } }, 'Add row to sheet'),
        h('button', { onclick: () => navigator.clipboard.writeText([dateTxt, C.zedId, C.unitName, sheetState.phone, sheetState.serial, (S.assessor || C.assessor).toLowerCase(), S.doneBy, '', sheetState.remarks].join('\t')).then(() => setStatus('Row copied - paste it into the sheet.')) }, 'Copy row'))));
  }

  async function refreshSummary() {
    const r = await send({ action: 'getResults' });
    lastResults = r.results; const dec = ZA.finalDecision(lastResults);
    const text = ZA.REMARKS.FINAL[dec.kind];
    const done = lastResults.filter((x) => x.conformance).length;
    const box = $('#summary'); box.hidden = false;
    box.replaceChildren(h('div', { class: 'card' }, h('h3', {}, 'Summary'),
      h('div', {}, `${done}/${lastResults.length} clauses answered · NC raised: ${dec.ncCount}${dec.ncCount ? ' (' + dec.ncCodes.join(', ') + ')' : ''}`),
      OVERRIDES.length ? h('ul', { class: 'notes' }, OVERRIDES.map((o) => h('li', {}, 'Override - ' + o))) : null,
      h('div', { class: 'small' }, 'Final remark to use:'), h('textarea', { readonly: true }, text),
      h('div', { class: 'row' }, h('button', { onclick: () => navigator.clipboard.writeText(text).then(() => setStatus('Final remark copied.')) }, 'Copy final remark')),
      h('p', { class: 'small' }, done < lastResults.length ? 'Some clauses are still unanswered.' : 'All clauses answered. Now press Final Submit yourself in the portal, tick the declaration and submit.')));
    box.querySelector('textarea').value = text;
  }

  function renderAll() {
    renderCase(); renderSheet();
    $('#clauses').replaceChildren();
    CLAUSES.forEach((c) => renderClause(c.code));
    if (C) { const b = h('div', { class: 'row' }, h('button', { onclick: () => run(refreshSummary) }, '3. Check results & final remark')); $('#clauses').append(b); }
  }


  // ------------------------------------------------------------------ autopilot
  const REPORT = { done: [], paused: [], flags: [], items: [], accepted: [] };
  /** a borderline item: shown for review with one-tap decisions, unless the assessor's earlier decisions already accept this kind */
  function flag(code, kind, text) {
    if (ZA.learn.autoAccept(LEARN, code, kind)) { REPORT.accepted.push(`${code}: ${text}`); return true; }
    REPORT.flags.push(`${code}: ${text}`); REPORT.items.push({ code, kind, text }); return false;
  }
  let lastReport = null;
  function imagesFor(code) {
    let list = EV[code] || [];
    if (code === '6.2') list = [...(EV['6.2'] || []), ...(EV['6.3'] || []), ...(EV['7.1'] || [])];
    return list.map((e) => e.big).filter(Boolean).slice(0, 12);
  }
  const smallJpeg = (cv) => { const k = Math.min(1, 1300 / Math.max(cv.width, cv.height)); const t = document.createElement('canvas'); t.width = Math.round(cv.width * k); t.height = Math.round(cv.height * k); t.getContext('2d').drawImage(cv, 0, 0, t.width, t.height); return t.toDataURL('image/jpeg', 0.72).split(',')[1]; };
  async function fastLoad(j) {
    const f = await send({ action: 'fetch', url: j.url });
    if (!f || !f.ok) throw new Error('download failed ' + ((f && f.error) || ''));
    const bytes = b64ToBytes(f.base64), out = [];
    if (/pdf/i.test(f.contentType) || (bytes[0] === 0x25 && bytes[1] === 0x50)) {
      pdfjsLib.GlobalWorkerOptions.workerSrc = chrome.runtime.getURL('vendor/pdf.worker.js');
      const pdf = await pdfjsLib.getDocument({ data: bytes, isEvalSupported: false }).promise;
      for (let p = 1; p <= Math.min(pdf.numPages, 8); p++) {
        const page = await pdf.getPage(p), vp = page.getViewport({ scale: 1.6 });
        const cv = document.createElement('canvas'); cv.width = vp.width; cv.height = vp.height;
        await page.render({ canvasContext: cv.getContext('2d'), viewport: vp }).promise;
        out.push({ code: j.code, label: `${j.label} p${p}`, b64: smallJpeg(cv) });
      }
    } else {
      const u = URL.createObjectURL(new Blob([bytes], { type: f.contentType || 'image/jpeg' }));
      const img = await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = () => rej(new Error('image failed')); i.src = u; });
      out.push({ code: j.code, label: j.label, b64: smallJpeg(canvasOf(img)) }); URL.revokeObjectURL(u);
    }
    return out;
  }

  function learnButtons(it) {
    const row = h('div', { class: 'row learn' });
    const done = (msg) => row.replaceChildren(h('span', { class: 'small' }, msg));
    const rec = (ok) => { ZA.learn.record(LEARN, it.code, it.kind, it.text, ok); saveLearn(); renderLearned();
      const r = LEARN.rules[ZA.learn.key(it.code, it.kind)];
      done(ok ? `Noted (accepted ${r.accept}x). After ${ZA.learn.NEED} accepts and no declines I will accept this kind by myself.` : 'Noted. Please set this clause to NC with EDIT in the portal.'); };
    row.append(h('button', { onclick: () => rec(true) }, 'Fine, accept'), h('button', { onclick: () => rec(false) }, 'No, keep NC'));
    return row;
  }
  function renderLearned() {
    const box = $('#learned'); if (!box) return;
    const rs = Object.entries(LEARN.rules);
    box.replaceChildren(rs.length ? h('ul', { class: 'notes' }, rs.map(([k, r]) => h('li', {}, `Clause ${r.code} (${r.kind}): accepted ${r.accept}x, declined ${r.decline}x`,
      ZA.learn.autoAccept(LEARN, r.code, r.kind) ? ' - applied automatically ' : ' ', h('button', { onclick: () => { ZA.learn.forget(LEARN, k); saveLearn(); renderLearned(); } }, 'Forget')))) : h('div', { class: 'small' }, 'Nothing learned yet.'),
      rs.length ? h('button', { onclick: () => { LEARN = ZA.learn.blank(); saveLearn(); renderLearned(); } }, 'Forget everything') : null);
  }

  async function autopilot() {
    if (!S.apiKey) { setStatus('Please finish the set-up first (paste your AI key).', true); return openSettings(); }
    $('#auto').disabled = true; REPORT.done = []; REPORT.paused = []; REPORT.flags = []; REPORT.items = []; REPORT.accepted = [];
    try {
      await scan();
      if (!C.requirements.length) { setStatus('This is not a case page. Open a case (ASSESS) first, or use ▶▶ Run all cases on the list page.', true); return; }
      if (isNaN(C.refLat) || isNaN(C.refLon)) { setStatus('Could not read the reference Latitude/Longitude from the Overview. Autopilot stopped - nothing was changed.', true); return; }
      await send({ action: 'setNotExempted' });
      // ---- gather every photo/page (fast: no OCR, small JPEGs) ----
      Object.keys(EV).forEach((k) => delete EV[k]);
      const jobs = [];
      C.photos.forEach((p) => jobs.push({ code: /product/.test(p.kind) ? 'PRODUCT' : 'SITE', url: p.src, hrefAttr: p.src, label: p.label }));
      // documents are only needed for clauses that are really checked (the six non-NC clauses and 4.1 are always Yes)
      const checkedCodes = new Set(CLAUSES.filter((d) => (!d.nonNC && !d.alwaysYes) || d.code === '6.2').map((d) => d.code).concat(['6.3', '7.1']));
      C.requirements.forEach((r) => { if (checkedCodes.has(r.code)) r.evidences.forEach((e) => jobs.push({ code: evidenceCode(r.code, e.label), url: e.href, hrefAttr: e.hrefAttr, label: `${r.code} ${e.label}` })); });
      setStatus(`Opening ${jobs.length} documents…`);
      for (const j of jobs) await send({ action: 'markOpened', hrefAttr: j.hrefAttr });   // reveals the portal's Validate buttons
      const got = new Array(jobs.length);
      let next = 0, doneN = 0;
      await Promise.all([0, 1, 2].map(async () => {
        while (next < jobs.length) {
          const i = next++;
          try { got[i] = await fastLoad(jobs[i]); } catch (e) { got[i] = []; REPORT.flags.push(`${jobs[i].code}: could not read ${jobs[i].label} (${e.message || e})`); }
          setStatus(`Reading documents ${++doneN}/${jobs.length}…`);
        }
      }));
      const items = got.flat();
      items.forEach((it) => { (EV[it.code] = EV[it.code] || []).push({ label: it.label, thumb: null, big: it.b64, stamp: { ok: false } }); });
      await scan();   // the Validate buttons are visible now
      // ---- one AI request for the whole case ----
      setStatus(`Checking ${items.length} photos/pages with AI (one request)…`);
      let all = { clauses: {}, stamps: {} }, aiError = null;
      try { all = await ZA.ai.askAll({ apiKey: S.apiKey, model: S.model, c: { unitName: C.unitName, unitAddress: C.unitAddress, today: todayISO(), refLat: C.refLat, refLon: C.refLon }, items, defs: CLAUSES, hints: ZA.learn.hints(LEARN) }); }
      catch (e) { aiError = String(e.message || e); }
      items.forEach((it, i) => { const sp = all.stamps[i + 1]; const e = EV[it.code].find((x) => x.big === it.b64); if (e && sp) e.stamp = plausible({ ok: true, lat: sp.lat, lon: sp.lon, date: sp.date }); });
      for (const def of CLAUSES) {
        const code = def.code, st = state(code), req = C.requirements.find((r) => r.code === code);
        if (code !== 'SITE' && code !== 'PRODUCT' && (!req || !req.canValidate)) { REPORT.paused.push(`${code}: Validate button not available (already answered or documents missing)`); continue; }
        setStatus(`Autopilot: ${code} ${def.title}…`);
        let reason = null, aiFailed = false;
        if (!def.nonNC && !def.alwaysYes || code === '6.2') {
          const res = all.clauses[code];
          if (!(EV[code] && EV[code].length) && !(code === '6.2' && ((EV['6.3'] || []).length || (EV['7.1'] || []).length))) reason = 'no documents/photos found';
          else if (aiError) { reason = aiError; aiFailed = true; }
          else if (!res) { reason = 'AI gave no answer for this clause'; aiFailed = true; }
          else {
            st.checks = res.state.checks; st.inputs = Object.assign(st.inputs, res.state.inputs); st.aiNotes = res.notes;
            if (res.confidence === 'low') flag(code, 'lowconf', `AI confidence low - ${res.notes}`);
          }
          if (code === '3.2' && st.inputs.feSerial && S.url) {
            try { const d = await sheetCall({ action: 'checkSerial', serial: st.inputs.feSerial, month: (C.submissionDateISO || todayISO()).slice(0, 7) }); st.dupe = d.duplicates.length > 0; } catch (e) { REPORT.flags.push(`${code}: serial check in sheet failed (${e.message})`); }
          }
          // answers the AI could not give: assume OK but flag them, so the assessor reviews them before Final Submit
          if (!reason && S.fillUncertain !== false) {
            const unsure = (def.checks || []).filter((k) => st.checks[k.id] === undefined);
            unsure.forEach((k) => { st.checks[k.id] = (code === '6.2' || k.id === 'fgPackaging') ? false : true; });
            if (unsure.length) flag(code, (code === '6.2' || unsure.some((k) => k.id === 'fgPackaging')) ? 'strict' : 'unsure', `not sure about "${unsure.map((k) => k.label).join('"; "')}" - filled as ${code === '6.2' ? 'not found' : (unsure.some((k) => k.id === 'fgPackaging') ? 'OK, except the own-packaging check which counts as NOT OK' : 'OK')}`);
          }
        }
        const { p, outcome, remark } = proposal(code);
        if (!reason && p.pending.length) reason = 'could not determine: ' + p.pending.join(', ');
        const locNote = p.notes.find((n) => /^Location needs a look/.test(n));
        if (!reason && locNote) { if (S.fillUncertain !== false || ZA.learn.autoAccept(LEARN, code, 'location')) flag(code, 'location', locNote); else reason = locNote; }
        renderClause(code);
        if (reason) { REPORT.paused.push(`${code}: ${reason}`); continue; }
        const msg = code === 'SITE' || code === 'PRODUCT' ? { action: 'fillBasic', kind: code, yes: outcome === 'yes', remark, submit: true } : { action: 'fillClause', code, yes: outcome === 'yes', remark, submit: true };
        const r = await send(msg);
        if (r.ok) REPORT.done.push(`${code}: ${outcome.toUpperCase()}`); else REPORT.paused.push(`${code}: ${r.error}`);
      }
      await scan(); await refreshSummary();
      const box = $('#summary');
      const nF = REPORT.flags.length, nP = REPORT.paused.length;
      box.replaceChildren();
      box.prepend(h('div', { class: 'banner ' + (nP ? 'warn' : 'good') },
        h('div', { class: 'bt' }, nP ? `Almost done - ${nP} thing${nP > 1 ? 's' : ''} need you` : (nF ? 'Done - please look at a few items' : 'All done!')),
        h('div', { class: 'small' }, nP ? 'Scroll down to see what is left, fill those in the portal, then press Final Submit yourself.' : (nF ? 'Check the yellow items below, then press Final Submit yourself.' : 'Take a quick look at the case, then press Final Submit yourself.'))));
      box.append(h('div', { class: 'card' }, h('h3', {}, 'Autopilot report'),
        h('div', {}, `Submitted automatically: ${REPORT.done.length}`), h('ul', { class: 'notes' }, REPORT.done.map((x) => h('li', {}, x))),
        REPORT.flags.length ? h('div', { class: 'small' }, 'Filled, but please REVIEW before Final Submit (tap a button so I learn your judgement):') : null,
        h('ul', { class: 'reasons' }, REPORT.flags.map((x) => { const it = REPORT.items.find((i) => `${i.code}: ${i.text}` === x); return h('li', {}, x, it && ZA.learn.learnable(it.code, it.kind) ? learnButtons(it) : null); })),
        REPORT.accepted.length ? h('div', { class: 'small' }, 'Accepted because of your earlier decisions (still worth a glance):') : null,
        h('ul', { class: 'notes' }, REPORT.accepted.map((x) => h('li', {}, x))),
        REPORT.paused.length ? h('div', { class: 'small' }, 'Not filled (could not be decided safely):') : null,
        h('ul', { class: 'reasons' }, REPORT.paused.map((x) => h('li', {}, x)))));
      lastReport = { done: REPORT.done.slice(), paused: REPORT.paused.slice(), flags: REPORT.flags.slice() };
      setStatus(REPORT.paused.length ? `Autopilot finished. ${REPORT.paused.length} clause(s) not filled, ${REPORT.flags.length} to review.` : `Autopilot finished. Everything is filled. Review ${REPORT.flags.length} flagged item(s), then press Final Submit yourself.`);
    } finally { $('#auto').disabled = false; }
  }

  // ------------------------------------------------------------------ run all cases
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  async function gotoAndWait(url) {
    const id = tabId || (await activeTab());
    await chrome.tabs.update(id, { url });
    for (let i = 0; i < 60; i++) { await sleep(500); const t = await chrome.tabs.get(id); if (t.status === 'complete') break; }
    for (let i = 0; i < 30; i++) { await sleep(500); try { const r = await chrome.tabs.sendMessage(id, { action: 'ping' }); if (r && r.ok) return; } catch (e) { /* content script not ready */ } }
    throw new Error('page did not load');
  }
  async function runAll() {
    if (!S.apiKey) { setStatus('Please finish the set-up first (paste your AI key).', true); return openSettings(); }
    $('#batch').disabled = true;
    const lines = [];
    try {
      const tab = await chrome.tabs.get(await activeTab());
      const listUrl = tab.url.split('?')[0].replace(/DaDetails.*/, 'DaVerification');
      let list = await send({ action: 'getList' });
      if (!list || !list.ok || !list.items.length) { await gotoAndWait(listUrl); list = await send({ action: 'getList' }); }
      const items = (list && list.items) || [];
      const todo = items.filter((x) => x.canAssess);
      items.filter((x) => !x.canAssess).forEach((x) => lines.push(`${x.zedId} ${x.name}: not accepted yet - Accept it (after the sheet row), then run again`));
      if (!todo.length) setStatus('No accepted cases to assess on this page.', true);
      for (let n = 0; n < todo.length; n++) {
        const it = todo[n];
        setStatus(`Case ${n + 1}/${todo.length}: ${it.zedId} ${it.name}…`);
        try {
          await gotoAndWait(it.href);
          Object.keys(EV).forEach((k) => delete EV[k]); Object.keys(ST).forEach((k) => delete ST[k]); OVERRIDES.length = 0; lastReport = null;
          for (let i = 0; i < 20; i++) { C = await send({ action: 'getCase' }); if (C && C.requirements && C.requirements.length) break; await sleep(500); }
          await autopilot();
          const r = lastReport || { done: [], paused: ['did not finish'] };
          lines.push(`${it.zedId} ${it.name}: ${r.done.length} clauses submitted, ${r.paused.length} left for you` + (r.paused.length ? ' (' + r.paused.map((x) => x.split(':')[0]).join(', ') + ')' : ' - ready for Final Submit'));
        } catch (e) { lines.push(`${it.zedId} ${it.name}: stopped - ${e.message || e}`); }
        $('#summary').hidden = false;
      }
      await gotoAndWait(listUrl);
      const box = $('#summary'); box.hidden = false;
      box.replaceChildren(h('div', { class: 'card' }, h('h3', {}, 'All cases report'), h('ul', { class: 'notes' }, lines.map((x) => h('li', {}, x))),
        h('p', { class: 'small' }, 'Nothing was Final-Submitted. Open each case marked "ready for Final Submit", check it and press Final Submit yourself.')));
      setStatus('Run finished. See the report below.');
    } finally { $('#batch').disabled = false; }
  }

  async function run(fn) { try { await fn(); } catch (e) { setStatus(e.message || String(e), true); } }
  $('#batch')?.addEventListener('click', () => run(runAll));
  $('#auto')?.addEventListener('click', () => run(autopilot));
  $('#scan')?.addEventListener('click', () => run(scan));
  $('#evidence')?.addEventListener('click', () => run(readEvidence));
  try { $('#ver').textContent = 'v' + chrome.runtime.getManifest().version; } catch (e) { /* ignore */ }
  // ------------------------------------------------------------------ simple mode: setup + the right big button
  async function refreshUi() {
    const ready = !!S.apiKey;
    $('#setup').hidden = ready; $('#mainUi').hidden = !ready;
    if (!ready) return;
    let path = '', onPortal = false;
    try { const tabs = await chrome.tabs.query({ url: 'https://loginzed.msme.gov.in/*' }); const t = tabs.find((x) => x.active) || tabs[0]; onPortal = !!t; path = t ? new URL(t.url).pathname : ''; } catch (e) { /* no tab */ }
    const isList = /DaVerification/i.test(path), isCase = /DaDetails/i.test(path);
    $('#batch').hidden = !isList; $('#auto').hidden = !isCase;
    $('#openPortal').hidden = onPortal; $('#goList').hidden = !onPortal || isList || isCase;
    $('#modeHint').textContent = isList ? 'Step 1: Accept your cases (they must show ASSESS). Step 2: press the big button.'
      : isCase ? 'Press the big button. The extension does the rest.'
      : onPortal ? 'Sign in on the portal if needed, then press the button below.' : 'First open the assessor portal and sign in.';
  }
  // ---- update check: looks at the newest GitHub release; tells the user how to update (never installs anything by itself)
  const REPO = 'luviiiii/ZedAssistBySUGAR';
  const newer = (a, b) => { const x = String(a).replace(/^v/, '').split('.').map(Number), y = String(b).replace(/^v/, '').split('.').map(Number); for (let i = 0; i < 3; i++) { if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) > (y[i] || 0); } return false; };
  async function checkUpdate() {
    try {
      const r = await fetch(`https://api.github.com/repos/${REPO}/releases/latest`, { headers: { Accept: 'application/vnd.github+json' } });
      if (!r.ok) return; const j = await r.json();
      if (!newer(j.tag_name, chrome.runtime.getManifest().version)) return;
      const asset = (j.assets || []).find((a) => /\.zip$/i.test(a.name));
      const bar = $('#update'); bar.hidden = false;
      bar.replaceChildren(h('b', {}, `New version ${String(j.tag_name).replace(/^v/, '')} is ready`), h('div', { class: 'small' }, '1) Download  2) Unzip over your old folder (replace files)  3) On chrome://extensions press the reload arrow.'),
        h('div', { class: 'row' }, h('button', { class: 'primary', onclick: () => chrome.tabs.create({ url: asset ? asset.browser_download_url : j.html_url }) }, 'Download update'), h('button', { onclick: () => chrome.tabs.create({ url: 'chrome://extensions' }) }, 'Open extensions page')));
    } catch (e) { /* offline or no release yet - stay quiet */ }
  }
  $('#getKey')?.addEventListener('click', () => chrome.tabs.create({ url: 'https://aistudio.google.com/apikey' }));
  $('#pasteKey')?.addEventListener('click', async () => { try { const t = (await navigator.clipboard.readText()).trim(); if (t) $('#wKey').value = t; else setStatus('Nothing copied yet. Copy the key first.', true); } catch (e) { setStatus('Could not read the clipboard - paste the key into the box with Ctrl+V.', true); } });
  $('#openPortal')?.addEventListener('click', () => chrome.tabs.create({ url: 'https://loginzed.msme.gov.in/' }));
  $('#goList')?.addEventListener('click', async () => { const t = (await chrome.tabs.query({ url: 'https://loginzed.msme.gov.in/*' })).find((x) => x.active) || (await chrome.tabs.query({ url: 'https://loginzed.msme.gov.in/*' }))[0]; if (t) chrome.tabs.update(t.id, { url: 'https://loginzed.msme.gov.in/Assessment/DaVerification', active: true }); });
  $('#wSave').addEventListener('click', () => run(async () => {
    const key = $('#wKey').value.trim(), name = $('#wName').value.trim();
    if (!key) throw new Error('Please paste your key first (step 2).');
    setStatus('Testing the key…');
    const model = await ZA.ai.test(key);
    S = Object.assign({}, S, { apiKey: key, doneBy: name || S.doneBy || 'Assessor', model: 'auto' });
    await chrome.storage.local.set({ za: S });
    setStatus('Key works (' + model + '). You are ready.'); await refreshUi(); renderAll();
  }));
  chrome.tabs.onActivated.addListener(refreshUi); chrome.tabs.onUpdated.addListener((id, info) => { if (info.status === 'complete') refreshUi(); });
  loadSettings().then(loadLearn).then(() => { renderAll(); refreshUi(); renderLearned(); checkUpdate(); });
})();

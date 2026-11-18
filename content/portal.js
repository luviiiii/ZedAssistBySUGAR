/* ZED Assist - portal adapter. Runs on loginzed.msme.gov.in/Assessment/* inside the assessor's own, already
 * signed-in browser tab. It only reads the page and fills the same forms the assessor would fill by hand.
 *
 * SAFETY: there is deliberately NO function here that presses Final Submit, Accept, Reject or the assessor's
 * declaration checkbox. A test (tests/safety.test.js) checks this file for those controls. */
(() => {
  if (window.__zaPortalLoaded) return;
  window.__zaPortalLoaded = true;

  const $ = (s, r) => (r || document).querySelector(s);
  const $$ = (s, r) => Array.from((r || document).querySelectorAll(s));
  const txt = (el) => ((el && el.textContent) || '').replace(/\s+/g, ' ').trim();
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const visible = (el) => !!el && !el.classList.contains('ng-hide') && !el.closest('.ng-hide') && getComputedStyle(el).display !== 'none';

  async function waitFor(fn, timeout, step) {
    const end = Date.now() + (timeout || 5000);
    for (;;) {
      const v = fn();
      if (v) return v;
      if (Date.now() > end) return null;
      await sleep(step || 60);
    }
  }

  // ---------------------------------------------------------------------------------------------
  // reading
  // ---------------------------------------------------------------------------------------------
  function readOverview() {
    const pane = $('#overview-tab-pane') || document;
    const map = {};
    $$('th', pane).forEach((th) => {
      const td = th.nextElementSibling;
      if (td && td.tagName === 'TD') map[txt(th)] = txt(td);
    });
    return map;
  }

  function isoFromLongDate(s) {
    const d = new Date(String(s || '') + ' 12:00');
    if (isNaN(d)) return null;
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }

  function validateButtonFor(row) {
    return $$('input[ng-click^="UpdateConfirmanceNo"], button[ng-click^="UpdateConfirmanceNo"]', row).find((b) => visible(b));
  }

  function readRequirements() {
    const pane = $('#elements-tab-pane');
    if (!pane) return [];
    const rows = $$('tr', pane).filter((r) => r.firstElementChild && r.firstElementChild.tagName === 'TH' && /^\d+\.\d+$/.test(txt(r.firstElementChild)));
    return rows.map((r) => {
      const cells = Array.from(r.children);
      const code = txt(cells[0]);
      const confText = txt(cells[3]);
      const evidences = $$('a[href]', r)
        .filter((a) => /Evidences|Photos|\.pdf|\.jpe?g|\.png/i.test(a.getAttribute('href') || ''))
        .map((a) => {
          // each document sits in its own little row with its description, e.g. "Picture of Training records of the safety trainings…"
          const tr = a.closest('tr');
          const desc = tr && tr !== r ? txt(tr).replace(/\s*Verified:.*$/i, '').slice(0, 100) : '';
          return { label: txt(a) || desc || 'document', href: a.href, hrefAttr: a.getAttribute('href') };
        });
      const btn = validateButtonFor(r);
      return {
        code,
        text: txt(cells[1]),
        evidences,
        conformance: /^Yes/i.test(confText) ? 'Yes' : /^No/i.test(confText) ? 'No' : '',
        remark: txt(cells[4]),
        canValidate: !!btn,
      };
    });
  }

  function photoKind(label) {
    const l = label.toLowerCase();
    if (/selfie/.test(l)) return 'selfie';
    if (/site exterior/.test(l)) return 'siteExterior';
    if (/description/.test(l)) return 'productDesc';
    if (/product/.test(l)) return 'product';
    return 'photo';
  }

  function readPhotos() {
    const pane = $('#basicInfo-tab-pane');
    if (!pane) return [];
    return $$('img', pane)
      .filter((i) => /Photos/i.test(i.getAttribute('src') || ''))
      .map((img) => {
        const td = img.closest('td');
        const tr = td && td.parentElement;
        const table = tr && tr.closest('table');
        let label = '';
        if (td && tr && table) {
          const idx = Array.from(tr.children).indexOf(td);
          const ths = $$('th', table);
          const header = ths.length === tr.children.length ? txt(ths[idx]) : '';
          label = /product/i.test(header) ? header : txt(tr.children[1]) || header;
        }
        return { label: label || 'photo', kind: photoKind(label || ''), src: img.src };
      });
  }

  function readBasic() {
    const pane = $('#basicInfo-tab-pane');
    const out = { siteExterior: { done: false, remark: '' }, products: [] };
    if (!pane) return out;
    $$('input[ng-click^="ValidateSiteExteriorPhotos"]', pane).forEach((b) => { if (visible(b) && /validate/i.test(b.value)) out.siteExterior.canValidate = true; });
    const prods = $$('input[ng-click^="ValidateProduct"]', pane);
    out.products = prods.filter((b) => /validate/i.test(b.value || txt(b))).map((b, i) => ({ index: i, canValidate: visible(b) }));
    return out;
  }

  function getCase() {
    const ov = readOverview();
    return {
      ok: true,
      zedId: ov['ZED ID'] || '',
      unitName: ov['Unit Name'] || '',
      unitAddress: ov['Unit Address'] || '',
      udyam: ov['Udyam Registration Number'] || '',
      submissionDateISO: isoFromLongDate(ov['Document Submission Date']),
      assessor: ov['Desktop Assessor Name'] || '',
      certification: ov['Certification'] || '',
      refLat: parseFloat(ov['Latitude']),
      refLon: parseFloat(ov['Longitude']),
      requirements: readRequirements(),
      photos: readPhotos(),
      basic: readBasic(),
      url: location.pathname,
    };
  }

  // ---------------------------------------------------------------------------------------------
  // acting
  // ---------------------------------------------------------------------------------------------
  /** Triggers the portal's own click handler that records "document opened" (which reveals the Validate
   *  button), but cancels the default action so no new browser tab opens. */
  function markOpened(hrefAttr) {
    const a = $$('a[href]').find((x) => x.getAttribute('href') === hrefAttr)
      || $$('img').find((x) => x.getAttribute('src') === hrefAttr || x.src === hrefAttr);
    if (!a) return { ok: false, error: 'link not found' };
    a.addEventListener('click', (e) => e.preventDefault(), { capture: true, once: true });
    a.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window }));
    return sleep(120).then(() => {
      // photos open in the portal's own "Image" popup: close it again so it does not pile up
      const m = $$('.modal.show').find((x) => $('img', x) && !$('textarea', x));
      // that popup's close controls are an <input> in the footer and an <img onclick> in the header
      const close = m && ($('.modal-footer input, .modal-footer button', m) || $('img[onclick]', m) || $('[data-dismiss="modal"], .close, .btn-close', m));
      if (close) close.click();
      return { ok: true };
    });
  }

  function toBase64(buf) {
    const bytes = new Uint8Array(buf);
    let s = '';
    for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    return btoa(s);
  }

  async function fetchBytes(url) {
    // the portal serves photos/documents with http:// links; an https page may not fetch those (mixed content), https works
    const res = await fetch(location.protocol === 'https:' ? String(url).replace(/^http:/, 'https:') : String(url), { credentials: 'include' });
    if (!res.ok) return { ok: false, error: 'HTTP ' + res.status };
    const buf = await res.arrayBuffer();
    return { ok: true, contentType: res.headers.get('content-type') || '', base64: toBase64(buf), bytes: buf.byteLength };
  }

  function setValue(el, v) {
    const proto = el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, v);
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  }

  const shown = (m) => !!m && m.classList.contains('show') && getComputedStyle(m).display !== 'none';

  /** Click a Validate button, wait for its modal, choose Yes/No, type the remark, optionally press the
   *  modal's own Submit (that is the clause form's Submit, never the final submission). */
  /** The portal sometimes shows a small notice (OK button) after a choice or a save, which blocks the form. Click it away. */
  async function dismissNotices(exceptId) {
    let n = 0;
    for (let i = 0; i < 3; i++) {
      const btn = $$('.swal2-confirm, .swal-button--confirm, .sweet-alert.visible .confirm, .bootbox .btn-primary').find(visible)
        || $$('.modal.show').filter((m) => m.id !== exceptId && !$('textarea', m)).map((m) => $$('button, input[type=button], input[type=submit], a.btn', m).find((b) => /^(ok|close|yes|done)$/i.test(txt(b) || b.value || ''))).find(Boolean);
      if (!btn) break;
      btn.click(); n++; await sleep(450);
    }
    return n;
  }

  /** Click a Validate button, wait for its modal, choose Yes/No, type the remark, optionally press the
   *  modal's own Submit (that is the clause form's Submit, never the final submission). */
  async function fillModal(btn, modalId, yes, remark, submit, verify) {
    await dismissNotices(modalId);
    btn.click();
    const modal = await waitFor(() => { const m = document.getElementById(modalId); return shown(m) ? m : null; }, 4000);
    if (!modal) return { ok: false, error: 'form did not open' };
    const radios = $$('input[type=radio]', modal);
    if (radios.length < 2) return { ok: false, error: 'radio buttons not found' };
    const want = yes ? radios[0] : radios[1];
    for (let i = 0; i < 3 && !want.checked; i++) { want.click(); await sleep(250); await dismissNotices(modalId); if (!want.checked) want.click(); await sleep(100); }
    if (!want.checked) return { ok: false, error: 'could not select ' + (yes ? 'Yes' : 'No') };
    const ta = $('textarea', modal);
    if (!ta) return { ok: false, error: 'remarks box not found' };
    setValue(ta, remark || '');
    await sleep(80);
    if (!submit) return { ok: true, filled: true, submitted: false };
    const sub = $('input[type=submit]', modal);
    if (!sub) return { ok: false, error: 'submit button not found' };
    sub.click();
    await sleep(300); await dismissNotices(modalId);
    // the portal saves the answer but often leaves the form open: judge success by the table, then close the form ourselves
    const saved = verify ? await waitFor(verify, 9000, 200) : await waitFor(() => !shown(document.getElementById(modalId)) || !document.contains(btn) || !visible(btn), 9000, 200);
    await sleep(150);
    const still = document.getElementById(modalId);
    if (shown(still)) { const c = $('input[type=button], button[data-dismiss="modal"], .close', still); if (c) c.click(); await sleep(300); }
    return saved ? { ok: true, filled: true, submitted: true } : { ok: false, error: 'could not confirm that the portal saved it - check this clause on the page' };
  }

  async function fillClause(msg) {
    const pane = $('#elements-tab-pane');
    const row = $$('tr', pane).find((r) => r.firstElementChild && r.firstElementChild.tagName === 'TH' && txt(r.firstElementChild) === msg.code);
    if (!row) return { ok: false, error: 'clause ' + msg.code + ' not found' };
    const btn = validateButtonFor(row);
    if (!btn) return { ok: false, error: 'Validate button for ' + msg.code + ' is not shown (open its documents first, or it is already done - use Edit)' };
    const rowNow = () => $$('tr', pane).find((r) => r.firstElementChild && r.firstElementChild.tagName === 'TH' && txt(r.firstElementChild) === msg.code);
    const verify = () => { const r = rowNow(); const t = r && r.children[3] ? txt(r.children[3]) : ''; return (msg.yes ? /^Yes/i : /^No/i).test(t); };
    return fillModal(btn, 'AssessorRemarks', !!msg.yes, msg.remark, !!msg.submit, verify);
  }

  async function fillBasic(msg) {
    const pane = $('#basicInfo-tab-pane');
    const editShown = (name) => $$(`input[ng-click^="${name}"]`, pane).some((b) => visible(b) && /^edit$/i.test(b.value));
    if (msg.kind === 'SITE') {
      if (editShown('ValidateSiteExteriorPhotos')) return { ok: false, error: 'already answered (Edit is shown) - nothing changed' };
      const btn = $$('input[ng-click^="ValidateSiteExteriorPhotos"]', pane).find((b) => visible(b) && /validate/i.test(b.value));
      if (!btn) return { ok: false, error: 'Site Exterior Validate button is not shown (open all photos first)' };
      return fillModal(btn, 'ValidateSiteExterior', !!msg.yes, msg.remark, !!msg.submit);
    }
    if (msg.kind === 'PRODUCT') {
      if (editShown('ValidateProduct')) return { ok: false, error: 'already answered (Edit is shown) - nothing changed' };
      const btns = $$('input[ng-click^="ValidateProduct"]', pane).filter((b) => visible(b) && /validate/i.test(b.value));
      const btn = btns[msg.index || 0];
      if (!btn) return { ok: false, error: 'Product Validate button is not shown (open the product photos first)' };
      return fillModal(btn, 'ValidateProduct', !!msg.yes, msg.remark, !!msg.submit);
    }
    return { ok: false, error: 'unknown basic item' };
  }

  /** Set "Exempted from Remote/Site Assessment" to No wherever the question is shown. */
  async function setNotExempted() {
    const radios = $$('#elements-tab-pane input[type=radio][ng-model="s.IsAssessmentExcempted"][value="No"]')
      .filter((r) => !r.closest('.ng-hide') && !r.checked);
    let n = 0;
    for (const r of radios) {
      r.click();
      n++;
      await sleep(500);
      const ok = $$('.modal.show').find((m) => /not exempted|success/i.test(txt(m)));
      if (ok) { const b = $('button, input[type=button]', ok); if (b) b.click(); await sleep(400); }
    }
    return { ok: true, changed: n };
  }

  function getResults() {
    const reqs = readRequirements();
    return { ok: true, results: reqs.map((r) => ({ code: r.code, conformance: r.conformance, remark: r.remark })) };
  }

  /** Cases on the list page that can be assessed now (their ASSESS link is shown, i.e. already accepted). */
  function getList() {
    const rows = $$('tr').filter((r) => r.querySelector('td'));
    const items = rows.map((r) => {
      const id = (txt(r).match(/ZEDMSME\d+/) || [''])[0];
      const assess = $$('a', r).find((a) => /DaDetails/.test(a.getAttribute('href') || ''));
      const accept = $$('button', r).find((b) => /^accept$/i.test(txt(b)));
      const lines = (r.children[2] ? r.children[2].innerText : '').split('\n').map((x) => x.trim()).filter(Boolean);
      return { zedId: id, name: lines[1] || '', canAssess: !!assess && visible(assess), needsAccept: !!accept && visible(accept), href: assess ? assess.href : '' };
    }).filter((x) => x.zedId);
    return { ok: true, items };
  }

  const handlers = { getList: async () => getList(), ping: async () => ({ ok: true, page: location.pathname }), getCase: async () => getCase(), markOpened: async (m) => markOpened(m.hrefAttr), fetch: async (m) => fetchBytes(m.url), fillClause, fillBasic, setNotExempted, getResults: async () => getResults() };

  if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.onMessage) {
    chrome.runtime.onMessage.addListener((msg, sender, send) => {
      const h = msg && handlers[msg.action];
      if (!h) return false;
      Promise.resolve(h(msg)).then(send).catch((e) => send({ ok: false, error: String((e && e.message) || e) }));
      return true;
    });
  }
})();

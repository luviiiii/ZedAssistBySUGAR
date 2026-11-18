/* ZED Assist - learns from the assessor's one-tap decisions on flagged items. Stored only in this browser (chrome.storage.local "zl"). */
(() => {
  const NEED = 3;                                   // accepted this many times, never declined -> applied automatically
  const NEVER = new Set(['1.1', '1.2', '2.1', '3.1', '5.1', '6.1', '4.1']);   // Non NC / always-yes clauses are never learned
  const key = (code, kind) => `${code}|${kind}`;
  const learnable = (code, kind) => !NEVER.has(code) && ['unsure', 'lowconf', 'location'].includes(kind);
  const blank = () => ({ rules: {} });
  function record(store, code, kind, text, accepted) {
    if (!learnable(code, kind)) return store;
    const r = store.rules[key(code, kind)] = store.rules[key(code, kind)] || { code, kind, accept: 0, decline: 0, examples: [] };
    r[accepted ? 'accept' : 'decline']++;
    const t = String(text || '').slice(0, 140);
    r.examples = [(accepted ? 'ACCEPTED: ' : 'DECLINED: ') + t].concat(r.examples).slice(0, 4);
    return store;
  }
  function autoAccept(store, code, kind) {
    const r = store && store.rules[key(code, kind)];
    return !!r && learnable(code, kind) && r.accept >= NEED && r.decline === 0;
  }
  function hints(store) {
    const rs = Object.values((store && store.rules) || {}).filter((r) => r.accept + r.decline > 0);
    if (!rs.length) return '';
    return 'The assessor\'s own past decisions on borderline cases (follow the same judgement when a case is similar; they are guidance, not facts about this case):\n' +
      rs.map((r) => `- Clause ${r.code}, ${r.kind}: accepted ${r.accept}x, declined ${r.decline}x. ${r.examples.join(' | ')}`).join('\n');
  }
  function forget(store, k) { delete store.rules[k]; return store; }
  const api = { NEED, key, learnable, blank, record, autoAccept, hints, forget };
  (typeof self !== 'undefined' ? self : this).ZA = Object.assign((typeof self !== 'undefined' ? self : this).ZA || {}, { learn: api });
  if (typeof module !== 'undefined') module.exports = api;
})();

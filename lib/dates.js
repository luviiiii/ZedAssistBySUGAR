/* ZED Assist - date helpers for the handwritten dates on training sheets, delivery records etc.
 * Dates are plain {y,m,d} objects, compared as ISO strings, so there are no time-zone surprises. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.ZA = Object.assign(root.ZA || {}, factory());
})(typeof self !== 'undefined' ? self : this, function () {
  const pad = (n) => String(n).padStart(2, '0');

  /** Parse dd-mm-yy / dd-mm-yyyy / dd/mm/yy / dd.mm.yyyy, or an ISO yyyy-mm-dd. Returns {y,m,d,iso} or null. */
  function parseDMY(s) {
    if (s && typeof s === 'object' && s.iso) return s;
    const t = String(s || '').trim();
    let m = t.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
    let y, mo, d;
    if (m) { y = +m[1]; mo = +m[2]; d = +m[3]; }
    else {
      m = t.match(/^(\d{1,2})\s*[-\/.]\s*(\d{1,2})\s*[-\/.]\s*(\d{2}|\d{4})$/);
      if (!m) return null;
      d = +m[1]; mo = +m[2]; y = +m[3];
      if (y < 100) y += 2000;
    }
    const dt = new Date(Date.UTC(y, mo - 1, d));
    if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== mo - 1 || dt.getUTCDate() !== d) return null;
    return { y, m: mo, d, iso: `${y}-${pad(mo)}-${pad(d)}` };
  }

  const toUTC = (x) => Date.UTC(x.y, x.m - 1, x.d);
  const cmp = (a, b) => (a.iso < b.iso ? -1 : a.iso > b.iso ? 1 : 0);
  const daysBetween = (a, b) => Math.round((toUTC(b) - toUTC(a)) / 86400000);

  /** Add whole months, clamping the day to the end of the month (31 Jan + 1 month = 28/29 Feb). */
  function addMonths(x, n) {
    const total = x.y * 12 + (x.m - 1) + n;
    const y = Math.floor(total / 12);
    const m = (total % 12) + 1;
    const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
    const d = Math.min(x.d, last);
    return { y, m, d, iso: `${y}-${pad(m)}-${pad(d)}` };
  }

  const fmt = (x) => `${pad(x.d)}-${pad(x.m)}-${x.y}`;

  function today() {
    const n = new Date();
    return parseDMY(`${n.getFullYear()}-${n.getMonth() + 1}-${n.getDate()}`);
  }

  return { parseDMY, cmp, daysBetween, addMonths, fmt, today };
});

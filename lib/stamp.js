/* ZED Assist - parse the geo-stamp burned into the corner of every ZED photo, e.g.
 *   Oct 30, 2026 12:21 PM
 *   Lat: 34.290962,
 *   Long: 74.6074437
 * Input is raw OCR text, so the parser tolerates the usual OCR slips (O/0, l/1, comma/period...). */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.ZA = Object.assign(root.ZA || {}, factory());
})(typeof self !== 'undefined' ? self : this, function () {
  const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];

  function lev(a, b) {
    const dp = Array.from({ length: a.length + 1 }, (_, i) => [i]);
    for (let j = 1; j <= b.length; j++) dp[0][j] = j;
    for (let i = 1; i <= a.length; i++)
      for (let j = 1; j <= b.length; j++)
        dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    return dp[a.length][b.length];
  }

  function monthIndex(token) {
    const t = token.toLowerCase().replace(/0/g, 'o').replace(/[1|!]/g, 'l').replace(/5/g, 's').slice(0, 3);
    let i = MONTHS.indexOf(t);
    if (i >= 0) return i;
    let best = -1, bestD = 2;
    MONTHS.forEach((m, k) => { const d = lev(t, m); if (d < bestD) { bestD = d; best = k; } });
    return best;
  }

  /** Fix digit-lookalikes inside a token that must be a number. */
  function fixNumber(s) {
    return s
      .replace(/[Oo]/g, '0')
      .replace(/[Il|!]/g, '1')
      .replace(/[Ss]/g, '5')
      .replace(/B/g, '8')
      .replace(/,/g, '.')
      .replace(/[^0-9.\-]/g, '');
  }

  function toNumber(s) {
    const f = fixNumber(s);
    const n = parseFloat(f);
    return Number.isFinite(n) ? n : null;
  }

  /**
   * Turn an OCR'd coordinate such as "34.290962", "34,2909 62" or "34 290962" into a number.
   * When the decimal point was lost, the integer part is taken from the reference location (hint),
   * e.g. hint 34.29 turns "34290962" into 34.290962. Only the point is restored - the other digits stay as read.
   */
  function coordFromToken(token, hintValue) {
    let s = fixNumber(String(token || '').replace(/\s+/g, '').replace(/[.,]+$/, ''));
    const neg = s.startsWith('-');
    s = s.replace(/-/g, '');
    if (s.replace(/[^0-9]/g, '').length < 6) return null; // a real stamp has at least 4 decimals
    if ((s.match(/\./g) || []).length === 1) {
      const n = parseFloat(s);
      return Number.isFinite(n) ? (neg ? -n : n) : null;
    }
    const digits = s.replace(/\./g, '');
    if (hintValue != null && digits.length >= 6) {
      const ip = String(Math.trunc(Math.abs(hintValue)));
      if (digits.startsWith(ip)) {
        const n = parseFloat(ip + '.' + digits.slice(ip.length));
        return Number.isFinite(n) ? (neg ? -n : n) : null;
      }
    }
    return null;
  }

  /**
   * @param text  raw OCR text
   * @param opts  {hint:{lat,lon}}  optional reference location, used only to restore a lost decimal point
   * @returns {{ok:boolean, date:string|null, time24:string|null, lat:number|null, lon:number|null, raw:string, problems:string[]}}
   */
  function parseStamp(text, opts) {
    const hint = (opts && opts.hint) || {};
    const raw = String(text || '');
    const t = raw.replace(/[\r\n]+/g, ' ').replace(/\s+/g, ' ').trim();
    const out = { ok: false, date: null, time24: null, lat: null, lon: null, raw, problems: [] };

    // ---- date and time -------------------------------------------------------------
    const dm = t.match(/([A-Za-z0|!1]{3,4})\.?\s*([0-9OIl]{1,2})\s*[,.]?\s*(2[0O]\d\d)\s*[,.]?\s*([0-9OIl]{1,2})\s*[:.;]\s*([0-9OIl]{2})\s*([AaPp])\.?\s*[Mm]/);
    if (dm) {
      const mi = monthIndex(dm[1]);
      const day = toNumber(dm[2]);
      const year = toNumber(dm[3]);
      let hh = toNumber(dm[4]);
      const mm = toNumber(dm[5]);
      const pm = /p/i.test(dm[6]);
      if (mi >= 0 && day >= 1 && day <= 31 && hh >= 1 && hh <= 12 && mm >= 0 && mm <= 59) {
        if (pm && hh < 12) hh += 12;
        if (!pm && hh === 12) hh = 0;
        out.date = `${year}-${String(mi + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
        out.time24 = `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
      }
    }
    if (!out.date) out.problems.push('date/time not readable');

    // ---- latitude / longitude ------------------------------------------------------
    const la = t.match(/[Ll][aA@4][tT][a-z]*\s*[:.;,]?\s*(-?[0-9OIlSB .,]{6,18})/);
    if (la) out.lat = coordFromToken(la[1], hint.lat);
    const lo = t.match(/[Ll][oO0][nN][gG][a-z]*\s*[:.;,]?\s*(-?[0-9OIlSB .,]{6,18})/);
    if (lo) out.lon = coordFromToken(lo[1], hint.lon);
    if (out.lat === null || out.lat < -90 || out.lat > 90) { out.problems.push('latitude not readable'); out.lat = null; }
    if (out.lon === null || out.lon < -180 || out.lon > 180) { out.problems.push('longitude not readable'); out.lon = null; }

    out.ok = out.problems.length === 0;
    return out;
  }

  return { parseStamp, monthIndex };
});

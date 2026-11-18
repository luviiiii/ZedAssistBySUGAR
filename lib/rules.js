/* ZED Assist - the assessor's checking rules as pure functions (easy to test).
 * Every check returns { pass: boolean, issues: string[], ... }. The tool only PROPOSES; the assessor decides. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./geo'), require('./dates'));
  else root.ZA = Object.assign(root.ZA || {}, factory(root.ZA, root.ZA));
})(typeof self !== 'undefined' ? self : this, function (geo, dates) {
  const { distanceMeters, classifyDistance } = geo;
  const { parseDMY, cmp, daysBetween, addMonths, fmt } = dates;

  /** "21.3493297" -> "21.34": the integer part and the first two digits after the decimal point (cut, not rounded). */
  function firstDecimals(x, n) {
    const [i, d] = Math.abs(x).toFixed(7).split('.');
    return (x < 0 ? '-' : '') + i + '.' + d.slice(0, n || 2);
  }

  /**
   * Assessor rule: every photo's Lat and Long must agree with the reference location from the Overview tab in the
   * integer part and the first TWO digits after the decimal point. The rest may differ.
   * The stamp must also carry the assessment (submission) date.
   * @param stamps [{label, ok, lat, lon, date, time24}]
   * @param ref {lat, lon}
   * @param opts {submissionDate:'YYYY-MM-DD'|null}
   */
  function checkLocation(stamps, ref, opts) {
    const o = opts || {};
    const items = stamps.map((s) => {
      if (!s.ok || s.lat == null || s.lon == null) return { label: s.label, status: 'unread', distance: null, dateOk: null };
      const d = distanceMeters(ref, { lat: s.lat, lon: s.lon });
      const latOk = firstDecimals(s.lat) === firstDecimals(ref.lat), lonOk = firstDecimals(s.lon) === firstDecimals(ref.lon);
      return {
        label: s.label,
        status: latOk && lonOk ? 'pass' : 'fail',
        latOk, lonOk,
        shown: `${firstDecimals(s.lat)}.. , ${firstDecimals(s.lon)}..`,
        distance: Math.round(d * 10) / 10,
        dateOk: o.submissionDate ? s.date === o.submissionDate : null,
      };
    });
    const bad = items.filter((i) => i.status === 'fail');
    const review = items.filter((i) => i.status === 'unread' || i.dateOk === false);
    const refShown = `${firstDecimals(ref.lat)}.. , ${firstDecimals(ref.lon)}..`;
    return {
      pass: bad.length === 0 && review.length === 0,
      fail: bad.length > 0,
      needsReview: review.length > 0,
      items,
      issues: [
        ...bad.map((i) => `${i.label}: Lat/Long ${i.shown} differ from the reference ${refShown} in the first two decimals`),
        ...review.map((i) => (i.status === 'unread' ? `${i.label}: stamp not readable - check by eye` : `${i.label}: stamp date differs from submission date`)),
      ],
    };
  }

  /**
   * Delivery records: at least 2 orders; order date before dispatch and delivery; nothing in the future.
   * rows: [{order, dispatch, delivery}] as text (dd-mm-yy). Rows that are completely empty are ignored.
   */
  function checkDeliveryRows(rows, todayISO) {
    const issues = [];
    const today = parseDMY(todayISO);
    const used = (rows || []).filter((r) => r && (r.order || r.dispatch || r.delivery));
    if (used.length < 2) issues.push(`Only ${used.length} order(s) entered - at least 2 customers are needed`);
    used.forEach((r, i) => {
      const n = i + 1;
      const o = parseDMY(r.order), d = parseDMY(r.dispatch), v = parseDMY(r.delivery);
      if (!o || !d || !v) { issues.push(`Row ${n}: a date is missing or unreadable`); return; }
      if (cmp(o, d) >= 0) issues.push(`Row ${n}: order date ${fmt(o)} is not before dispatch date ${fmt(d)}`);
      if (cmp(o, v) >= 0) issues.push(`Row ${n}: order date ${fmt(o)} is not before delivery date ${fmt(v)}`);
      if (cmp(d, v) > 0) issues.push(`Row ${n}: dispatch date ${fmt(d)} is after delivery date ${fmt(v)}`);
      [['order', o], ['dispatch', d], ['delivery', v]].forEach(([k, x]) => { if (today && cmp(x, today) > 0) issues.push(`Row ${n}: ${k} date ${fmt(x)} is in the future`); });
    });
    return { pass: issues.length === 0, issues, rows: used.length };
  }

  /** Review record: period between 1 and 6 months (inclusive), no future dates. */
  function checkReviewPeriod(from, to, todayISO) {
    const issues = [];
    const f = parseDMY(from), t = parseDMY(to), today = parseDMY(todayISO);
    if (!f || !t) return { pass: false, issues: ['Period dates missing or unreadable'], days: null };
    if (cmp(f, t) >= 0) issues.push('Period "from" is not before "to"');
    if (cmp(addMonths(f, 1), t) > 0) issues.push(`Period ${fmt(f)} to ${fmt(t)} is shorter than 1 month`);
    if (cmp(addMonths(f, 6), t) < 0) issues.push(`Period ${fmt(f)} to ${fmt(t)} is longer than 6 months`);
    if (today && cmp(t, today) > 0) issues.push(`Period end ${fmt(t)} is in the future`);
    return { pass: issues.length === 0, issues, days: daysBetween(f, t) };
  }

  /** Training record: date not in the future and within the last year. (A missing time is not an issue.) */
  function checkTrainingDate(dateStr, todayISO) {
    const issues = [];
    const d = parseDMY(dateStr), today = parseDMY(todayISO);
    if (!d) return { pass: false, issues: ['Training date missing or unreadable'], old: false };
    if (today && cmp(d, today) > 0) issues.push(`Training date ${fmt(d)} is in the future`);
    const old = today ? daysBetween(d, today) > 365 : false;
    if (old) issues.push(`Training date ${fmt(d)} is more than 1 year old`);
    return { pass: issues.length === 0, issues, old };
  }

  /** Fire extinguisher: the refilling (next-due) date must not have passed. */
  function checkFireExtinguisher(refillStr, todayISO) {
    const d = parseDMY(refillStr), today = parseDMY(todayISO);
    if (!d) return { pass: false, issues: ['Refilling date missing or unreadable'], daysLeft: null };
    const daysLeft = today ? daysBetween(today, d) : null;
    const issues = [];
    if (daysLeft != null && daysLeft < 0) issues.push(`Refilling date ${fmt(d)} has passed (expired ${-daysLeft} days ago)`);
    return { pass: issues.length === 0, issues, daysLeft };
  }

  /** Does the serial already exist in the same calendar month? rows: [{serial, dateISO}] */
  function duplicateSerialInMonth(serial, monthISO, rows) {
    const s = String(serial || '').trim();
    const ym = String(monthISO || '').slice(0, 7);
    return (rows || []).filter((r) => String(r.serial).trim() === s && String(r.dateISO || '').slice(0, 7) === ym);
  }

  /** NC count -> the assessor's final remark. */
  function finalDecision(results) {
    const ncs = results.filter((r) => r.conformance === 'No');
    return { ncCount: ncs.length, ncCodes: ncs.map((r) => r.code), kind: ncs.length ? 'ncRaised' : 'qualified' };
  }

  return { firstDecimals, checkLocation, checkDeliveryRows, checkReviewPeriod, checkTrainingDate, checkFireExtinguisher, duplicateSerialInMonth, finalDecision };
});

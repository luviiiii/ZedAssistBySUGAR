/* ZED Assist - geolocation helpers. Works in the browser (window.ZA) and in Node (require). */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.ZA = Object.assign(root.ZA || {}, factory());
})(typeof self !== 'undefined' ? self : this, function () {
  const R = 6371008.8; // mean earth radius in metres
  const rad = (x) => (x * Math.PI) / 180;

  /** Distance in metres between two {lat, lon} points (equirectangular, fine for short distances). */
  function distanceMeters(a, b) {
    const dLat = rad(b.lat - a.lat);
    const dLon = rad(b.lon - a.lon) * Math.cos(rad((a.lat + b.lat) / 2));
    return Math.sqrt(dLat * dLat + dLon * dLon) * R;
  }

  const DEFAULT_TOLERANCE = { ok: 50, max: 100 };

  /** 'pass' up to tol.ok metres, 'review' up to tol.max, otherwise 'fail'. */
  function classifyDistance(d, tol) {
    const t = Object.assign({}, DEFAULT_TOLERANCE, tol || {});
    if (d <= t.ok) return 'pass';
    if (d <= t.max) return 'review';
    return 'fail';
  }

  return { distanceMeters, classifyDistance, DEFAULT_TOLERANCE };
});

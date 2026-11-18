/* ZED Assist - clause definitions (what to check for each clause) and the function that turns the
 * assessor's answers into a PROPOSED outcome + remark. It never decides: the assessor confirms each one. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports)
    module.exports = factory(require('./remarks'), require('./rules'), require('./dates'));
  else root.ZA = Object.assign(root.ZA || {}, factory(root.ZA, root.ZA, root.ZA));
})(typeof self !== 'undefined' ? self : this, function (remarks, rules, dates) {
  const { REMARKS, fillRemark } = remarks;
  const { NC, YES, YES_ALT } = REMARKS;

  const orgCheck = { id: 'orgMatches', label: 'Organization name equals the name board' };
  const signedCheck = { id: 'signed', label: 'Signed' };

  const CLAUSES = [
    { code: 'SITE', group: 'Basic Information', title: 'Site exterior / name board', location: true,
      checks: [
        { id: 'nameMatches', label: 'Name on the board equals the registered unit name', nc: 'SITE.nameMismatch' },
        { id: 'addressMatches', label: 'Address / PIN on the board matches the registered address - OR no address is shown at all (that is fine: answer true)', nc: 'SITE.addressMismatch' },
        { id: 'boardFixed', label: 'The board / poster is OFFICIAL and proper: professionally printed or painted, fixed in place, shows the unit name clearly - NOT a makeshift, handwritten, loose or temporary one ("kaam chalau")', nc: 'SITE.temporaryBoard' },
      ] },
    { code: 'PRODUCT', group: 'Basic Information', title: 'Product', location: true,
      checks: [
        { id: 'productMatches', label: 'Product photo matches the product name and NIC activity', nc: 'PRODUCT.mismatch' },
        { id: 'descOk', label: 'Description photo gives product name / material / size / weight', nc: 'PRODUCT.specifications' },
      ] },

    { code: '1.1', group: '1 Leadership', title: 'Roles & responsibilities defined', nonNC: true },
    { code: '1.2', group: '1 Leadership', title: 'Regulatory compliances reviewed', nonNC: true },
    { code: '2.1', group: '2 Swachh Workplace', title: 'Cleaning & hygiene processes', nonNC: true },
    { code: '2.2', group: '2 Swachh Workplace', title: 'Work areas clean, organized, identified', location: true,
      checks: [
        { id: 'isFood', label: 'The unit is a FOOD-related business (food, grain, flour, spices, snacks, beverages, dairy, etc.). Own packaging is expected only for these', info: true },
        { id: 'workSign', label: 'Working area: a sign names the area', nc: '2.2.allNotIdentified' },
        { id: 'workMachines', label: 'Working area: working machines visible', nc: '2.2.irrelevant' },
        { id: 'toiletSign', label: 'Toilet: sign on the door', nc: '2.2.allNotIdentified' },
        { id: 'commodeClean', label: 'Toilet: the commode is clean', nc: '2.2.toiletNotClean' },
        { id: 'rmSign', label: 'Raw material store: sign + raw input material', nc: '2.2.allNotIdentified' },
        { id: 'fgSign', label: 'Final product store: sign', nc: '2.2.allNotIdentified' },
        { id: 'fgPackaging', onlyIf: 'isFood', label: "Final product store: the unit's OWN packaging (bags/boxes printed with the unit's name or brand) is visible. Plain/unbranded sacks or no packaged goods = false (it is then not a manufacturer: Atta Chakki NC)", nc: '2.2.nonManufacturing' },
      ] },
    { code: '3.1', group: '3 Occupational Safety', title: 'Safety risks identified', nonNC: true },
    { code: '3.2', group: '3 Occupational Safety', title: 'Fire extinguisher, PPE, safety posters', location: true,
      inputs: [
        { id: 'feSerial', label: 'Fire extinguisher serial no.', type: 'text' },
        { id: 'feRefill', label: 'Refilling DUE date on slip - the date it must be refilled by (dd-mm-yyyy)', type: 'date' },
      ],
      checks: [
        { id: 'feReadable', label: 'Extinguisher slip / serial readable', nc: '3.2.feBothNotVisible' },
        { id: 'gaugeGreen', label: 'Gauge needle in the green band', nc: '3.2.feLowPressure' },
        { id: 'ppe', label: 'Worker wears gloves and suitable PPE', nc: '3.2.noPpe' },
        { id: 'posters', label: 'Safety posters displayed', nc: '3.2.noPosters' },
      ] },
    { code: '3.3', group: '3 Occupational Safety', title: 'Safety training record', training: 'safety',
      inputs: [{ id: 'trainingDate', label: 'Training date (dd-mm-yyyy)', type: 'date' }],
      checks: [
        { ...orgCheck, nc: 'TRAINING:safety:otherOrg' },
        { id: 'topicOk', label: 'Topic is safety / fire safety', nc: 'TRAINING:safety:none' },
        { id: 'complete', label: 'All details filled (trainer, location, participants)', nc: 'TRAINING:safety:incomplete' },
        { ...signedCheck, nc: 'TRAINING:safety:incomplete' },
      ] },
    { code: '4.1', group: '4 Timely Delivery', title: 'Mechanism to record deliveries', alwaysYes: 'Assessor rule: Yes when delivery records exist under 4.2' },
    { code: '4.2', group: '4 Timely Delivery', title: 'Delivery records (at least 2 customers)', location: true,
      inputs: [{ id: 'rows', label: 'Orders (order / dispatch / delivery dates)', type: 'deliveryRows' }],
      checks: [
        { ...orgCheck, nc: '4.2.otherOrg' },
        { ...signedCheck, nc: '4.2.incomplete' },
      ] },
    { code: '5.1', group: '5 Quality Management', title: 'Quality requirements established', nonNC: true },
    { code: '5.2', group: '5 Quality Management', title: 'Quality training record', training: 'quality',
      inputs: [{ id: 'trainingDate', label: 'Training date (dd-mm-yyyy)', type: 'date' }],
      checks: [
        { ...orgCheck, nc: 'TRAINING:quality:otherOrg' },
        { id: 'topicOk', label: 'Topic is quality / inspection', nc: 'TRAINING:quality:none' },
        { id: 'complete', label: 'All details filled (trainer, location, participants)', nc: 'TRAINING:quality:incomplete' },
        { ...signedCheck, nc: 'TRAINING:quality:incomplete' },
      ] },
    { code: '6.1', group: '6 Energy Management', title: 'Energy sources and targets', nonNC: true },
    { code: '6.2', group: '6 Energy Management', title: 'Energy management training',
      alwaysYes: 'Always Yes. Only the remark changes: evidence found or not found',
      inputs: [{ id: 'trainingDate', label: 'Training date (dd-mm-yyyy)', type: 'date' }],
      checks: [{ id: 'found', label: 'An Energy Management training sheet was found (look in 6.3 and 7.1 uploads)' }] },
    { code: '6.3', group: '6 Energy Management', title: 'Energy conservation posters', location: true,
      checks: [
        { id: 'posterShown', label: 'Energy-saving poster displayed', nc: '6.3.none' },
        { id: 'posterFixed', label: 'Poster is fixed, not loose / temporary', nc: '6.3.temporary' },
      ] },
    { code: '7.1', group: '7 Measurement & Analysis', title: 'Rejections / complaints / energy record', location: true,
      inputs: [
        { id: 'periodFrom', label: 'Period from (dd-mm-yyyy)', type: 'date' },
        { id: 'periodTo', label: 'Period to (dd-mm-yyyy)', type: 'date' },
      ],
      checks: [
        { ...orgCheck, nc: '7.1.otherOrg' },
        { ...signedCheck, nc: '7.1.incomplete' },
      ] },
  ];

  const byCode = (code) => CLAUSES.find((c) => c.code === code);

  function resolveNc(path, vars) {
    if (!path) return '';
    let text;
    if (path.startsWith('TRAINING:')) {
      const [, topic, key] = path.split(':');
      text = NC.TRAINING(topic)[key];
    } else {
      // clause codes contain a dot themselves ("3.2.feExpired"), so split at the LAST dot
      const cut = path.lastIndexOf('.');
      const grp = path.slice(0, cut), key = path.slice(cut + 1);
      text = (NC[grp] || {})[key];
    }
    return fillRemark(text || '', vars);
  }

  /**
   * @param code  clause code, e.g. '3.2'
   * @param state {checks:{id:true|false|undefined}, inputs:{...}}
   * @param ctx   {today:'YYYY-MM-DD', location:<checkLocation result>|null, serialDuplicate:boolean,
   *               unitName, unitAddress, submissionDate}
   * @returns {outcome:'yes'|'no'|'pending', remark, reasons:string[], ncPath:string|null, pending:string[], notes:string[]}
   */
  function evaluateClause(code, state, ctx) {
    const def = byCode(code);
    const st = state || { checks: {}, inputs: {} };
    const checks = st.checks || {};
    const inputs = st.inputs || {};
    const c = ctx || {};
    const pd = inputs.trainingDate ? dates.parseDMY(inputs.trainingDate) : null;
    const vars = { date: pd ? dates.fmt(pd) : inputs.trainingDate || '' };
    const res = { outcome: 'yes', remark: '', reasons: [], ncPath: null, pending: [], notes: [] };
    if (!def) return Object.assign(res, { outcome: 'pending', reasons: ['Unknown clause'] });

    // ----- 4.1 / 6.2: always Yes -----------------------------------------------------
    if (def.alwaysYes) {
      res.notes.push(def.alwaysYes);
      if (code === '6.2') {
        if (checks.found === false) res.remark = YES_ALT['6.2'].notFound;
        else res.remark = fillRemark(YES['6.2'], vars);
        if (checks.found === undefined) res.pending.push('Was an energy training sheet found?');
        if (checks.found !== false && !vars.date) res.pending.push('Training date');
      } else res.remark = YES[code];
      if (res.pending.length) res.outcome = 'pending';
      return res;
    }

    // ----- collect issues -----------------------------------------------------------
    const issues = []; // {nc, reason}
    (def.checks || []).forEach((k) => {
      if (k.onlyIf && checks[k.onlyIf] === false) return;      // e.g. own packaging is only expected of a food business
      if (k.info) { if (checks[k.id] === undefined) res.pending.push(k.label); return; }   // information only, never an NC by itself
      if (checks[k.id] === false) issues.push({ nc: k.nc, reason: `NOT OK: ${k.label}` });
      else if (checks[k.id] === undefined) res.pending.push(k.label);
    });

    // a unit with no packaging of its own is a service provider (Atta Chakki), not a manufacturer: that NC is the one to report
    issues.sort((a, b) => (b.nc === '2.2.nonManufacturing') - (a.nc === '2.2.nonManufacturing'));

    if (def.location && c.location) {
      if (c.location.fail) issues.unshift({ nc: 'GENERAL.locationMismatch', reason: 'Photo location is too far from the reference: ' + c.location.issues.slice(0, 2).join('; ') });
      else if (c.location.needsReview) res.notes.push('Location needs a look: ' + c.location.issues.slice(0, 3).join('; '));
    }

    if (code === '3.2') {
      if (inputs.feRefill) {
        const fe = rules.checkFireExtinguisher(inputs.feRefill, c.today);
        if (!fe.pass) issues.push({ nc: '3.2.feExpired', reason: fe.issues[0] });
        else res.notes.push(`Refilling date valid (${fe.daysLeft} days left)`);
      } else res.pending.push('Refilling date');
      if (!inputs.feSerial) res.pending.push('Fire extinguisher serial');
      if (c.serialDuplicate) issues.push({ nc: '3.2.feSameAsOther', reason: `Serial ${inputs.feSerial} already exists in the sheet in the same month` });
    }

    if (def.training) {
      const td = rules.checkTrainingDate(inputs.trainingDate, c.today);
      if (!inputs.trainingDate) res.pending.push('Training date');
      else if (!td.pass) issues.push({ nc: td.old ? `TRAINING:${def.training}:old` : `TRAINING:${def.training}:incomplete`, reason: td.issues[0] });
    }

    if (code === '4.2') {
      const dr = rules.checkDeliveryRows(inputs.rows || [], c.today);
      if (!(inputs.rows || []).some((r) => r && (r.order || r.dispatch || r.delivery))) res.pending.push('Order rows');
      else if (!dr.pass) issues.push({ nc: '4.2.incomplete', reason: dr.issues.join('; ') });
    }

    if (code === '7.1') {
      if (!inputs.periodFrom || !inputs.periodTo) res.pending.push('Period dates');
      else {
        const rp = rules.checkReviewPeriod(inputs.periodFrom, inputs.periodTo, c.today);
        if (!rp.pass) issues.push({ nc: '7.1.incomplete', reason: rp.issues.join('; '), a: rp.issues[0] });
        else res.notes.push(`Period is ${rp.days} days (within 1 to 6 months)`);
      }
    }

    // ----- decide -------------------------------------------------------------------
    if (def.nonNC) {
      res.remark = YES[code];
      res.notes.push('Non-NC clause: always Yes (an NC can never be raised here)');
      return res;
    }

    const yesKey = code === 'SITE' || code === 'PRODUCT' ? code : code;
    if (issues.length) {
      const first = issues[0];
      const v = Object.assign({}, vars);
      if (/nameMismatch$/.test(first.nc)) v.a = c.unitName;
      if (/addressMismatch$/.test(first.nc)) v.a = c.unitAddress;
      if (first.a) v.a = first.a;
      res.outcome = 'no';
      res.ncPath = first.nc;
      res.reasons = issues.map((i) => i.reason);
      res.remark = resolveNc(first.nc, v);
      return res;
    }
    res.remark = fillRemark(YES[yesKey], vars);
    if (res.pending.length) res.outcome = 'pending';
    return res;
  }

  return { CLAUSES, getClause: byCode, evaluateClause, resolveNc };
});

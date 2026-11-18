/* ZED Assist - the assessor's remark library (from Bronze_Final_Remarks.xlsx).
 * Wording is kept exactly as the assessor uses it. {date} / {a} / {b} are filled in by the tool. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.ZA = Object.assign(root.ZA || {}, factory());
})(typeof self !== 'undefined' ? self : this, function () {
  const YES = {
    SITE: "The photo of the organization's exterior, name board, and address has been verified against the registered information, and the geolocation was found to be correct.",
    PRODUCT: 'Product photo identified and confirmed against description provided in profile.',
    '1.1': 'Kindly ensure that Role and Responsibilities (Job Description) are clearly defined, documented and understood by all employees.',
    '1.2': 'Kindly ensure that all the relevant regulatory requirements are identified and reviewed periodically for ensuring the fulfillment of compliance requirements along with ZED requirements.',
    '2.1': 'Organization shall establish Procedures for Cleaning and Hygiene addressing to the nature of product, process and customer requirements. Cleaning calendar can be made and implementation to be carried out.',
    '2.2': 'Organization has provided relevant evidences such as working area, RM storage and FG storage area, which are demonstrating that manufacturing activity is being carried out in registered unit as per their selected NIC. All equipment, tools, workspaces, Toilets & storage areas are found maintained in clean, uncluttered & organized condition with identification as required.',
    '3.1': 'Organization shall ensure safety measures are implemented. Safety risks are identified and measures are taken to eliminate or minimize risks.',
    '3.2': 'Safety system such as fire extinguisher, safety posters and use of PPE are evident as Organization has provided relevant evidences. Serial number, filling-refilling dates are observed valid on fire extinguisher. Pressure gauge of fire extinguisher found in green zone. Organization shall ensure to monitor fire extinguisher regularly and inspect / refill the same within due time. Also, kindly ensure that all safety posters are displayed at safe, permanent place and is understandable and visible to all employees during working.',
    '3.3': 'Organization has provided training to employees covering safety topics. Also, ensure to make training calendar and monitor adherence of actual vs planned training schedule. Kindly ensure to maintain training records in standard format having company name or logo on it. Training Date: {date}',
    '4.1': 'Organization has mechanism to record deliveries.',
    '4.2': 'Delivery measurement system is in place. Records for deliveries are provided with appropriate information mentioned in it such as expected delivery date, actual delivery date, ordered and dispatched quantity.',
    '5.1': 'Organization shall ensure Quality requirements for products and processes are established and monitored.',
    '5.2': 'Organization has provided training to employees covering production quality topics. Also, ensure to make training calendar and monitor adherence of actual vs planned training schedule. Kindly ensure to maintain training records in standard format having company name or logo on it. Training date: {date}',
    '6.1': 'Organization shall ensure to identify the energy sources and set targets for energy efficiency.',
    '6.2': 'Organization has provided training to employees covering Energy management topics. Also, ensure to make training calendar and monitor adherence of actual vs planned training schedule. Kindly ensure to maintain training records in standard format having company name or logo on it. Training date: {date}',
    '6.3': 'Organization have provided relevant evidences regarding display of posters encouraging energy conservation.',
    '7.1': 'Rejections, Energy Savings, Customer Complaints are measured and reviewed by senior management. Relevant evidences are provided for review.',
  };

  // 6.2 stays "Yes" even when no energy training record exists (assessor's rule); only the wording changes.
  const YES_ALT = {
    '6.2': { notFound: 'Kindly ensure to provide appropriate energy management trainings to all employees.' },
  };

  // Clauses that must never receive an NC ("Non NC CL").
  const NON_NC = ['1.1', '1.2', '2.1', '3.1', '5.1', '6.1'];

  const NC = {
    GENERAL: {
      duplicate: 'Kindly upload actual images as per parameter requirement from actual manufacturing unit location, which is registered for ZED. Attached evidences are irrelevant / duplicate (photos on photos), which is not allowed.',
      location: 'Kindly upload actual images as per parameter requirement from actual manufacturing unit location, which is registered for ZED. Attached evidences are uploaded from other location, which is not allowed.',
      closeUp: 'Kindly provide appropriate evidence of {a} (Overview) for review. Attached evidence is close up photo of {a}, which is not adequately showing implementation of {a}.',
      blank: 'Kindly upload actual images of {a} as per parameter requirement from actual manufacturing unit location, which is registered for ZED. Attached evidence is blank.',
      locationMismatch: 'Geolocation coordinates does not match with the registered location coordinates.',
      nonManufacturing: 'The enterprise is a non-manufacturing unit (Service/Trading). As per scheme guidelines, ZED Bronze is restricted to manufacturing MSMEs only.',
      wrongNic: 'It is observed that, organization has selected wrong NIC. Actual product category is {a}. However, selected one is {b}. Kindly correct the same by writing the mail to QCI to update the same on ZED portal.',
    },
    SITE: {
      missing: 'Kindly provide organization name board and site exterior photos for review. Attached photos are not relevant.',
      temporaryBoard: 'Photos of organization site exterior, name board and address verified against registered information and geo location, found ok. However, name board of the organization is temporary. Hence, kindly provide photos of permanent name board.',
      boardMissing: 'Kindly provide organization name board photo for review. Attached evidences are of site exterior only.',
      exteriorMissing: 'Kindly provide organization site exterior photo for review. Attached evidences are of name board only.',
      nameMismatch: 'Discrepancy found in organization name. Registered name for ZED is "{a}" and as per name board, it is "{b}". Kindly review and correct the same accordingly.',
      addressMismatch: 'Discrepancy found in address of organization. Registered address for ZED is "{a}" and as per name board / geo location, it is "{b}". Kindly review and correct the same accordingly and provide appropriate evidences.',
    },
    PRODUCT: {
      mismatch: 'Kindly provide appropriate photos of product manufactured in registered organization. Attached photos are not according to NIC selected / process defined.',
      irrelevant: 'Kindly provide appropriate photos of product manufactured in registered organization. Attached photos are not relevant to product.',
      description: 'Kindly provide Photo of Product description, Attached photos are not relevant to product.',
      specifications: 'Kindly mention product specifications. Product name/material used/dimension/approx. weight etc.',
    },
    '2.2': {
      workNotClean: 'Kindly provide appropriate evidences of clean & organized work / production area photos for review. Attached photos are demonstrating that work / production area is not maintained in clean condition.',
      toiletNotClean: 'Kindly provide appropriate evidences of clean & hygeinic toilet facility photos for review. Attached photos are demonstrating that toilet is not maintained in clean condition.',
      rmNotClean: 'Kindly provide appropriate evidences of clean & organized raw material storage area photos for review. Attached photos are demonstrating that raw material storage area is not maintained in clean condition.',
      fgNotClean: 'Kindly provide appropriate evidences of clean & organized final goods storage area photos for review. Attached photos are demonstrating that  final goods storage area is not maintained in clean condition.',
      allNotClean: 'Kindly provide appropriate and actual evidences of well maintained, neat and clean production / work area, toilet, raw material storage and finished goods storage. Attached photos are representing that these are not maintained in clean condition / not organized well in manner.',
      allNotIdentified: 'Kindly provide appropriate and actual evidences of identified and clean maintained production / work area, toilet, raw material storage and finished goods storage. It is observed that,  identification of work area / toilet / raw material storage / finished goods storage is not done.',
      irrelevant: 'Kindly provide appropriate and actual evidences of production / work area, toilet, raw material storage and finished goods storage. Attached photos are not relevant.',
      nonManufacturing: 'The enterprise is a non-manufacturing unit (Service/Trading). As per scheme guidelines, ZED Bronze is restricted to manufacturing MSMEs only.',
    },
    '3.2': {
      feMissing: 'Kindly provide evidence of fire extinguisher with filling / refilling information and serial number mentioned on fire extinguishers.',
      feExpired: 'Kindly inspect and refill the fire extinguisher and provide evidence of it with  filling / refilling information sticker pasted on fire extinguishers. Attached fire extinguisher is overdue to refilling.',
      feLowPressure: 'Kindly inspect and refill the fire extinguisher and provide evidence of it with  filling / refilling information sticker pasted on fire extinguishers. Attached fire extinguisher is at low pressure mark.',
      feDateNotVisible: 'Kindly provide evidence of fire extinguisher with filling / refilling information sticker pasted on fire extinguishers. Attached evidence is not demonstrating filling / refilling information.',
      feSerialNotVisible: 'Kindly provide evidence of fire extinguisher with serial number mentioned on fire extinguishers. Serial number is not mentioned / visible in attached photos of fire extinguisher.',
      feBothNotVisible: 'Kindly provide evidence of fire extinguisher with filling / refilling information and serial number mentioned on fire extinguishers. Filling / refilling information and Serial number is not mentioned / visible in attached photos of fire extinguisher.',
      feSameAsOther: 'Kindly provide evidences of independent fire extinguisher, which is exclusively installed in registered organization. Attached fire extinguisher has been already applied by other organization. Hence, it can not be considered for assessment.',
      feDamaged: 'Kindly provide evidence of appropriate fire extinguisher with  filling / refilling information sticker pasted on fire extinguishers. Attached fire extinguisher is rusted / damaged / without aiming pipe / not feasible for industrial requirement.',
      noPpe: 'Kindly provide evidences of relevant and appripriate PPE usage by employees. Attached photos are not demonstrating PPE usage by employees.',
      wrongPpe: 'Kindly provide evidences of relevant and appripriate PPE usage by employees. It is observed that employees are not using relevant and necessary PPEs during working.',
      noPosters: 'Kindly provide evidences of display of safety posters posted at working area. Attached photos are not relevant.',
      postersNoInstruction: 'Kindly provide evidences of display of safety posters posted at working area demonstrating safety precautions. Attached photos are not demonstrating safety instructions.',
    },
    TRAINING: (topic) => ({
      none: `Kindly provide appropriate ${topic} training records for review. Attached evidences are not relevant.`,
      otherOrg: `Kindly provide appropriate ${topic} training records for review. Organization name mentioned in training record is different than registered organization`,
      old: `Kindly provide appropriate and valid ${topic} training records dated within previous one year for review. Attached training record is obsolete as it is more than 1 year old.`,
      incomplete: `Kindly provide appropriate ${topic} training records with all necessary information for review. Attached training record is incomplete.`,
    }),
    '4.1': { none: 'Kindly upload appropriate evidences of material delivery records. Attached photos are not of delivery records.' },
    '4.2': {
      none: 'Kindly provide material delivery records of at least 2 customers / shipments / consignments with appropriate information mentioned in it such as expected delivery date, actual delivery date, ordered and dispatched quantity. Attached evidences are not relevant.',
      incomplete: 'Kindly provide material delivery records of at least 2 customers / shipments / consignments with appropriate information mentioned in it such as expected delivery date, actual delivery date, ordered and dispatched quantity. Attached evidences are incomplete / information is missing.',
      otherOrg: 'Kindly provide material delivery records of at least 2 customers / shipments / consignments with appropriate information mentioned in it such as expected delivery date, actual delivery date, ordered and dispatched quantity. Organization name mentioned in delivery record is different than registered organization',
      invoice: 'Kindly provide material delivery records of at least 2 customers / shipments / consignments with appropriate information mentioned in it such as expected delivery date, actual delivery date, ordered and dispatched quantity. Attached evidences are tax invoice, containing only commercial terms.',
    },
    '6.3': {
      none: 'Kindly provide appropriate evidences of display of posters encouraging energy conservations. Attached evidences are not relevant.',
      temporary: 'Kindly provide appropriate evidences of permanent display of posters encouraging energy conservations. It is observed that, energy posters are not displayed permanently.',
    },
    '7.1': {
      none: 'Kindly provide management review report of Rejections, Energy Savings, Customer Complaints. Attached evidences are not relevant.',
      incomplete: 'Kindly provide management review report of Rejections, Energy Savings, Customer Complaints. Attached evidences are incomplete, as {a}.',
      old: 'Kindly provide recent management review report of Rejections, Energy Savings, Customer Complaints. Attached evidences are older (of previous calender year).',
      otherOrg: 'Kindly provide appropriate review records for review. Organization name mentioned in attached record is different than registered organization',
    },
  };

  const FINAL = {
    qualified: 'Organization is maintained well in condition. Organization has provided the evidence as per the bronze level certification.',
    ncRaised: 'Kindly provide necessary and relevant evidences to close the NC.',
  };

  function fill(template, vars) {
    return String(template).replace(/\{(\w+)\}/g, (m, k) => (vars && vars[k] != null && vars[k] !== '' ? vars[k] : m));
  }

  return { REMARKS: { YES, YES_ALT, NC, FINAL, NON_NC }, fillRemark: fill };
});

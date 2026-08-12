/**
 * Places we serve. Single source of truth — used by the About page copy and by
 * the `areaServed` field of the LocalBusiness structured data, so what Google
 * is told always matches what the site says.
 */

/** DFW metro — local pickup and delivery. */
export const DFW_CITIES = [
  'Plano',
  'Frisco',
  'Irving',
  'Denton',
  'McKinney',
  'Allen',
  'Richardson',
  'Garland',
  'The Colony',
  'Little Elm',
  'Coppell',
  'Addison',
  'Farmers Branch',
  'Rockwall',
  'Lewisville',
  'Carrollton',
  'Prosper',
  'Celina',
  'Dallas',
];

/** Further afield in Texas — reached by courier. */
export const WIDER_TEXAS_CITIES = ['Austin', 'Houston', 'Waco'];

export const ALL_SERVICE_AREAS = [...DFW_CITIES, ...WIDER_TEXAS_CITIES];

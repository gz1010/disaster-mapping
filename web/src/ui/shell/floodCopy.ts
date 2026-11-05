// Flood wording (brief 5, PLAN-5 §5, CONTRACT §16.14): every fixed string of the flood views, verbatim from the plan.
// Views and tests read them from here and never retype them. `{x}` are slots, filled with `fillCopy(text, { x })`.
// Strings marked (B) are also sent by the backend (backend/fire3d/floods/copy.py, CONTRACT §16.14); the web keeps a copy
// for the cases where the request itself fails (no answer to read the reason from).
// The wording guard (floodCopy.test.ts, also used by the other flood roles' tests): no string here, in any other
// `*[Ff]lood*[Cc]opy*.ts` file (test files excepted) or in a rendered flood view says "safe", "low risk", "all clear",
// "dry", "receded", "ended", "no danger", ... in Fire-3d's own voice (PLAN-5 §5.1). Text an issuer wrote (NWS, FEMA,
// Cal OES) is rendered inside an element with `data-verbatim` (its issuer named next to it) and is not scanned.
import { NOT_ALL_CLEAR, PROTOTYPE_LINE } from './fixedCopyText'

export { NOT_ALL_CLEAR, PROTOTYPE_LINE }

/** Fill `{slot}` placeholders (a missing value leaves the slot visible, so a test notices it). */
export function fillCopy(text: string, values: Record<string, string | number>): string {
  return text.replace(/\{([^{}]+)\}/g, (m, k: string) => (k in values ? String(values[k]) : m))
}

// ------------------------------------------------------------------------------------------------ §5.2 lists, status
export const FLOOD_LIST_ABSENCE = 'Only floods with an NWS flood product or a river gauge at flood stage are listed. A place with no marker is not an all-clear. Follow local officials.'
export const FLOOD_LIST_ABSENCE_SHORT = 'Only listed floods · not an all-clear'
export const FLOOD_LIST_EMPTY_VIEW = 'No listed floods in this view.'
export const FLOOD_LIST_EMPTY =
  'The NWS lists no flood warnings or advisories, and no river gauge reads at flood stage, in the lower 48 right now. Not an all-clear: flash floods can start within minutes. Follow local officials.'
/** (B) */
export const FLOOD_NWS_DOWN = 'NWS flood warnings could not be reached right now; floods are listed from river gauges only. That is not an all-clear.'
/** (B) */
export const FLOOD_GAUGES_DOWN = 'River gauges could not be reached right now; floods are listed from NWS products only. That is not an all-clear.'
/** (B) */
export const FLOOD_LISTS_DOWN = 'The flood lists (NWS warnings and river gauges) could not be reached right now. Not an all-clear: follow local officials.'
/** (B) */
export const FLOOD_LISTS_503 = 'The flood lists could not be reached right now; try again later.'
export const FLOOD_NOT_LISTED = 'This flood is no longer listed.'
export const FLOOD_LAST_KNOWN = 'This flood is no longer in the NWS lists Fire-3d reads. Shown: what Fire-3d last saw on {date}. Not an all-clear. Follow local officials.'
/** (B) */
export const GAUGE_ONLY_CAVEAT = 'No NWS flood product names this gauge right now.'
export const WATCHES_HIDDEN = '{n} Flood Watches hidden · Show'
export const WATCHES_HIDDEN_ONE = '1 Flood Watch hidden · Show'
export const FLOOD_HERE_IN_FIRES = 'NWS flood products are in effect here · Show floods'
export const DEMO_TAG = 'DEMO'
export const PAST_PREPARING = 'Preparing past floods (the first time takes about 10 minutes)…'
export const PAST_RULE_NOTE =
  'Past years list river floods that reached moderate or major flood stage at an NWS gauge, and flash floods NWS tagged considerable or catastrophic or called an emergency. Smaller floods are not listed; not an all-clear.'
export const PAST_RULE_NOTE_FALLBACK =
  'Past years list NWS river Flood Warnings at river gauges and NWS Flash Flood Emergencies. Other flash floods are not listed; not an all-clear.'

/** "{n} Flood Watches hidden · Show" (singular for one). */
export function watchesHidden(n: number): string {
  return n === 1 ? WATCHES_HIDDEN_ONE : fillCopy(WATCHES_HIDDEN, { n })
}

/** The top bar's status line (mono, upper case). */
export const BAR_STATUS = {
  count: '{DATE} · {N} FLOODS',
  countOne: '{DATE} · 1 FLOOD',
  watchesHidden: ' · {n} WATCHES HIDDEN',
  watchesHiddenOne: ' · 1 WATCH HIDDEN',
  loading: 'LOADING FLOODS',
  listDown: 'FLOOD LIST UNAVAILABLE',
  listsDown: 'FLOOD LISTS UNAVAILABLE',
} as const

/** The hazard circle's status line (PLAN-5 §5.2, D19): the NWS product, never "ACTIVE", "ENDED", "OVER" or "CLEAR". */
export const CIRCLE_STATUS = {
  emergency: 'FLASH FLOOD · EMERGENCY',
  flashWarning: 'FLASH FLOOD · WARNING',
  warning: 'FLOOD · WARNING',
  advisory: 'FLOOD · ADVISORY',
  watch: 'FLOOD · WATCH',
  gaugeOnly: 'FLOOD · GAUGE IN FLOOD',
  noProductNow: 'FLOOD · NO NWS WARNING NOW',
  past: 'PAST FLOOD · {MON D YYYY}',
  demo: 'SIMULATED FLOOD · DEMO',
} as const

/** The circle's hidden meaning line, one per status (C15). */
export const CIRCLE_MEANING = {
  product: '{Sender} has a {event} in effect for this area until {time}.',
  watch: '{Sender} has a {event} in effect for this area until {time}: flooding is possible. Not an all-clear. Follow local officials.',
  gaugeOnly: 'No NWS flood product names this flood right now; a river gauge here reads at flood stage.',
  noProductNow:
    'No NWS flood product is in effect here right now, and no gauge of this flood has read at flood stage in the last 6 hours. Not an all-clear. Follow local officials.',
  past: "Past flood: NWS's last product for it was sent {date}. Not an all-clear. Follow local officials.",
  demo: 'Simulated data for testing: not a real flood, NWS product or gauge reading.',
} as const

/** The title's date line (never "ENDED"). */
export const DATE_LINE = {
  present: '{MON D YYYY} — PRESENT',
  seenSince: 'SEEN BY FIRE-3D SINCE {MON D YYYY}',
  past: '{MON D YYYY} — LAST NWS PRODUCT {MON D YYYY}',
} as const

/** An NWS product's end time (never "flood ends"). */
export const PRODUCT_END = 'NWS {event} until {time}'

// ------------------------------------------------------------------------------------------------ §5.3 gauges
export const GAUGE_BELOW_STAGE = 'Below flood stage'
export const GAUGE_BELOW_STAGE_SUB = 'NWS category at this gauge: “No Flood”. Not an all-clear: water can rise fast, and streams without a gauge are not measured.'
export const GAUGE_NOT_CURRENT = "This gauge's reading is not current (NWS: “Data Not Current”); last reading {time}."
export const GAUGE_OUT_OF_SERVICE = 'Gauge out of service (NWS); no reading.'
export const GAUGE_NOT_DEFINED = 'NWS has not set flood stages for this gauge, so its reading cannot be compared with flood levels.'
export const GAUGE_OTHER_STREAM = 'Nearest gauge on the {river}; another stream may be closer.'
/** (B) */
export const GAUGE_NOT_ALL_CLEAR = 'A gauge below flood stage is not an all-clear.'
/** (B) */
export const GAUGES_UNAVAILABLE = 'River gauge readings could not be loaded right now. That is not an all-clear.'
export const NO_GAUGE_NEAR = 'No gauge reads at action stage or above within 25 km; streams without a gauge are not measured. Not an all-clear.'
export const NO_MEMBER_GAUGE = 'No river gauge in this flood'
export const NO_MEMBER_GAUGE_SUB = 'Small streams and streets are not measured. Not an all-clear.'
/** Every GaugeCategory value's display (C15): never a raw value on screen. `sentence` null = GAUGE_BELOW_STAGE_SUB; GAUGE_NOT_CURRENT has a {time} slot. */
export const GAUGE_CATEGORY_DISPLAY = {
  no_flooding: { short: 'Below flood stage', sentence: null },
  action: { short: 'Action stage (NWS)', sentence: 'Action stage (NWS): near flood stage.' },
  minor: { short: 'Minor flooding (NWS)', sentence: 'NWS category at this gauge: minor flooding.' },
  moderate: { short: 'Moderate flooding (NWS)', sentence: 'NWS category at this gauge: moderate flooding.' },
  major: { short: 'Major flooding (NWS)', sentence: 'NWS category at this gauge: major flooding.' },
  not_defined: { short: 'Flood stages not set (NWS)', sentence: GAUGE_NOT_DEFINED },
  low_threshold: { short: 'Low-water threshold (NWS)', sentence: 'Low-water threshold (NWS); not a flood measure.' },
  obs_not_current: { short: 'Reading not current (NWS)', sentence: GAUGE_NOT_CURRENT },
  out_of_service: { short: 'Out of service (NWS)', sentence: GAUGE_OUT_OF_SERVICE },
  fcst_not_current: { short: 'Forecast not current (NWS)', sentence: "This gauge's NWS forecast is not current." },
  unknown: { short: 'Category unknown (NWS)', sentence: 'Category unknown (NWS).' },
} as const

export type GaugeCategoryKey = keyof typeof GAUGE_CATEGORY_DISPLAY

export const NOT_STATED_NWS = 'Not stated by NWS'
export const GAUGE_PROVISIONAL = 'Measured by USGS (provisional data, subject to revision).'
/** (B) */
export const USGS_429 = 'USGS data could not be reached right now (too many requests); try later.'
/** (B) */
export const THRESHOLDS_TODAY = "Flood stages shown are NWS's current values; they may have differed then."
export const CREST_LINE = 'Forecast crest {value} {unit}, {day time zone} (NWS {RFC name}, issued {time}). Forecasts change; check NWS for the newest.'
export const FORECAST_HIGH_LABEL = 'FORECAST HIGH (NWS)'
export const FORECAST_HIGH_LINE =
  'Highest NWS forecast value {value} {unit} at the end of the forecast ({day time zone}); the river is still forecast to rise (NWS {RFC name}, issued {time}). Check NWS for the newest.'
export const NO_RFC_FORECAST = 'No NWS river forecast for this gauge'
/** (B) */
export const PAST_NO_FORECAST = 'River forecasts are not kept for past dates.'
export const RFC_FIM_LABEL = 'NWS forecast flooded area (next 5 days)'
export const RFC_FIM_MAPPED = 'Mapped'
export const RFC_FIM_MAPPED_SUB = "NWS's experimental 5-day forecast map · issued {time} · see the map"
export const RFC_FIM_AREA_COMMAND =
  "Forecast flooded area (next 5 days): {area}, measured by Fire-3d from NWS's experimental map of this flood's forecast reaches. It includes the river channel."
/** (B) */
export const RFC_FIM_NOTE =
  'Where NWS river forecasts say water could reach in the next 5 days (the most at any time). A forecast, not today\'s water. NWS calls this map experimental.'
/** (B) */
export const RFC_FIM_OUTSIDE = "Outside NWS's mapped area, flooding is unknown, not absent."
/** Only when the map answer is `available` (D24). */
export const RFC_FIM_NONE = 'Not mapped here'
/** (B) */
export const RFC_FIM_UNAVAILABLE = 'The NWS forecast flooded-area map could not be loaded right now. That is not an all-clear.'
export const CATFIM_LABEL = 'NWS category flood maps (experimental)'
/** (B) */
export const CATFIM_NOTE = 'What NWS maps for {category} flooding at this gauge (experimental map library). Not a forecast.'
/** (B) */
export const CATFIM_UNAVAILABLE = 'NWS category flood maps could not be loaded right now.'

// ------------------------------------------------------------------------------------------------ §5.4 satellite, FEMA, model
/** `{age}` is computed at render time from acquired_ms (C16). */
export const SAT_LABEL = 'Water seen by satellite · {date, time} ({age})'
/** (B) the backend fills only the absolute date and time. */
export const SAT_CAVEAT =
  "Water seen by satellite (NASA OPERA), {date, time}. It includes the river's normal water. Clouds ({n}% of this area), trees, buildings and the days between passes hide water: dry pixels do not mean no flooding."
export const SAT_NO_VIEW_KEY = 'No satellite view (clouds or no data)'
export const SAT_NODATA = 'No satellite view (no data)'
export const SAT_NODATA_POINT = 'No satellite view of this spot on the {date} pass.'
export const SAT_EDGE = 'Edge of the satellite image'
export const SAT_OUTSIDE_POINT = 'This spot is outside the {date} satellite image: no satellite view of it.'
/** (B) */
export const SAT_NOT_SET_UP =
  "NASA Earthdata login is not set up on this server. Fire-3d shows NASA's public optical images (Landsat and Sentinel-2), which cannot see through clouds and arrive about a day later. Radar images that see through clouds need the login."
export const SAT_NOT_SET_UP_SHORT = 'No radar images: NASA login not set up'
/** (B) */
export const SAT_LOGIN_REFUSED = "The NASA Earthdata login on this server was refused (it may have expired). Fire-3d shows NASA's public optical images only until it is renewed."
export const SAT_PICTURE_ONLY = 'Satellite water: NASA picture, {date} (not measured here)'
/** (B) */
export const SAT_UNAVAILABLE = 'Satellite water could not be loaded right now. That is not an all-clear.'
export const SAT_CLOUD = 'No view (clouds)'
export const SAT_CLOUD_POINT = 'Clouds hid this spot on the {date} pass.'
export const SAT_AREA_COMMAND = 'Water seen by satellite in this area: {area} (includes normal river and lake water)'
/** `{date}`, or `{date}–{date}` when FEMA's panels differ (C19). */
export const NFHL_LABEL = 'FEMA 1% annual-chance floodplain (“100-year floodplain”), background · effective {date}'
/** (B) */
export const NFHL_NOTE = "FEMA's 1%-annual-chance (100-year) floodplain, used for flood insurance. It is not a map of current flooding, and places outside it can flood. Provided as is by FEMA."
/** Only where FEMA's availability is `mapped` (C19). */
export const NFHL_OUTSIDE = "Not in FEMA's mapped 1% floodplain. Floods can reach beyond it; not an all-clear."
/** (B) */
export const NFHL_NO_MAP = 'FEMA has no digital flood map here.'
/** (B) */
export const NFHL_DOWN = 'FEMA flood zones could not be loaded right now.'
/** (B) */
export const MODEL_LABEL = 'Model output (NOAA National Water Model) · experimental'
/** (B) */
export const MODEL_CAVEAT = 'Experimental model output (NOAA National Water Model). It is not an NWS forecast and not advice on when to evacuate. Follow local officials.'
export const MODEL_SEPARATE = "Fire-3d shows NOAA's National Water Model separately, as experimental model output. Not an all-clear. Follow local officials."
export const MODEL_UNAVAILABLE = 'Model series unavailable right now'
/** From recur_cat {p} % (n = 100 / p); ">50" → MODEL_AEP_HIGH. */
export const MODEL_AEP = 'Model flow about a 1 in {n} chance in any year (NWM)'
export const MODEL_AEP_HIGH = 'Model flow above its high-water level (NWM)'

// ------------------------------------------------------------------------------------------------ §5.5 points, products
/** (B) only when the alerts answer is `available` (D24). */
export const NO_PRODUCT = 'No NWS flood product here right now. That is not an all-clear: follow local officials.'
/** (B) */
export const ALERTS_UNAVAILABLE = 'NWS flood products could not be reached right now. That is not an all-clear: follow local officials.'
/** (B) */
export const ZONES_AS_COUNTIES = "Drawn as whole counties; NWS's own zones may be smaller."
export const NOTHING_COVERS = 'No mapped flood layer covers this spot. Unknown, not dry. Follow local officials.'
export const INSIDE_WARNING = 'Inside the NWS {event} area (until {time}).'
export const CURSOR_FUTURE_PRODUCTS = 'NWS products in effect now; NWS has issued none for this future time. An NWS end time is not a forecast of when flooding stops.'
export const EVAC_NONE_LISTED = 'None listed'
export const EVAC_NONE_LISTED_SUB = 'None listed in {source} for this area · checked {time} · not an all-clear: follow local officials.'
/** The flood's evacuation answer could not be loaded (the request failed with no answer; review WFP-R5): flood wording,
 *  never an all-clear. */
export const EVAC_UNAVAILABLE = 'Official evacuation zones could not be loaded right now. That is not an all-clear: follow local officials.'
/** (B) */
export const OR_EVAC_FIRE_ONLY = "Oregon's evacuation feed covers wildfires only; flood evacuations are not shown here. Not an all-clear: follow local officials."
export const INSIDE_FIM = 'Inside the NWS forecast flooded area (5-day maximum).'
export const NEAR_FIM = '{distance} from the NWS forecast flooded area.'
export const NEAR_SAT = '{distance} from water seen by satellite ({date, time}; clouds over {n}% of the area).'
export const IN_FLOODPLAIN = "In FEMA's 1% annual-chance floodplain, Zone {zone} (background)."
export const MODEL_AT_POINT = 'National Water Model (NOAA, experimental): flooded at the {time} analysis.'
export const DISTANCE_CHIP_LINES = {
  warning: 'to the edge of the NWS warning area',
  forecast: 'to the NWS forecast flooded area (5 days)',
  gauge: "to the river gauge, not the water's edge",
  inside: 'Inside the NWS warning area',
} as const
/** The sub-line then starts "as of {date}" (brief-4 rule). */
export const WAS_IN_EFFECT = 'Was in effect'
export const AS_OF = 'as of {date}'
export const ARCHIVED_COPY = 'Archived copy (Iowa Environmental Mesonet)'
export const HYDROGRAPH_EMPTY = {
  noReadings: 'No readings from this gauge in the last 72 h (NWS: Data Not Current)',
  noStages: 'NWS has not set flood stages for this gauge',
  noForecast: 'No NWS river forecast for this gauge',
  noModel: 'Model series unavailable right now',
} as const
export const HYDROGRAPH_MARKS = {
  crest: 'CREST {value} {UNIT} {DAY HH:MM}',
  highAtEnd: 'HIGH {value} {UNIT} AT END · STILL RISING',
  model: 'MODEL · NWM · EXPERIMENTAL · {flow} FT³/S ({run time})',
} as const
/** Forensic's strings (also in ui/forensic-flood/floodForensicCopy.ts, owned by web-flood-forensic). */
export const FORENSIC_FLOOD = {
  notPrepared: "Fire-3d has not prepared this flood's 3D terrain yet.",
  prepare: 'Prepare 3D data (about 1 min)',
  barHeight: 'Bar height: river stage at the gauge (scaled), not water depth',
  demo: 'Demo · simulated data: terrain, water layers and gauges are synthetic',
} as const

// ------------------------------------------------------------------------------------------------ overview words
/** The national overview in Floods (PLAN-5 §4.3): list title, official block, tabs, switch. */
export const FLOOD_OVERVIEW = {
  listTitle: 'Floods in the lower 48',
  officialTitle: 'Flood products (NWS)',
  officialCount: '{n} in effect in the lower 48 · checked {age}',
  officialCountOne: '1 in effect in the lower 48 · checked {age}',
  officialUnknown: 'Could not be read right now · not an all-clear',
  tabActive: 'Active',
  showWatches: 'Show watches',
  inView: '{n} floods in this view · Show all {total}',
  inViewOne: '1 flood in this view · Show all {total}',
  showingAll: 'Showing all {total} listed floods · Only in this view',
  backToAll: 'Back to all floods',
  switchName: 'Show: fires or floods',
  fires: 'Fires',
  floods: 'Floods',
  titleNoEvent: 'Fire-3d · Wildfires and floods',
  skipToList: 'Skip to the flood list',
  mapLabel: 'Flood map',
  reload: 'Reload the flood lists (NWS and river gauges)',
  // the list's sources and states (review WFO-R3)
  sourceLive: 'NWS flood products · NOAA river gauges',
  sourcePast: 'Archived NWS products (Iowa Environmental Mesonet)',
  sourceUnreadable: 'could not be read right now',
  pastListUnavailable: 'Past floods could not be read right now. That is not an all-clear.',
  loadingLists: 'Loading the flood lists…',
  checkingProducts: 'Checking NWS flood products…',
  // the point card (review WFO-R6, WFO-R7, WFO-R13)
  pointProductsTitle: 'NWS flood products here',
  pointGaugeTitle: 'River gauge (NWS)',
  checkingGauges: 'Checking river gauges…',
  pastAlerts: 'NWS flood products at this spot are not available for this past date.',
  gaugeReading: 'reading {time} ({age})',
  gaugeNoReadingTime: 'reading time not given',
  gaugePage: 'NWS gauge page',
  nearestTitle: 'Nearest listed floods',
  nearestDistanceNote:
    "Distance from here to each flood's marker (its river gauge or a point of its NWS warning area), not to the water's edge. Distance alone does not tell you the risk; not an all-clear.",
  // the map's hover texts (review WFO-R13)
  hoverOpen: 'Click to open this flood',
  hoverGroup: 'Group of {n} listed floods',
  hoverZoom: 'Click to zoom in',
  hoverCheckSpot: 'Click to check this spot',
  hoverGaugeSource: '{category} · NOAA National Water Prediction Service (NWS)',
  // national river gauges (review WFO-R8): the map falls back to the listed floods' own gauges
  nationalGaugesDown: 'River gauges outside the listed floods could not be loaded right now. That is not an all-clear.',
  // the Layers panel in Floods (review WFO-R13)
  layersGauges: 'River gauges (NWS)',
  layersGaugesDesc: 'Gauges at action stage or above, by NWS flood category',
  layersNote: 'Open a flood for its NWS products, gauges and water layers. Model output is shown only in Command, as experimental.',
  // the list's tabs and the phone peek bar (review WFO-R13)
  tabActiveTip: 'Floods with an NWS flood product in effect or a river gauge at flood stage now',
  tabYearTip: 'Past floods of {year} (archived NWS products)',
  peekLoading: 'Loading the floods…',
  peekFailed: 'Could not load the flood list · open to retry',
  peekCount: '{n} listed floods',
  peekCountOne: '1 listed flood',
  // the flood legend's rows and details (review WFO-R13)
  legendLarge: 'Flood: moderate or major, or flash flood warning',
  legendActive: 'Flood warning',
  legendSmall: 'Advisory or gauge in flood',
  legendPast: 'Past flood',
  legendWatch: 'Flood watch',
  legendGroupTip: 'Group of floods (N = how many)',
  legendWarningArea: 'NWS warning area',
  legendFloodsTitle: 'Floods (National Weather Service products and NOAA river gauges)',
  legendFloodsBody:
    "One marker per flood: NWS flood products in effect and river gauges at flood stage, grouped per river or area. Its size says the official level, not the size of the flooding: the largest for moderate or major flooding at a gauge or a Flash Flood Warning; then a Flood Warning; the smallest for an advisory or a gauge in flood without an NWS product; a hollow ring for a watch or a past flood. The centre dot takes the highest gauge category's colour. Close floods are grouped.",
  legendGaugesTitle: 'River gauges (NOAA National Water Prediction Service)',
  legendGaugesBody:
    "Gauges at action stage or above, from state level zoom: a diamond in NWS's category colour, larger for higher categories (action, minor, moderate, major). A grey diamond with “?”: NWS has not set flood stages there. Streams without a gauge are not measured.",
  legendWarningBody: 'The area of an NWS flood product, as NWS drew it (pink outline).',
  // the overview title for screen readers (review WFO-R11): "United States, floods"
  titleFires: 'all fires',
  titleFloods: 'floods',
} as const

// ------------------------------------------------------------------------------------------------ Public flood view
/** The circle's meaning line while the highest product is still to start (its onset after now). */
export const CIRCLE_MEANING_UPCOMING = '{Sender} has issued a {event} for this area, starting {time}.'
/** A watch's meaning ends with this when it is still to start. */
export const CIRCLE_MEANING_WATCH_TAIL = 'Flooding is possible. Not an all-clear. Follow local officials.'

/** The Public flood view (PLAN-5 §4.4): fact labels (upper-cased by the row's style), quiet values, the facts' foot,
 *  the key, the title, the circle's tooltip and the preparation of a flood's map data (web-flood-public). */
export const FLOOD_PUBLIC = {
  // fact labels (rows 1-3 per kind, then started, the highest product, evacuations, last update; C4)
  labelFim: 'Forecast flooded area (NWS, 5 days)',
  labelStage: 'River stage (USGS)',
  labelCrest: 'Forecast crest (NWS)',
  labelDetection: 'Flash flood detection (NWS)',
  labelDamage: 'Damage threat (NWS)',
  labelGauges: 'River gauges',
  labelWatchArea: 'Watch area (NWS)',
  labelRiverForecast: 'River forecast (NWS)',
  labelStarted: 'Started',
  labelSeenSince: 'Seen by Fire-3d since',
  labelProduct: '{event} (NWS)',
  labelNoProduct: 'NWS flood product',
  labelEvacuations: 'Evacuations',
  labelLocal: "Local officials' alert",
  labelUpdated: 'Last official update',
  // quiet values (never "N/A", never an all-clear)
  checking: 'Checking…',
  unavailable: 'Unavailable right now',
  pastDates: 'Not available for past dates',
  inEffect: 'In effect',
  startingSoon: 'Starting soon',
  noneInEffect: 'None in effect',
  noReading: 'No reading',
  notGiven: 'Not given',
  noUpdateTime: 'No update time given',
  flashEmergency: 'Flash Flood Emergency',
  andMore: '{areas} and {n} more',
  andMoreOne: '{areas} and 1 more',
  // the sub-lines' parts
  until: 'until {time}',
  sent: 'sent {time}',
  reading: 'reading {time} ({age})',
  readingShort: '{time} ({age})',
  issued: 'issued {time}',
  startedNws: 'first NWS product of this flood',
  startedGauge: 'first reading at flood stage at a member gauge',
  startedFirstSeen: 'first listed by NWS products or gauges Fire-3d reads',
  updatedWhat: 'newest NWS product or member gauge reading',
  nwsAlertLink: 'NWS product',
  gaugePageLink: 'NWS gauge page',
  forecastLink: 'NWS forecast',
  // the facts' foot
  sourcesLine: 'NWS · USGS · checked {age}',
  sourcesLineNoCheck: 'NWS · USGS',
  demoLine: 'Simulated data for testing, not from NWS or USGS',
  waterLink: 'NWS water',
  waterUrl: 'https://water.noaa.gov',
  // the circle
  circleTip: 'Open this flood in the Command view: the river-level chart, every NWS product, the gauges and the experimental model',
  circleLabel: '{name}: {status}. More in Command view',
  thisFlood: 'This flood',
  // the title
  loadingFlood: 'Loading the flood…',
  floodFallback: 'Flood',
  // the key (each layer with its own source and time; C16 ages at render)
  keyForecast: 'NWS forecast flooded area · issued {time}',
  keyForecastNoTime: 'NWS forecast flooded area',
  keyChannel: 'Main channel',
  channelBody: "The river's usual channel and other mapped water, from OpenStreetMap (OpenFreeMap). It is not a flood layer: water outside it is drawn only by the layers above.",
  keyWarning: 'NWS warning area',
  keyNoLayer: 'No flood layer mapped here yet · see the facts',
  keyLoading: 'Loading the flood layers…',
  keyHiddenInLayers: ' (hidden in Layers)',
  keyStaleTip: 'This satellite image is more than 3 days old: the water may have changed since',
  keyStale: 'Old',
  keyPicture: 'Satellite water: NASA picture, {date} (not measured here)',
  keySatNone: 'Water seen by satellite: no usable image',
  // an answer still loading (review WFP-R1; a failed one shows SAT_UNAVAILABLE / RFC_FIM_UNAVAILABLE)
  keySatChecking: 'Water seen by satellite · checking…',
  keyForecastChecking: 'NWS forecast flooded area · checking…',
  satStatusUnavailable: 'SATELLITE WATER · UNAVAILABLE',
  // map data (bundle) preparation (C10)
  notPrepared: "Fire-3d has not prepared this flood's map data yet (terrain and frozen copies of the water layers).",
  prepare: 'Prepare map data (about 1 min)',
  prepareFailed: "Fire-3d's last preparation of this flood's map data failed.",
  prepareAgain: 'Prepare again (about 1 min)',
  preparing: "Preparing this flood's map data (about 1 min)",
  prepareNotListed: 'Only listed floods can be prepared.',
  // the job could not be read for a while (review WFP-R9): it may still be running on the server
  prepareLost: 'Fire-3d lost contact with the preparation ({error}); it may still be running.',
  // a flood without a member gauge has no NWS river forecast point (review WFP-R12)
  noForecastNoGauge: 'This flood has no river gauge; NWS river forecasts are made at gauges.',
  // phones
  sheetMore: 'Show all official facts and the map key',
  sheetLess: 'Show less',
  // the Layers drawer of a flood view (FloodLayersPanel; D12, D21, D22)
  layersTitle: 'Layers & settings',
  layersWater: 'Water layers',
  layersBackground: 'Background',
  layersModel: 'Model output (experimental)',
  layersEvac: 'Official evacuation zones',
  layerSatellite: 'Water seen by satellite (NASA OPERA)',
  layerSatelliteDesc: 'Measured water and partial water from the newest clear image; clouds and no data drawn grey. Days old, never "now".',
  layerForecast: 'NWS forecast flooded area (next 5 days)',
  layerForecastDesc: "NWS's experimental map of where river forecasts say water could reach; a forecast, not today's water",
  layerWarnings: 'NWS warning areas',
  layerWarningsDesc: 'The areas of the NWS flood products in effect, as NWS drew them',
  layerGauges: 'River gauges (NWS)',
  layerGaugesDesc: "This flood's gauges by NWS category, and gauges at action stage or above nearby",
  layerChannel: 'Main channel',
  layerChannelDesc: "The river's usual channel and other mapped water (OpenStreetMap)",
  layerFloodplain: 'FEMA 1% annual-chance floodplain',
  layerFloodplainDesc: 'Background for flood insurance, not current flooding · effective {date}',
  layerFloodplainDescNoDate: 'Background for flood insurance, not current flooding',
  layerCatfim: 'NWS category flood maps (experimental)',
  layerCatfimDesc: "What NWS maps for the primary gauge's forecast category; not a forecast",
  layerModel: 'National Water Model flooded area (experimental)',
  layerModelDesc: 'Model output (NOAA National Water Model), never an NWS forecast',
  layerEvac: 'Evacuation zones (official)',
  layerEvacDesc: 'Current orders and warnings from local officials, where a state publishes them, with the issuing authority and update time',
  layersPublicNote: 'The experimental model (NOAA National Water Model) and NWS category flood maps are in Command.',
  layersCommandNote: 'Model output is experimental and is never an NWS forecast or advice on when to evacuate. Follow local officials.',
  openCommand: 'Open Command ›',
  forensicButton: 'Open Forensic workspace',
  forensicNote: "The flood's layers draped on 3D terrain, its river gauges as bars and every NWS product version are in the Forensic workspace.",
  units: 'Units',
  basemap: 'Basemap',
  legend: 'Legend',
  // the point card's flood-view block
  pointLayersTitle: 'Flood layers at this spot',
  nearWarning: '{distance} from the NWS {event} area.',
  satWaterPoint: "Water seen by satellite at this spot on the {date} pass (it includes the river's normal water).",
  satNotWaterPoint: 'The {date} satellite pass saw no water at this spot; dry pixels do not mean no flooding.',
  satNoViewPoint: 'No satellite view of this spot on the {date} pass (clouds or no data).',
  satCheckingPoint: 'Water seen by satellite: image of {date} (checking this spot…)',
  // snow or ice hides water as clouds do; NASA masks the ocean; a clear pixel of the picture is "not water" or "not
  // checked" (review WFP-R8)
  satSnowPoint: 'Snow or ice covered this spot on the {date} pass: no satellite view of water here.',
  satOceanPoint: "NASA's {date} pass masks this spot as ocean; its water is not checked here.",
  satClearPoint: 'The {date} satellite pass shows no water at this spot (or did not check it there); dry pixels do not mean no flooding.',
  satLoadingPoint: 'Water seen by satellite: checking…',
  fimCheckingPoint: 'NWS forecast flooded area: checking…',
  fimNotMappedPoint: 'NWS forecast flooded area: not mapped here. Outside NWS\'s mapped area, flooding is unknown, not absent.',
  modelInCommand: 'The experimental model for this spot is in Command',
} as const

// ------------------------------------------------------------------------------------------------ the guard
/** PLAN-5 §5.1: words Fire-3d never says in its own voice (case-insensitive, word-bounded: "extended" and
 *  "recommended" never match). RegExps, so the string scan below does not read them as copy. */
export const BANNED_PATTERNS: readonly RegExp[] = [
  /\bsafe(ly|ty)?\b/i,
  /\blow[- ]risk\b/i,
  /\ball[- ]clear\b/i,
  /\bno flooding\b/i,
  /\bdry\b/i,
  /\breceded\b/i,
  /\bthe flood is over\b/i,
  /\bended\b/i,
  /\bnormal level\b/i,
  /\bno danger\b/i,
  /\byou are outside the flood\b/i,
  /\bminimal flood hazard\b/i,
  /\bfire\s*trace\b/i,
]

/** The phrases inside which a banned word is allowed (removed first, longest first, case-insensitive). */
export const ALLOWED_PHRASES: readonly string[] = [
  'does not establish the safety of a route or an area',
  'dry pixels do not mean no flooding',
  'do not mean no flooding',
  'unknown, not dry',
  'not an all-clear',
  'never an all-clear',
]

/** The banned words found in `text` after removing the allowed phrases ([] = clean). */
export function floodWordingProblems(text: string): string[] {
  let t = text
  for (const phrase of [...ALLOWED_PHRASES].sort((a, b) => b.length - a.length)) {
    const re = new RegExp(phrase.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi')
    t = t.replace(re, ' ')
  }
  const out: string[] = []
  for (const re of BANNED_PATTERNS) {
    const m = re.exec(t)
    if (m) out.push(m[0])
  }
  return out
}

/** Every string inside a value (objects and arrays walked; functions and RegExps skipped). */
export function collectStrings(v: unknown, out: string[] = []): string[] {
  if (typeof v === 'string') out.push(v)
  else if (Array.isArray(v)) for (const x of v) collectStrings(x, out)
  else if (v && typeof v === 'object' && !(v instanceof RegExp)) for (const x of Object.values(v)) collectStrings(x, out)
  return out
}

/** Static markup without the elements that carry `data-verbatim` (an issuer's own words) and without tags. Works on
 *  well-formed markup (renderToStaticMarkup's output). */
export function stripVerbatim(html: string): string {
  const voids = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'source', 'track', 'wbr'])
  const tag = /<(\/?)([a-zA-Z][\w:-]*)([^>]*?)(\/?)>/g
  let out = ''
  let depth = 0
  let last = 0
  let m: RegExpExecArray | null
  while ((m = tag.exec(html))) {
    if (depth === 0) out += html.slice(last, m.index) + ' '
    last = tag.lastIndex
    const [, close, name, attrs, selfClose] = m
    const isVoid = selfClose === '/' || voids.has(name.toLowerCase())
    if (close) {
      if (depth > 0) depth--
    } else if (depth > 0) {
      if (!isVoid) depth++
    } else if (/\sdata-verbatim(\s|=|$)/.test(attrs) && !isVoid) depth = 1
  }
  if (depth === 0) out += html.slice(last)
  return out
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#x27;|&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/\s+/g, ' ')
    .trim()
}

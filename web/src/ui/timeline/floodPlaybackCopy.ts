// The words of the flood time steps (brief 6, web-flood-playback; BRIEF-6 decision 2; PLAN-5 §5 safety wording): the
// Play and step controls on the river-level chart (Command's slim chart, Forensic's dock), the label of the step at the
// handle, and the notes for the days between two satellite passes. Every exported string is checked by the flood
// wording guard (ui/shell/floodCopy.test.ts reads every `*[Ff]lood*[Cc]opy*.ts`). `{x}` are slots (fillCopy).
//   - A satellite image shows the water on its own date only: nothing is drawn or interpolated between two passes, and
//     the gap is said ("No satellite image between Oct 29 and Nov 3").
//   - An NWS product's end, cancellation or a gap in the images is never an all-clear.
//   - NWS's event names ({event}) are NWS's own words: the views render them inside `data-verbatim`.

export const PLAYBACK = {
  /** The controls' group (screen readers). */
  groupName: 'Flood time steps',
  play: 'Play the time steps',
  pause: 'Pause the time steps',
  prev: 'Previous time step',
  next: 'Next time step',
  playTip: 'Play: the satellite passes and NWS product changes, one step at a time, to the latest step (Space)',
  /** prefers-reduced-motion: Play never runs on its own; each press shows the next step. */
  playReducedTip: 'Reduced motion is on: each press of Play shows the next step (Space)',
  pauseTip: 'Pause (Space)',
  prevTip: 'Previous step: the satellite pass or NWS product change before the handle (comma key)',
  nextTip: 'Next step: the satellite pass or NWS product change after the handle (full stop key)',
  /** Screen readers: what the keys do (the chart's help text). */
  keysHelp: 'Space plays or pauses the time steps; the comma and full stop keys step back and forward.',

  // ---------------------------------------------------------------------------------------------- the step's label
  /** "Satellite pass Oct 29, 12:04 EDT · 7 days before now" (the image's own time, in the flood's zone). */
  pass: 'Satellite pass {time} · {ago}',
  /** A past flood: no age against its reference time. */
  passPast: 'Satellite pass {time}',
  /** A pass partly hidden: its share without a view. */
  passHidden: 'no view of {pct}% of the area (clouds or no data)',
  agoMinutes: '{n} min before now',
  agoHour: '1 hour before now',
  agoHours: '{n} hours before now',
  agoDay: '1 day before now',
  agoDays: '{n} days before now',
  /** NWS product changes (each in the product's own zone). */
  issued: 'NWS {event} issued {time}',
  updated: 'NWS {event} updated {time}: new area',
  cancelled: 'NWS cancelled the {event} {time} · not an all-clear',
  upgraded: 'NWS upgraded the {event} {time}',
  until: 'End time of the NWS {event}: {time} · not an all-clear',
  moreOne: '(+1 more NWS change by {time})',
  moreMany: '(+{n} more NWS changes by {time})',

  // ---------------------------------------------------------------------------------------------- between passes
  /** The satellite layer between two passes: the latest image at or before the handle, with its own date (a neutral
   *  word: the same note sits under the 2D map and the 3D scene; review WFP-R9). */
  mapImage: 'Shown: satellite image of {time} ({age} before the handle)',
  /** Phones (review WFP-R5): the image's date kept visible on its own line. */
  mapImageShort: 'Image shown: {date} ({age} before)',
  gapBeforeShort: 'No satellite image before {to}',
  gapNoneShort: 'No usable satellite image',
  gapBetween: 'No satellite image between {from} and {to}',
  gapAfter: 'No satellite image after {from} yet',
  gapBefore: 'No satellite image before {to}',
  gapNone: 'No usable satellite image in this flood’s window',
  noViewOne: '1 pass in between saw no view (clouds or no data)',
  noViewMany: '{n} passes in between saw no view (clouds or no data)',
  unread: 'some passes are still being read',
  /** A pass whose image the map cannot draw (the route sent none). */
  noImage: 'This pass has no image to draw on the map.',
  /** The satellite layer's note when the handle is before the first usable pass (the map draws no image). */
  noImageAtHandle: 'No satellite image at or before this time: the water then is not seen. That is not an all-clear.',

  // ---------------------------------------------------------------------------------------------- "now" layers at a past step
  /** Layers that are products of now stay drawn at a past step: said with their own time (review WFP-R6). */
  nowLayers: 'As of now, not this time: {layers}',
  nowLayersShort: 'Now: {layers}',
  nowForecast: 'NWS forecast area',
  nowFloodplain: 'FEMA floodplain',
  nowCatfim: 'NWS category map',
  nowModel: 'model',
  /** The legend chip of such a layer at a past step. */
  chipNow: 'now',
  chipNowIssued: 'now, issued {time}',

  // ---------------------------------------------------------------------------------------------- NWS products at the handle
  /** The row's button listing the NWS versions drawn at a past step (review WFP-R3): each with its issuer, its own
   *  times, its verbatim words and a link; IEM archive copies tagged and credited. */
  nwsButton: 'NWS · {n}',
  nwsButtonLabel: 'NWS products on the map at this time: {n}. Each with its issuer, its own times and a link',
  nwsButtonTip: 'The NWS products the map draws at this time: issuer, own times, words and link',
  nwsTitle: 'NWS products on the map at this time',
  nwsIssued: 'issued {time}',
  nwsUntil: 'until {time}',
  nwsLink: 'NWS product',
  nwsLinkArchived: 'Archived copy of the NWS product',
  nwsNote: 'Each NWS product is shown from the time NWS issued it until its own end time or NWS’s next version of it. Its end is not an all-clear. Follow local officials.',

  // ---------------------------------------------------------------------------------------------- at now
  /** The row at now: what Play steps through. */
  summary: '{passes} and {changes} from {from} · Play steps through them',
  passesOne: '1 satellite pass',
  passesMany: '{n} satellite passes',
  changesOne: '1 NWS product change',
  changesMany: '{n} NWS product changes',
  /** At now the map shows the satellite layer's own image (its date in the legend). */
  nowLabel: 'Now',
  loading: 'Loading the flood’s time steps…',
  unavailable: 'The flood’s time steps could not be loaded right now. That is not an all-clear.',
  none: 'No satellite pass or NWS product change to step through yet. That is not an all-clear.',
} as const

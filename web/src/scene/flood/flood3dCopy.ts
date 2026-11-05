// Words of the brief-6 3D flood view (web-forensic-flood-3d): the height boost, the estimated water depth surface,
// the height-above-the-river (low ground) layer, the river view and the depth surface of a playback pass. Checked by
// the flood wording guard (ui/shell/floodCopy.test.ts scans every *[Ff]lood*[Cc]opy*.ts file): never an all-clear,
// never "safe", never a word that calls a place free of water. The backend's own sentences (DEPTH_LABEL, DEPTH_CAVEAT,
// HAND_LABEL, HAND_CAVEAT, RELIEF_RULE, …; backend/fire3d/floods/copy_time.py) come with the bundle's
// manifest.terrain3d and are shown as sent; the *_FALLBACK copies below are the same texts, used only when an older
// bundle has no terrain3d. Slots `{x}` are filled with floodCopy.fillCopy.

/** HAND_LABEL (backend copy_time.py), for bundles without terrain3d. */
export const HAND_LABEL_FALLBACK = 'Height above the river (from terrain). Not a flood map'
/** DEPTH_LABEL (backend copy_time.py), for bundles without terrain3d. */
export const DEPTH_LABEL_FALLBACK = "Estimated depth (from the terrain at the water's edge), experimental"

export const FLOOD_3D = {
  // height boost (the view dock's select and the scene key)
  height: 'Height ×{n}',
  heightAuto: 'Height ×{n} · auto',
  heightTip: 'Height boost: heights are drawn {n} times taller so low ground shows in flat places. Distances are true.',
  heightSelect: 'Height boost',
  keyHeight: 'Height ×{n}: heights drawn {n} times taller, distances true',
  keyHeightAuto: 'Automatic for this area: the ground near the water spans {range} m (middle 90%) across {width} km.',
  keyHeightAutoGrid: 'Automatic for this area: its ground spans {range} m (middle 90%) across {width} km.',
  keyHeightUser: 'Your choice. The automatic height here is ×{n}.',
  keyHeightFlat: 'Still flat at ×{n}: raise it, or use River view.',
  keyMoreHeight: 'Height boost',
  heightRuleGrid:
    "This flood's 3D data was prepared before the relief measure: the automatic height is taken from the heights of the whole 3D area, with the same rule.",
  // estimated water depth (FwDET)
  layerDepth: 'Water depth (estimated)',
  layerDepthTip: "Estimated from the terrain at the water's edge (FwDET), inside the mapped water only. Experimental: errors of a metre or more are common",
  depthFrom: 'Depth of',
  depthOfSatellite: 'Of the satellite water seen {date}',
  depthOfForecast: 'Of the NWS forecast flooded area issued {date}',
  depthFromSatellite: 'Satellite water',
  depthFromForecast: 'NWS forecast area',
  depthShallow: '0 m',
  depthMid: '1 m',
  depthMid2: '2 m',
  depthDeep: '3 m or more',
  depthNoPass: 'No depth surface for this satellite pass: its depth estimate is not in the 3D data. The water it saw is drawn flat.',
  depthNoView: 'No depth surface for this satellite pass: it had no view of this area (clouds or no data). That is not an all-clear.',
  depthNoImageYet: 'No depth surface: no satellite image at or before this time. That is not an all-clear.',
  depthNotShownSource: 'No depth surface is shown: {reason}',
  depthNoTerrain3d: "This flood's 3D data was prepared before depth estimates were added: prepare it again for a depth surface.",
  keyMoreDepth: 'Estimated depth',
  // height above the river (HAND)
  layerHand: 'Height above the river',
  layerHandTip: 'Height of the ground above the nearest river channel, from the terrain. Not a flood map. Experimental',
  handBand1: '0–1 m',
  handBand2: '1–2 m',
  handBand3: '2–5 m',
  handLegend: 'above the nearest river channel',
  keyMoreHand: 'Height above the river',
  // group of the Layers tab
  groupTerrain3d: 'From the terrain',
  groupTerrain3dTag: 'experimental',
  // river view (entry control, camera)
  riverView: 'River view',
  riverViewShort: 'River',
  riverViewTip: 'A lower, closer look along the main river',
  // hover readout
  probeDepth: 'DEPTH',
  probeDepthAt: "About {m} m deep here (estimated from the terrain at the water's edge; experimental, often off by a metre or more).",
  probeDepthTop: "More than 25 m deep here by the estimate (from the terrain at the water's edge; experimental).",
  probeSatImageOnly: 'The pass of {date} is shown here as its picture only (its cells are not in the 3D data), so this spot is not read here. Not an all-clear.',
  probeHand: 'ABOVE RIVER',
  probeHandAt: 'The ground here is about {m} m above the nearest river channel (from terrain). Not a flood map.',
  probeHandTop: 'The ground here is more than 25 m above the nearest river channel (from terrain). Not a flood map.',
  probeHandFar: 'More than 10 km from a mapped river channel: not measured. Not a flood map.',
} as const

/**
 * The plane — a run's graph on the GPU, and the contract layers build on.
 *
 *   network.ts      the wire, decoded: typed arrays indexed by node / link
 *   channels.ts     Network → buffers (colour, size, links, seed, visibility)
 *   communities.ts  Louvain: groups from the links, as a hierarchy
 *   collapse.ts     the network as groups, opened one level at a time
 *   merge.ts        the resolver's merges, folded into the network
 *   arrange.ts      what organises the plane — groups, time, place
 *   CosmosPlane     the cosmos.gl host: buffers in, camera + events out
 *   PlaneLabels     a layer on `usePlane()` — names over the graph
 *   PlaneMap        a backdrop on `usePlane()` — the map, following the camera
 *   PlaneLink       a layer on `usePlane()` — a line between two nodes
 *   presence.ts     when each node is there — every time, not only its first
 *   deck.ts         the run as a space-time cube: threads, points, change
 *   TimeDeck        a layer on `usePlane()` — time as depth, the present in front
 *   gain.ts         turning types, entities and groups up or down
 *   sets.ts         the reader's own groups, from types, names, nodes, groups,
 *                   places, other sets and the documents' values
 *   anchoring.ts    sets placed on the canvas, gathering what they hold
 *   light.ts        what the reader keeps lit, with its direct links
 *   PlaneAnchors    the anchors, on any surface — plane, map or deck
 *   declutter.ts    names that fit, and what is under the pointer
 */
export * from './network';
export * from './channels';
export { CosmosPlane, usePlane, SPACE_SIZE } from './CosmosPlane';
export type { PlaneView, PlaneHandle, PlaneBuffers, CosmosPlaneProps } from './CosmosPlane';
export { PlaneLabels } from './PlaneLabels';
export * from './communities';
export * from './collapse';
export * from './arrange';
export { PlaneMap } from './PlaneMap';
export * from './merge';
export { PlaneLink, type LinkTone } from './PlaneLink';
export * from './presence';
export * from './deck';
export * from './declutter';
export { TimeDeck, VANISH_REACH, type TimeDeckProps, type DeckApi } from './TimeDeck';
export * from './gain';
export * from './anchoring';
export * from './sets';
export * from './light';
export { PlaneAnchors, type AnchorMark, type Inset, type Surface } from './PlaneAnchors';

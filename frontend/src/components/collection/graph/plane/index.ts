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

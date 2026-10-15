/**
 * The plane — a run's graph on the GPU, and the contract layers build on.
 *
 *   network.ts      the wire, decoded: typed arrays indexed by node / link
 *   channels.ts     Network → buffers (colour, size, links, seed, visibility)
 *   CosmosPlane     the cosmos.gl host: buffers in, camera + events out
 *   PlaneLabels     the first layer on `usePlane()` — names over the graph
 */
export * from './network';
export * from './channels';
export { CosmosPlane, usePlane, SPACE_SIZE } from './CosmosPlane';
export type { PlaneView, PlaneHandle, PlaneBuffers, CosmosPlaneProps } from './CosmosPlane';
export { PlaneLabels } from './PlaneLabels';

// Minimal ambient module declaration for d3-force-3d. The package ships JS
// only; structurally equivalent to d3-force with extra dimensions support
// (forceZ, numDimensions setter on the simulation, z/vz/fz on nodes). We
// type the surface we actually call.
declare module 'd3-force-3d' {
  export function forceSimulation(nodes?: any[]): any;
  export function forceManyBody(): any;
  export function forceLink(links?: any[]): any;
  export function forceCenter(x?: number, y?: number, z?: number): any;
  export function forceCollide(radius?: number | ((node: any) => number)): any;
  export function forceX<T = any>(x?: number | ((d: T) => number)): any;
  export function forceY<T = any>(y?: number | ((d: T) => number)): any;
  export function forceZ<T = any>(z?: number | ((d: T) => number)): any;
  export function forceRadial(radius?: number | ((d: any) => number), x?: number, y?: number, z?: number): any;
}

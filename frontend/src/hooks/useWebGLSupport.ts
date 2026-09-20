import * as React from "react";

/**
 * useWebGLSupport — whether this browser can actually give us a 3D context.
 *
 * `three` does not ask before it tries. `new THREE.WebGLRenderer()` calls
 * `canvas.getContext('webgl2')`, and when that returns null — a container with
 * no GPU, a VM with software rendering disabled, a device that has blacklisted
 * the driver, a browser that has exhausted its context limit — it logs
 * "Error creating WebGL context" and throws. In dev that surfaces as an error
 * overlay over the whole app, for what is really just a capability the machine
 * does not have.
 *
 * So we ask first, once, and let the caller offer 2D instead. The probe creates
 * a throwaway canvas and releases the context immediately: browsers cap the
 * number of live WebGL contexts (often around 16), and leaking probes is itself
 * a way to cause the failure being tested for.
 *
 * Returns `null` only on the server. On the client the probe runs during the
 * first render, not in an effect: an effect fires *after* the tree has already
 * mounted, which for this question is far too late — the renderer would have
 * been constructed and thrown before we ever got the answer.
 */
let cached: boolean | null = null;

function probe(): boolean {
  if (cached !== null) return cached;
  try {
    const canvas = document.createElement("canvas");
    const gl =
      (canvas.getContext("webgl2") as WebGLRenderingContext | null) ??
      (canvas.getContext("webgl") as WebGLRenderingContext | null);
    if (gl) {
      // Hand the context back rather than waiting for GC.
      gl.getExtension("WEBGL_lose_context")?.loseContext();
      cached = true;
    } else {
      cached = false;
    }
  } catch {
    cached = false;
  }
  return cached;
}

export function useWebGLSupport(): boolean | null {
  // Probed in the initialiser, so the very first client render already knows.
  // Both consumers of this render with `ssr: false`, so the server's `null`
  // never reaches the DOM and there is nothing to mismatch against.
  const [supported] = React.useState<boolean | null>(() =>
    typeof document === "undefined" ? null : probe(),
  );

  return supported;
}

export default useWebGLSupport;

/**
 * Lazy GSAP loader — one dynamic import shared by every animated component,
 * so gsap + ScrollTrigger live in a single async chunk and are registered once.
 */
let cached: Promise<{ gsap: typeof import('gsap').gsap; ScrollTrigger: typeof import('gsap/ScrollTrigger').ScrollTrigger }> | null = null;

export function loadGsap() {
  cached ??= Promise.all([import('gsap'), import('gsap/ScrollTrigger')]).then(([g, st]) => {
    g.gsap.registerPlugin(st.ScrollTrigger);
    return { gsap: g.gsap, ScrollTrigger: st.ScrollTrigger };
  });
  return cached;
}

/** True when the user asked the OS for less motion — every effect must respect it. */
export function prefersReducedMotion(): boolean {
  return typeof window !== 'undefined' && (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false);
}

/** Coarse pointer ⇒ no hover-driven effects (tilt, magnetic, mouse parallax). */
export function isTouchDevice(): boolean {
  return typeof window !== 'undefined' && window.matchMedia?.('(pointer: coarse)').matches;
}

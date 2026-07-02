import * as THREE from 'three';

export interface HeroScene {
  dispose(): void;
}

/**
 * Ambient WebGL layer for the homepage hero: a slow drift of warm, glowing
 * motes — flour dust caught in oven light — with gentle mouse parallax.
 *
 * Deliberately atmospheric rather than figurative (the photography is the
 * subject; the 3D is the air around it). Lazy-loaded, DPR-capped, paused
 * when off-screen or the tab is hidden, and fully disposed on destroy.
 */
export function createHeroScene(host: HTMLElement): HeroScene {
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(55, 1, 0.1, 60);
  camera.position.z = 14;

  const renderer = new THREE.WebGLRenderer({ alpha: true, antialias: false, powerPreference: 'low-power' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.75));
  renderer.domElement.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;pointer-events:none;';
  host.appendChild(renderer.domElement);

  // --- Soft round sprite drawn once on a canvas (no texture download) ---
  const sprite = document.createElement('canvas');
  sprite.width = sprite.height = 64;
  const ctx = sprite.getContext('2d')!;
  const grad = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
  grad.addColorStop(0, 'rgba(255, 236, 200, 1)');
  grad.addColorStop(0.35, 'rgba(242, 197, 128, 0.55)');
  grad.addColorStop(1, 'rgba(242, 197, 128, 0)');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, 64, 64);
  const texture = new THREE.CanvasTexture(sprite);

  // --- Particle field ---
  const COUNT = 150;
  const positions = new Float32Array(COUNT * 3);
  const speeds = new Float32Array(COUNT);
  const sways = new Float32Array(COUNT);
  const SPREAD = { x: 30, y: 18, z: 10 };
  for (let i = 0; i < COUNT; i++) {
    positions[i * 3] = (Math.random() - 0.5) * SPREAD.x;
    positions[i * 3 + 1] = (Math.random() - 0.5) * SPREAD.y;
    positions[i * 3 + 2] = (Math.random() - 0.5) * SPREAD.z;
    speeds[i] = 0.12 + Math.random() * 0.35;
    sways[i] = Math.random() * Math.PI * 2;
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));

  const material = new THREE.PointsMaterial({
    size: 0.55,
    map: texture,
    transparent: true,
    opacity: 0.75,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    sizeAttenuation: true,
  });
  const points = new THREE.Points(geometry, material);
  scene.add(points);

  // A few larger, closer "bokeh" motes for depth.
  const bokehGeo = new THREE.BufferGeometry();
  const bokehPos = new Float32Array(18 * 3);
  for (let i = 0; i < 18; i++) {
    bokehPos[i * 3] = (Math.random() - 0.5) * 26;
    bokehPos[i * 3 + 1] = (Math.random() - 0.5) * 14;
    bokehPos[i * 3 + 2] = 2 + Math.random() * 6;
  }
  bokehGeo.setAttribute('position', new THREE.BufferAttribute(bokehPos, 3));
  const bokehMat = material.clone();
  bokehMat.size = 1.6;
  bokehMat.opacity = 0.22;
  const bokeh = new THREE.Points(bokehGeo, bokehMat);
  scene.add(bokeh);

  // --- Sizing ---
  const resize = () => {
    const { clientWidth: w, clientHeight: h } = host;
    if (!w || !h) return;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  };
  resize();
  const ro = new ResizeObserver(resize);
  ro.observe(host);

  // --- Mouse parallax (window-level; the canvas ignores pointer events) ---
  const mouse = { x: 0, y: 0 };
  const onPointer = (e: PointerEvent) => {
    mouse.x = (e.clientX / window.innerWidth - 0.5) * 2;
    mouse.y = (e.clientY / window.innerHeight - 0.5) * 2;
  };
  window.addEventListener('pointermove', onPointer, { passive: true });

  // --- Visibility gating ---
  let inView = true;
  const io = new IntersectionObserver(([entry]) => { inView = entry.isIntersecting; }, { threshold: 0 });
  io.observe(host);

  // --- Loop ---
  let frame = 0;
  let last = performance.now();
  const tick = (now: number) => {
    frame = requestAnimationFrame(tick);
    if (!inView || document.hidden) { last = now; return; }
    const dt = Math.min((now - last) / 1000, 0.05);
    last = now;

    const pos = geometry.attributes['position'] as THREE.BufferAttribute;
    const t = now / 1000;
    for (let i = 0; i < COUNT; i++) {
      let y = pos.getY(i) + speeds[i] * dt;
      if (y > SPREAD.y / 2) y = -SPREAD.y / 2;
      pos.setY(i, y);
      pos.setX(i, pos.getX(i) + Math.sin(t * 0.4 + sways[i]) * dt * 0.18);
    }
    pos.needsUpdate = true;

    bokeh.rotation.z += dt * 0.012;

    camera.position.x += (mouse.x * 1.4 - camera.position.x) * 0.03;
    camera.position.y += (-mouse.y * 0.9 - camera.position.y) * 0.03;
    camera.lookAt(0, 0, 0);

    renderer.render(scene, camera);
  };
  frame = requestAnimationFrame(tick);

  return {
    dispose() {
      cancelAnimationFrame(frame);
      ro.disconnect();
      io.disconnect();
      window.removeEventListener('pointermove', onPointer);
      geometry.dispose();
      bokehGeo.dispose();
      material.dispose();
      bokehMat.dispose();
      texture.dispose();
      renderer.dispose();
      renderer.domElement.remove();
    },
  };
}

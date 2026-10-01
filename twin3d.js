// 3D stage for the digital twin: a glowing grid floor under a starry sky, with a floating "?" (before
// anything is known) or a low-poly avatar (once it takes shape). Drag or scroll to rotate.
// Uses the bundled Three.js build in vendor/ (MIT licence, see vendor/LICENSE-three.txt).
import * as THREE from "./vendor/three.module.min.js";

const AQUA = 0x7fe0d4;
const CORAL = 0xff7a6b;
const GOLD = 0xffc46b;
const NAVY = 0x040b1d;

// Colour sets for the three Shadow themes
const THEMES = {
  glass: { bg: 0x040b1d, colA: 0x1f6bff, colB: 0x80f2e6, ring: AQUA, ring2: 0x3d8bff, stars: 0xcfeaff, glow: 0x4696ff, radar: false },
  hud: { bg: 0x03091a, colA: 0x2f6bff, colB: 0x7fe0d4, ring: AQUA, ring2: CORAL, stars: 0xcfeaff, glow: 0x2f6bff, radar: false },
  terminal: { bg: 0x040d12, colA: 0x0e6b5a, colB: 0x7fffd0, ring: 0x7fffd0, ring2: 0x1f9d7a, stars: 0x7fe0d4, glow: 0x1fbf9a, radar: true },
};

const OUTFIT = { sporty: 0x4fd1c5, streetwear: 0xff7a6b, outdoor: 0x5aa469, smart: 0x1b2b3a, luxury: 0xc9a24b, casual: 0x8fb8cc };

export function createTwinStage(container) {
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false, powerPreference: "high-performance" });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.setClearColor(NAVY, 1);
  renderer.domElement.style.cssText = "display:block;width:100%;height:100%;touch-action:none;cursor:grab;";
  container.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  scene.fog = new THREE.Fog(NAVY, 14, 46);
  const camera = new THREE.PerspectiveCamera(42, 1, 0.1, 200);
  const target = new THREE.Vector3(0, 2.0, 0);
  let camDist = 9;
  const placeCamera = () => {
    camera.position.set(0, 3.0, camDist);
    camera.lookAt(target);
  };
  placeCamera();

  // ----- lights -----
  scene.add(new THREE.AmbientLight(0x88aaff, 0.9));
  const key = new THREE.DirectionalLight(0xbfe9ff, 1.4);
  key.position.set(4, 7, 6);
  scene.add(key);
  const rim = new THREE.PointLight(CORAL, 40, 20, 1.6);
  rim.position.set(-4, 3, -3);
  scene.add(rim);
  const under = new THREE.PointLight(AQUA, 30, 14, 1.6);
  under.position.set(0, 0.2, 0);
  scene.add(under);

  // ----- stars -----
  const starPos = [];
  for (let i = 0; i < 1100; i++) {
    const r = 55 + Math.random() * 25;
    const th = Math.random() * Math.PI * 2;
    const ph = Math.acos(Math.random() * 0.92 + 0.05); // upper hemisphere only
    starPos.push(r * Math.sin(ph) * Math.cos(th), r * Math.cos(ph) + 2, r * Math.sin(ph) * Math.sin(th) - 10);
  }
  const starGeo = new THREE.BufferGeometry();
  starGeo.setAttribute("position", new THREE.Float32BufferAttribute(starPos, 3));
  const stars = new THREE.Points(starGeo, new THREE.PointsMaterial({ color: 0xcfeaff, size: 0.35, sizeAttenuation: true, transparent: true, opacity: 0.85, fog: false, depthWrite: false }));
  scene.add(stars);

  // ----- horizon glow -----
  const glowTex = radialTexture("rgba(255,255,255,0.32)", "rgba(255,255,255,0)");
  const glow = new THREE.Mesh(new THREE.PlaneGeometry(120, 36), new THREE.MeshBasicMaterial({ map: glowTex, transparent: true, depthWrite: false, fog: false, blending: THREE.AdditiveBlending }));
  glow.position.set(0, 4, -42);
  scene.add(glow);

  // ----- grid floor (lines + glowing dots, with a pulse that travels outward) -----
  const uniforms = {
    uTime: { value: 0 },
    uPR: { value: renderer.getPixelRatio() },
    uColA: { value: new THREE.Color(THEMES.glass.colA) },
    uColB: { value: new THREE.Color(THEMES.glass.colB) },
  };
  const SP = 1.5; // grid spacing
  const N = 30; // lines each side of the centre
  const linePos = [];
  const dotPos = [];
  for (let i = -N; i <= N; i++) {
    for (let j = -N; j < N; j++) {
      linePos.push(i * SP, 0, j * SP, i * SP, 0, (j + 1) * SP); // line along z
      linePos.push(j * SP, 0, i * SP, (j + 1) * SP, 0, i * SP); // line along x
    }
    for (let j = -N; j <= N; j++) dotPos.push(i * SP, 0, j * SP);
  }
  const waveGLSL = `
    float wave(float d){ return exp(-pow((d - mod(uTime * 6.0, 70.0)) * 0.3, 2.0)); }
  `;
  const lineGeo = new THREE.BufferGeometry();
  lineGeo.setAttribute("position", new THREE.Float32BufferAttribute(linePos, 3));
  const grid = new THREE.LineSegments(
    lineGeo,
    new THREE.ShaderMaterial({
      uniforms,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      vertexShader: `uniform float uTime; varying float vA; ${waveGLSL}
        void main(){ float d = length(position.xz); float fade = 1.0 - smoothstep(5.0, 34.0, d);
          vA = fade * (0.14 + wave(d) * 0.5); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
      fragmentShader: `uniform vec3 uColA; uniform vec3 uColB; varying float vA; void main(){ gl_FragColor = vec4(mix(uColA, uColB, clamp(vA, 0.0, 1.0)), vA); }`,
    })
  );
  scene.add(grid);

  const dotGeo = new THREE.BufferGeometry();
  dotGeo.setAttribute("position", new THREE.Float32BufferAttribute(dotPos, 3));
  const dots = new THREE.Points(
    dotGeo,
    new THREE.ShaderMaterial({
      uniforms,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      vertexShader: `uniform float uTime; uniform float uPR; varying float vA; ${waveGLSL}
        void main(){ vec4 mv = modelViewMatrix * vec4(position, 1.0); float d = length(position.xz);
          float w = wave(d); float fade = 1.0 - smoothstep(5.0, 34.0, d);
          vA = fade * (0.3 + w * 0.6); gl_PointSize = min((2.4 + w * 4.0) * uPR * (200.0 / max(1.0, -mv.z)), 11.0 * uPR); gl_Position = projectionMatrix * mv; }`,
      fragmentShader: `uniform vec3 uColA; uniform vec3 uColB; varying float vA; void main(){ float r = length(gl_PointCoord - 0.5); float a = smoothstep(0.5, 0.05, r) * vA;
          gl_FragColor = vec4(mix(uColA, uColB, clamp(vA - 0.5, 0.0, 1.0)), a); }`,
    })
  );
  scene.add(dots);

  // platform under the figure
  const padTex = radialTexture("rgba(255,255,255,0.28)", "rgba(255,255,255,0)");
  const pad = new THREE.Mesh(new THREE.PlaneGeometry(7, 7), new THREE.MeshBasicMaterial({ map: padTex, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false }));
  pad.rotation.x = -Math.PI / 2;
  pad.position.y = 0.02;
  scene.add(pad);
  const ring = new THREE.Mesh(new THREE.RingGeometry(1.55, 1.62, 64), new THREE.MeshBasicMaterial({ color: AQUA, transparent: true, opacity: 0.5, side: THREE.DoubleSide, blending: THREE.AdditiveBlending, depthWrite: false }));
  ring.rotation.x = -Math.PI / 2;
  ring.position.y = 0.03;
  scene.add(ring);
  const ring2 = new THREE.Mesh(new THREE.RingGeometry(2.1, 2.14, 64), new THREE.MeshBasicMaterial({ color: 0x3d8bff, transparent: true, opacity: 0.55, side: THREE.DoubleSide, blending: THREE.AdditiveBlending, depthWrite: false }));
  ring2.rotation.x = -Math.PI / 2;
  ring2.position.y = 0.03;
  scene.add(ring2);

  // radar sweep on the floor (terminal theme only)
  const radar = new THREE.Mesh(
    new THREE.CircleGeometry(9, 48, 0, 0.8),
    new THREE.MeshBasicMaterial({ color: AQUA, transparent: true, opacity: 0.16, side: THREE.DoubleSide, blending: THREE.AdditiveBlending, depthWrite: false })
  );
  radar.rotation.x = -Math.PI / 2;
  radar.position.y = 0.04;
  radar.visible = false;
  scene.add(radar);

  function setTheme(name) {
    const th = THEMES[name] || THEMES.glass;
    renderer.setClearColor(th.bg, 1);
    scene.fog.color.setHex(th.bg);
    uniforms.uColA.value.setHex(th.colA);
    uniforms.uColB.value.setHex(th.colB);
    ring.material.color.setHex(th.ring);
    ring2.material.color.setHex(th.ring2);
    stars.material.color.setHex(th.stars);
    glow.material.color.setHex(th.glow);
    pad.material.color.setHex(th.ring);
    radar.material.color.setHex(th.colB);
    radar.visible = th.radar;
  }
  setTheme("glass");

  // ----- the twin (rotates with the user's input) -----
  const spin = new THREE.Group(); // receives drag/scroll rotation
  scene.add(spin);
  const rig = new THREE.Group(); // floats up and down
  spin.add(rig);
  let model = null;
  let orbiters = [];
  let signature = "";

  function disposeModel() {
    if (!model) return;
    model.traverse((o) => {
      if (o.geometry) o.geometry.dispose();
      if (o.material) {
        for (const m of [].concat(o.material)) {
          if (m.map) m.map.dispose();
          m.dispose();
        }
      }
    });
    rig.remove(model);
    model = null;
    orbiters = [];
  }

  function setTwin(avatar) {
    const sig = JSON.stringify([avatar.revealed, avatar.style, avatar.props]);
    if (sig === signature) return;
    signature = sig;
    disposeModel();
    model = new THREE.Group();
    rig.add(model);
    if (avatar.revealed) buildAvatar(model, avatar, orbiters);
    else buildQuestionMark(model);
  }

  // ----- interaction: drag, trackpad scroll, keys, double-click reset -----
  let yaw = 0.5;
  let pitch = 0.0;
  let velYaw = 0;
  let dragging = false;
  let lastX = 0;
  let lastY = 0;
  let lastTouch = -Infinity;
  const dom = renderer.domElement;
  const clampPitch = (p) => Math.max(-0.35, Math.min(0.55, p));
  const touched = () => (lastTouch = performance.now());

  dom.addEventListener("pointerdown", (e) => {
    dragging = true;
    lastX = e.clientX;
    lastY = e.clientY;
    dom.setPointerCapture(e.pointerId);
    dom.style.cursor = "grabbing";
    touched();
  });
  dom.addEventListener("pointermove", (e) => {
    if (!dragging) return;
    const dx = e.clientX - lastX;
    const dy = e.clientY - lastY;
    lastX = e.clientX;
    lastY = e.clientY;
    yaw += dx * 0.01;
    velYaw = dx * 0.01;
    pitch = clampPitch(pitch + dy * 0.004);
    touched();
  });
  const endDrag = (e) => {
    dragging = false;
    dom.style.cursor = "grab";
    if (e && dom.hasPointerCapture(e.pointerId)) dom.releasePointerCapture(e.pointerId);
  };
  dom.addEventListener("pointerup", endDrag);
  dom.addEventListener("pointercancel", endDrag);
  dom.addEventListener(
    "wheel",
    (e) => {
      e.preventDefault(); // two-finger trackpad scroll rotates the model instead of scrolling the page
      if (e.ctrlKey) {
        camDist = Math.max(5.5, Math.min(13, camDist + e.deltaY * 0.03)); // pinch to zoom
        placeCamera();
      } else {
        yaw += e.deltaX * 0.008;
        pitch = clampPitch(pitch + e.deltaY * 0.003);
      }
      touched();
    },
    { passive: false }
  );
  dom.addEventListener("dblclick", () => {
    yaw = 0.5;
    pitch = 0;
    velYaw = 0;
    camDist = 9;
    placeCamera();
  });
  container.addEventListener("keydown", (e) => {
    const step = 0.15;
    if (e.key === "ArrowLeft") yaw -= step;
    else if (e.key === "ArrowRight") yaw += step;
    else if (e.key === "ArrowUp") pitch = clampPitch(pitch - step * 0.5);
    else if (e.key === "ArrowDown") pitch = clampPitch(pitch + step * 0.5);
    else return;
    e.preventDefault();
    touched();
  });

  // ----- size and render loop -----
  function resize() {
    const w = container.clientWidth;
    const h = container.clientHeight;
    if (!w || !h) return;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  }
  const ro = new ResizeObserver(resize);
  ro.observe(container);
  resize();

  let raf = 0;
  const clock = new THREE.Clock();
  function frame() {
    raf = requestAnimationFrame(frame);
    if (document.hidden || !container.offsetParent) return; // nothing to draw when hidden
    const t = clock.getElapsedTime();
    uniforms.uTime.value = t;

    if (!dragging) {
      yaw += velYaw;
      velYaw *= 0.94;
      if (performance.now() - lastTouch > 2500) yaw += 0.0035; // gentle idle rotation
    }
    spin.rotation.y = yaw;
    spin.rotation.x = pitch;
    rig.position.y = 1.15 + Math.sin(t * 1.3) * 0.12;
    stars.rotation.y = t * 0.004;
    ring.scale.setScalar(1 + Math.sin(t * 1.5) * 0.03);
    ring2.rotation.z = t * 0.2;
    if (radar.visible) radar.rotation.z = -t * 1.1;
    if (model && model.userData.spinner) model.userData.spinner.rotation.z = t * 0.6;
    for (const o of orbiters) {
      const a = o.angle + t * 0.35;
      o.group.position.set(Math.cos(a) * o.radius, o.height + Math.sin(t * 1.1 + o.angle) * 0.12, Math.sin(a) * o.radius);
      o.group.rotation.y = t * 0.8;
    }
    renderer.render(scene, camera);
  }
  frame();

  function dispose() {
    cancelAnimationFrame(raf);
    ro.disconnect();
    disposeModel();
    renderer.dispose();
    renderer.domElement.remove();
  }

  // PNG of the current view (render first so the buffer is fresh), used by the share card
  function snapshot() {
    renderer.render(scene, camera);
    return renderer.domElement.toDataURL("image/png");
  }

  return { setTwin, setTheme, snapshot, dispose };
}

// ===== model builders =====

function radialTexture(inner, outer) {
  const c = document.createElement("canvas");
  c.width = c.height = 256;
  const g = c.getContext("2d");
  const grad = g.createRadialGradient(128, 128, 0, 128, 128, 128);
  grad.addColorStop(0, inner);
  grad.addColorStop(1, outer);
  g.fillStyle = grad;
  g.fillRect(0, 0, 256, 256);
  return new THREE.CanvasTexture(c);
}

function textTexture(text, { font, color, glow, w = 512, h = 512 }) {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  const g = c.getContext("2d");
  g.textAlign = "center";
  g.textBaseline = "middle";
  g.font = font;
  g.shadowColor = glow;
  g.shadowBlur = 28;
  g.fillStyle = color;
  g.fillText(text, w / 2, h / 2 + 18);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

// A "?" faked as thick glowing layers, so it reads as solid when rotated
function buildQuestionMark(group) {
  const tex = textTexture("?", { font: "bold 430px Georgia, serif", color: "#7fd8ff", glow: "#3d8bff" });
  const layers = 11;
  for (let i = 0; i < layers; i++) {
    const z = (i / (layers - 1) - 0.5) * 0.42;
    const edge = Math.abs(i / (layers - 1) - 0.5) * 2; // 1 at the faces, 0 in the middle
    const mat = new THREE.MeshBasicMaterial({ map: tex, transparent: true, side: THREE.DoubleSide, depthWrite: false, blending: THREE.AdditiveBlending, opacity: 0.05 + edge * 0.2, fog: false });
    const plane = new THREE.Mesh(new THREE.PlaneGeometry(2.6, 2.6), mat);
    plane.position.z = z;
    plane.position.y = 1.35;
    group.add(plane);
  }
  // orbiting rings around the "?"
  const spinner = new THREE.Group();
  spinner.position.y = 1.35;
  for (const [r, tilt, col] of [[1.5, 1.15, AQUA], [1.8, 0.5, 0x3d8bff]]) {
    const torus = new THREE.Mesh(new THREE.TorusGeometry(r, 0.012, 8, 96), new THREE.MeshBasicMaterial({ color: col, transparent: true, opacity: 0.7, blending: THREE.AdditiveBlending, depthWrite: false }));
    torus.rotation.x = tilt;
    spinner.add(torus);
  }
  group.add(spinner);
  group.userData.spinner = spinner;
}

function mat(color, extra = {}) {
  return new THREE.MeshStandardMaterial({ color, roughness: 0.45, metalness: 0.15, emissive: color, emissiveIntensity: 0.14, ...extra });
}

function part(parent, geo, color, pos, opts = {}) {
  const mesh = new THREE.Mesh(geo, opts.material || mat(color));
  mesh.position.set(...pos);
  if (opts.rot) mesh.rotation.set(...opts.rot);
  if (opts.scale) mesh.scale.set(...opts.scale);
  parent.add(mesh);
  if (opts.wire) {
    const wire = new THREE.LineSegments(new THREE.WireframeGeometry(geo), new THREE.LineBasicMaterial({ color: AQUA, transparent: true, opacity: 0.16, depthWrite: false }));
    wire.position.copy(mesh.position);
    wire.rotation.copy(mesh.rotation);
    wire.scale.copy(mesh.scale);
    parent.add(wire);
  }
  return mesh;
}

function buildAvatar(group, avatar, orbiters) {
  const body = new THREE.Group();
  group.add(body);
  const outfit = OUTFIT[avatar.style] || 0x4a6a80;
  const skin = 0xcfe0e8;
  const legs = 0x1f3550;

  // legs, torso, arms, neck, head
  for (const x of [-0.2, 0.2]) part(body, new THREE.CapsuleGeometry(0.16, 0.7, 6, 14), legs, [x, 0.6, 0], { wire: true });
  const torso = part(body, new THREE.CapsuleGeometry(0.42, 0.6, 8, 18), outfit, [0, 1.75, 0], { scale: [1.05, 1, 0.68], wire: true });
  for (const s of [-1, 1]) part(body, new THREE.CapsuleGeometry(0.12, 0.7, 6, 12), outfit, [s * 0.66, 1.78, 0], { rot: [0, 0, s * 0.12], wire: true });
  part(body, new THREE.CylinderGeometry(0.12, 0.14, 0.2, 12), skin, [0, 2.5, 0]);
  const head = part(body, new THREE.SphereGeometry(0.4, 28, 20), skin, [0, 2.95, 0], { wire: true });
  // faceless visor, so you can see which way it is facing
  part(body, new THREE.BoxGeometry(0.52, 0.08, 0.06), AQUA, [0, 2.98, 0.35], { material: new THREE.MeshBasicMaterial({ color: AQUA }) });

  // clothing details
  if (avatar.style === "sporty") {
    for (const s of [-1, 1]) part(body, new THREE.BoxGeometry(0.05, 1.2, 0.02), 0xffffff, [s * 0.27, 1.75, 0.3]);
  } else if (avatar.style === "streetwear") {
    part(body, new THREE.TorusGeometry(0.3, 0.09, 10, 24), outfit, [0, 2.4, -0.02], { rot: [Math.PI / 2.4, 0, 0] });
    part(body, new THREE.BoxGeometry(0.6, 0.28, 0.06), 0x0b2239, [0, 1.35, 0.3]);
  } else if (avatar.style === "outdoor") {
    part(body, new THREE.BoxGeometry(0.04, 1.2, 0.02), 0x0b2239, [0, 1.75, 0.31]);
  } else if (avatar.style === "smart") {
    part(body, new THREE.BoxGeometry(0.1, 0.8, 0.03), CORAL, [0, 1.8, 0.3]);
    part(body, new THREE.BoxGeometry(0.34, 0.1, 0.04), 0xffffff, [0, 2.3, 0.28]);
  } else if (avatar.style === "luxury") {
    part(body, new THREE.TorusGeometry(0.43, 0.035, 8, 32), GOLD, [0, 1.35, 0], { rot: [Math.PI / 2, 0, 0], scale: [1.05, 0.68, 1] });
  } else if (!avatar.style) {
    // outfit style unknown: a small "?" on the chest
    const tex = textTexture("?", { font: "bold 360px Georgia, serif", color: "#cfe0e8", glow: "#7fe0d4", w: 256, h: 256 });
    const label = new THREE.Mesh(new THREE.PlaneGeometry(0.5, 0.5), new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false }));
    label.position.set(0, 1.85, 0.32);
    body.add(label);
  }

  // "hair: ?" floating above the head
  const hairTex = textTexture("hair: ?", { font: "italic 64px Georgia, serif", color: "#8fb8cc", glow: "#0b2239", w: 512, h: 128 });
  const hair = new THREE.Sprite(new THREE.SpriteMaterial({ map: hairTex, transparent: true, depthWrite: false, fog: false }));
  hair.scale.set(1.6, 0.4, 1);
  hair.position.set(0, 3.75, 0);
  body.add(hair);
  const hairRing = new THREE.Mesh(new THREE.TorusGeometry(0.43, 0.012, 6, 40), new THREE.MeshBasicMaterial({ color: 0x8fb8cc, transparent: true, opacity: 0.6 }));
  hairRing.position.set(0, 3.12, 0);
  hairRing.rotation.x = Math.PI / 2.2;
  body.add(hairRing);

  // props that match the interests
  const props = avatar.props || [];
  const orbiting = props.filter((p) => p !== "headphones");
  if (props.includes("headphones")) {
    const arc = new THREE.Mesh(new THREE.TorusGeometry(0.46, 0.04, 8, 28, Math.PI), mat(CORAL));
    arc.position.set(0, 2.95, 0);
    body.add(arc);
    for (const s of [-1, 1]) part(body, new THREE.CylinderGeometry(0.14, 0.14, 0.1, 16), CORAL, [s * 0.46, 2.95, 0], { rot: [0, 0, Math.PI / 2] });
  }
  orbiting.forEach((name, i) => {
    const g = propMesh(name);
    if (!g) return;
    group.add(g);
    orbiters.push({ group: g, angle: (i / Math.max(1, orbiting.length)) * Math.PI * 2, radius: 1.9, height: 1.2 + (i % 3) * 0.55 });
  });
}

function propMesh(name) {
  const g = new THREE.Group();
  const white = 0xeaf6f8;
  switch (name) {
    case "gamepad":
      part(g, new THREE.BoxGeometry(0.6, 0.16, 0.32), white, [0, 0, 0]);
      part(g, new THREE.CylinderGeometry(0.06, 0.06, 0.18, 12), AQUA, [0.18, 0.02, 0.04]);
      part(g, new THREE.CylinderGeometry(0.06, 0.06, 0.18, 12), CORAL, [-0.18, 0.02, 0.04]);
      break;
    case "laptop":
      part(g, new THREE.BoxGeometry(0.7, 0.05, 0.5), 0x8fb8cc, [0, 0, 0]);
      part(g, new THREE.BoxGeometry(0.7, 0.45, 0.04), white, [0, 0.24, -0.25], { rot: [-0.3, 0, 0] });
      break;
    case "bag":
      part(g, new THREE.BoxGeometry(0.4, 0.45, 0.2), GOLD, [0, 0, 0]);
      part(g, new THREE.TorusGeometry(0.13, 0.025, 6, 16, Math.PI), white, [0, 0.22, 0]);
      break;
    case "plane":
      part(g, new THREE.ConeGeometry(0.14, 0.55, 3), AQUA, [0, 0, 0], { rot: [0, 0, -Math.PI / 2] });
      part(g, new THREE.BoxGeometry(0.02, 0.02, 0.5), AQUA, [-0.05, 0, 0]);
      break;
    case "ball":
      part(g, new THREE.SphereGeometry(0.22, 18, 14), white, [0, 0, 0], { wire: true });
      break;
    case "fork":
      for (const x of [-0.06, 0, 0.06]) part(g, new THREE.CylinderGeometry(0.012, 0.012, 0.25, 6), white, [x, 0.2, 0]);
      part(g, new THREE.CylinderGeometry(0.02, 0.02, 0.35, 8), white, [0, -0.1, 0]);
      break;
    default:
      return null;
  }
  return g;
}

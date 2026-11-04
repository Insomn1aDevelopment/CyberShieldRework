// 3D-щит для главной страницы (Three.js). app.js вызывает window.mountHero3D(el) и получает функцию очистки.
import * as THREE from './vendor/three.module.min.js';

function accent() {
  return new THREE.Color(getComputedStyle(document.documentElement).getPropertyValue('--accent').trim() || '#5b5cf0');
}

function shieldShape(w, h) {
  const s = new THREE.Shape();
  s.moveTo(0, h * 0.5);
  s.bezierCurveTo(w * 0.25, h * 0.42, w * 0.42, h * 0.42, w * 0.5, h * 0.4);
  s.lineTo(w * 0.5, 0);
  s.bezierCurveTo(w * 0.5, -h * 0.28, w * 0.22, -h * 0.42, 0, -h * 0.5);
  s.bezierCurveTo(-w * 0.22, -h * 0.42, -w * 0.5, -h * 0.28, -w * 0.5, 0);
  s.lineTo(-w * 0.5, h * 0.4);
  s.bezierCurveTo(-w * 0.42, h * 0.42, -w * 0.25, h * 0.42, 0, h * 0.5);
  return s;
}

function mount(el) {
  let renderer;
  try { renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true }); } catch { return null; }
  const size = () => [el.clientWidth || 320, el.clientHeight || 320];
  let [w, h] = size();
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  renderer.setSize(w, h);
  el.append(renderer.domElement);

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(40, w / h, 0.1, 100);
  camera.position.set(0, 0, 7.5);

  scene.add(new THREE.AmbientLight(0xffffff, 0.55));
  const key = new THREE.DirectionalLight(0xffffff, 1.6); key.position.set(3, 4, 5); scene.add(key);
  const rim = new THREE.PointLight(0xffffff, 30, 20); rim.position.set(-4, -2, 3); scene.add(rim);

  const group = new THREE.Group(); scene.add(group);
  const bodyMat = new THREE.MeshStandardMaterial({ metalness: 0.55, roughness: 0.25 });
  const darkMat = new THREE.MeshStandardMaterial({ color: 0x111111, metalness: 0.3, roughness: 0.4 });
  const extrude = (shape, depth, bevel) => {
    const g = new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: true, bevelThickness: bevel, bevelSize: bevel, bevelSegments: 6, curveSegments: 32 });
    g.center(); return g;
  };
  const body = new THREE.Mesh(extrude(shieldShape(2.6, 3.1), 0.35, 0.12), bodyMat);
  const inner = new THREE.Mesh(extrude(shieldShape(2.0, 2.45), 0.1, 0.05), darkMat);
  inner.position.z = 0.28;
  group.add(body, inner);

  // замок
  const lockMat = new THREE.MeshStandardMaterial({ metalness: 0.7, roughness: 0.2, emissiveIntensity: 0.6 });
  const lockBody = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.7, 0.25), lockMat);
  lockBody.position.set(0, -0.2, 0.45);
  const shackle = new THREE.Mesh(new THREE.TorusGeometry(0.3, 0.07, 16, 40, Math.PI), lockMat);
  shackle.position.set(0, 0.15, 0.45);
  const hole = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.08, 0.3, 20), darkMat);
  hole.rotation.x = Math.PI / 2; hole.position.set(0, -0.2, 0.5);
  group.add(lockBody, shackle, hole);

  // орбитальные кольца
  const ringMat = new THREE.MeshBasicMaterial({ transparent: true, opacity: 0.35 });
  const rings = [2.4, 2.9].map((r, i) => {
    const m = new THREE.Mesh(new THREE.TorusGeometry(r, 0.012, 8, 160), ringMat);
    m.rotation.x = Math.PI / 2 + (i ? 0.5 : -0.35); m.rotation.y = i ? 0.3 : -0.2;
    scene.add(m); return m;
  });

  // частицы-«биты»
  const N = 420, pos = new Float32Array(N * 3);
  for (let i = 0; i < N; i++) {
    const r = 2.2 + Math.random() * 1.6, t = Math.random() * Math.PI * 2, y = (Math.random() - 0.5) * 3.4;
    pos.set([Math.cos(t) * r, y, Math.sin(t) * r], i * 3);
  }
  const pg = new THREE.BufferGeometry(); pg.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  const pointsMat = new THREE.PointsMaterial({ size: 0.045, transparent: true, opacity: 0.85 });
  const points = new THREE.Points(pg, pointsMat); scene.add(points);

  const applyColor = () => {
    const c = accent();
    bodyMat.color.copy(c); lockMat.color.copy(c).lerp(new THREE.Color(0xffffff), 0.35); lockMat.emissive.copy(c);
    ringMat.color.copy(c); pointsMat.color.copy(c); rim.color.copy(c);
  };
  applyColor();
  const themeObs = new MutationObserver(applyColor);
  themeObs.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });

  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const clock = new THREE.Clock();
  const DUR = 1.4;
  let mx = 0, my = 0, baseY = 0, clickT = -DUR, ringBoost = 0, last = 0;
  const onMove = e => { const r = el.getBoundingClientRect(); mx = ((e.clientX - r.left) / r.width - 0.5) * 2; my = ((e.clientY - r.top) / r.height - 0.5) * 2; };
  // новый клик только после того, как щит почти довернулся, иначе оборот дёрнется
  const onClick = () => { const t = clock.getElapsedTime(); if (!reduce && t - clickT > DUR * 0.85) clickT = t; };
  addEventListener('pointermove', onMove);
  el.addEventListener('click', onClick);
  const onResize = () => { [w, h] = size(); renderer.setSize(w, h); camera.aspect = w / h; camera.updateProjectionMatrix(); };
  addEventListener('resize', onResize);

  const easeInOut = k => k < 0.5 ? 4 * k ** 3 : 1 - (-2 * k + 2) ** 3 / 2;
  let raf;
  const tick = () => {
    const t = clock.getElapsedTime(), dt = t - last; last = t;
    const k = Math.min(1, (t - clickT) / DUR), on = k < 1, bell = on ? Math.sin(k * Math.PI) : 0;

    // наклон за курсором + полный оборот при нажатии
    baseY += ((mx * 0.6 + Math.sin(t * 0.6) * 0.25) - baseY) * 0.06;
    group.rotation.y = baseY + (on ? easeInOut(k) * Math.PI * 2 : 0);
    group.rotation.x += ((my * 0.35) - group.rotation.x) * 0.06;
    group.position.y = Math.sin(t * 1.2) * 0.08 + bell * 0.25;

    // сначала щит приседает, потом подпрыгивает и упруго возвращается
    const squash = k < 0.15 ? Math.sin(k / 0.15 * Math.PI) * 0.12 : 0;
    const pop = k >= 0.15 && on ? Math.sin((k - 0.15) / 0.85 * Math.PI) * 0.18 * (1 - k * 0.5) : 0;
    group.scale.set(1 + squash * 0.6 + pop, 1 - squash + pop, 1 + pop);

    // замок открывается и защёлкивается со вспышкой
    shackle.position.y = 0.15 + Math.max(0, Math.sin(t * 0.8)) * 0.12 + (k < 0.75 ? Math.sin(k / 0.75 * Math.PI) * 0.35 : 0);
    lockMat.emissiveIntensity = 0.6 + (k >= 0.7 && on ? Math.sin((k - 0.7) / 0.3 * Math.PI) * 2.4 : bell * 0.6);

    // разлёт частиц
    points.scale.setScalar(1 + bell * 0.45);
    pointsMat.size = 0.045 + bell * 0.03;

    ringBoost += dt * (on ? (1 - k) * 4 : 0);
    points.rotation.y = t * 0.12 + ringBoost * 0.5;
    rings[0].rotation.z = t * 0.25 + ringBoost; rings[1].rotation.z = -t * 0.18 - ringBoost;
    renderer.render(scene, camera);
    if (!reduce) raf = requestAnimationFrame(tick);
  };
  tick();

  return () => {
    cancelAnimationFrame(raf); themeObs.disconnect();
    removeEventListener('pointermove', onMove); removeEventListener('resize', onResize); el.removeEventListener('click', onClick);
    renderer.dispose(); renderer.domElement.remove();
  };
}

window.mountHero3D = mount;
const pending = document.getElementById('hero3d');
if (pending && !pending.dataset.mounted) window.dispatchEvent(new Event('hero3d-ready'));

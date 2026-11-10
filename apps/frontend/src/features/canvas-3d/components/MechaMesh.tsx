/**
 * Players — render de TODOS los avatares con UN `InstancedMesh` POR POSE (V1-B):
 * el muñeco del original (`avatarGeometry`) — de pie, arrodillado, bola y plano.
 * 4 draw calls como máximo; cada jugador se escribe en la malla de su pose y se
 * ORIENTA por su yaw (derivado del apunte) — girar para encajar.
 *
 * El jugador local NO se dibuja cuando está en primera persona (Seeker en HUNT):
 * la cámara está dentro de su cuerpo.
 *
 * Suavizado y caminata (post-playtest):
 *  - El local se dibuja INTERPOLADO entre su pos del tick anterior y la predicha
 *    (`sampleLocalMut`): la sim va a 30 Hz y el render a 60+ — sin esto "temblaba".
 *  - Bamboleo de juguete al CAMINAR (de pie/arrodillado): balanceo lateral + bote,
 *    con amplitud proporcional a la velocidad estimada. Solo presentación.
 *
 * Skill `r3f-rendering`: cero `setState` por frame; en `useFrame` se MUTAN matrices/
 * colores de instancia leyendo `worldStore` vía `getState()`; geometrías y material
 * memoizados; scratch de módulo (sin asignar por frame). Los remotos se INTERPOLAN
 * en el pasado.
 */
import { useRef, useMemo } from 'react';
import * as THREE from 'three';
import { useFrame } from '@react-three/fiber';
import { DEFAULT_SIM_CONFIG, POSE_COUNT, POSE_CROUCH, POSE_STAND } from '@mecha/sim';
import { worldStore } from '../store/worldStore';
import { sampleRemote, sampleLocalMut, INTERP_DELAY_MS } from '../hooks/interpolation';
import { buildPoseGeometries } from './avatarGeometry';

const MAX_PLAYERS = 16;
const TICK_MS = 1000 / DEFAULT_SIM_CONFIG.tickHz;
const MAX_SPEED = DEFAULT_SIM_CONFIG.maxSpeed;
const WOBBLE_FREQ = 10; // rad/s de balanceo al caminar
const WOBBLE_ROLL = 0.14; // rad de inclinación lateral máxima
const WOBBLE_BOB = 0.05; // m de bote vertical máximo

// Scratch de ámbito de módulo: el render es monohilo y `useFrame` es síncrono.
const _obj = new THREE.Object3D();
const _counts = new Int32Array(POSE_COUNT);
const _localPos = new THREE.Vector3();
const _targetColor = new THREE.Color();

/**
 * Estado de PRESENTACIÓN por avatar (id → color mostrado + rebote de pose). El
 * color mostrado persigue al real (la pintura "se extiende" en ~0.2 s en vez de
 * cambiar de golpe) y un cambio de pose dispara un squash&stretch breve. Se crea
 * UNA vez por jugador (nunca por frame) y se purga al vaciarse la sala.
 */
interface AvatarFx {
  readonly color: THREE.Color;
  pose: number;
  pop: number; // 1 → 0 tras un cambio de pose
  init: boolean;
}
const _fx = new Map<string, AvatarFx>();
const PAINT_RATE = 9; // 1/s
const POP_RATE = 4.5; // 1/s
function fxFor(id: string): AvatarFx {
  let f = _fx.get(id);
  if (!f) {
    f = { color: new THREE.Color(), pose: 0, pop: 0, init: false };
    _fx.set(id, f);
  }
  return f;
}
/** Avanza el fx hacia (colorHex, pose) y devuelve el mismo objeto. */
function stepFx(f: AvatarFx, colorHex: number, pose: number, dt: number): AvatarFx {
  _targetColor.setHex(colorHex, THREE.SRGBColorSpace);
  if (!f.init) {
    f.color.copy(_targetColor);
    f.pose = pose;
    f.init = true;
  } else {
    f.color.lerp(_targetColor, Math.min(1, dt * PAINT_RATE));
    if (f.pose !== pose) {
      f.pose = pose;
      f.pop = 1;
    }
  }
  if (f.pop > 0) f.pop = Math.max(0, f.pop - dt * POP_RATE);
  return f;
}
// Estado de caminata del LOCAL (presentación pura; persiste entre frames).
let _localPrevX = 0;
let _localPrevZ = 0;
let _localAmp = 0;
let _localPhase = 0;
let _localInit = false;

/** Avanza fase/amplitud de bamboleo según la distancia recorrida este frame. */
function advanceWobble(dist: number, dt: number, amp: number): number {
  const target = dt > 0 ? Math.min(1, dist / dt / MAX_SPEED) : 0;
  return amp + (target - amp) * Math.min(1, dt * 12);
}

export function Players() {
  const refs = useRef<Array<THREE.InstancedMesh | null>>(
    new Array<THREE.InstancedMesh | null>(POSE_COUNT).fill(null),
  );

  // Geometrías con los pies en y=0 (contrato de avatarGeometry: sin offset por pose).
  // Material LISO con el MISMO roughness que los señuelos del mapa (AVATAR_ROUGHNESS):
  // un jugador pintado junto a una estatua no debe delatarse por el brillo.
  const geometries = useMemo(() => buildPoseGeometries(), []);
  const material = useMemo(() => new THREE.MeshStandardMaterial({ roughness: 0.8 }), []);

  useFrame((_, delta) => {
    const dt = Math.min(delta, 0.1);
    const meshes = refs.current;
    const st = worldStore.getState();
    const now = performance.now();
    const renderTime = now - INTERP_DELAY_MS;
    _counts.fill(0);

    const writeAvatar = (
      pose: number,
      x: number,
      y: number,
      z: number,
      aimX: number,
      aimZ: number,
      fx: AvatarFx,
      wobblePhase: number,
      wobbleAmp: number,
    ): void => {
      const pi = pose >= 0 && pose < POSE_COUNT ? pose : 0;
      const mesh = meshes[pi];
      if (!mesh || _counts[pi]! >= MAX_PLAYERS) return;
      const i = _counts[pi]!;
      // Bamboleo de caminata: solo poses "a pie" (bola/plano/caja/barril no caminan así).
      const wobbles = (pi === POSE_STAND || pi === POSE_CROUCH) && wobbleAmp > 0.02;
      const bob = wobbles ? Math.abs(Math.sin(wobblePhase)) * WOBBLE_BOB * wobbleAmp : 0;
      _obj.position.set(x, y + bob, z);
      _obj.rotation.set(
        0,
        Math.atan2(aimX, aimZ), // orientado por el apunte (yaw)
        wobbles ? Math.sin(wobblePhase) * WOBBLE_ROLL * wobbleAmp : 0,
      );
      // Rebote de pose: se estira en Y y se estrecha en XZ, volviendo a 1.
      const pop = Math.sin(fx.pop * Math.PI) * fx.pop;
      _obj.scale.set(1 - pop * 0.12, 1 + pop * 0.2, 1 - pop * 0.12);
      _obj.updateMatrix();
      mesh.setMatrixAt(i, _obj.matrix);
      mesh.setColorAt(i, fx.color);
      _counts[pi] = i + 1;
    };

    // Jugador local: pos predicha SUAVIZADA entre ticks (bug del temblor). Oculto en
    // primera persona (Seeker en Hunt): la cámara está dentro de su cuerpo.
    const fpp = st.local.role === 'seeker' && st.phase === 'hunt';
    sampleLocalMut(st.localPrevPos, st.local.pos, st.localPredAt, now, TICK_MS, _localPos);
    if (!_localInit) {
      _localPrevX = _localPos.x;
      _localPrevZ = _localPos.z;
      _localInit = true;
    }
    const ldist = Math.hypot(_localPos.x - _localPrevX, _localPos.z - _localPrevZ);
    _localAmp = advanceWobble(ldist, dt, _localAmp);
    if (_localAmp > 0.02) _localPhase += dt * WOBBLE_FREQ * (0.5 + _localAmp * 0.5);
    _localPrevX = _localPos.x;
    _localPrevZ = _localPos.z;
    if (!fpp) {
      const lc = st.local.color;
      writeAvatar(
        st.local.pose,
        _localPos.x,
        _localPos.y,
        _localPos.z,
        st.local.aimX,
        st.local.aimZ,
        stepFx(
          fxFor('local'),
          ((lc.r & 0xff) << 16) | ((lc.g & 0xff) << 8) | (lc.b & 0xff),
          st.local.pose,
          dt,
        ),
        _localPhase,
        _localAmp,
      );
    }

    // Sala vacía de remotos (saliste / sala nueva): purga los fx de jugadores idos.
    if (st.remotes.size === 0 && _fx.size > 1) {
      const mine = _fx.get('local');
      _fx.clear();
      if (mine) _fx.set('local', mine);
    }

    // Remotos: INTERPOLADOS en el pasado (suave entre ticks de red) + su bamboleo.
    for (const e of st.remotes.values()) {
      sampleRemote(e.buffer, renderTime, e.render);
      const dist = Math.hypot(e.render.x - e.prevRX, e.render.z - e.prevRZ);
      e.wobbleAmp = advanceWobble(dist, dt, e.wobbleAmp);
      if (e.wobbleAmp > 0.02) e.wobblePhase += dt * WOBBLE_FREQ * (0.5 + e.wobbleAmp * 0.5);
      e.prevRX = e.render.x;
      e.prevRZ = e.render.z;
      writeAvatar(
        e.pose,
        e.render.x,
        e.render.y,
        e.render.z,
        e.aimX,
        e.aimZ,
        stepFx(fxFor(e.id), (e.colorPacked >>> 8) & 0xffffff, e.pose, dt),
        e.wobblePhase,
        e.wobbleAmp,
      );
    }

    for (let pi = 0; pi < POSE_COUNT; pi++) {
      const mesh = meshes[pi];
      if (!mesh) continue;
      mesh.count = _counts[pi]!;
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    }
  });

  return (
    <>
      {geometries.map((geo, pi) => (
        <instancedMesh
          key={pi}
          ref={(m) => {
            refs.current[pi] = m;
          }}
          args={[geo, material, MAX_PLAYERS]}
          castShadow
          receiveShadow
          // El culling usa la bounding sphere de la GEOMETRÍA (en el origen): con la
          // cámara FPP lejos del centro descartaría instancias visibles. Sin culling.
          frustumCulled={false}
        />
      ))}
    </>
  );
}

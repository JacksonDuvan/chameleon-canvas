/**
 * CameraRig — cámara por modo de juego (V1-C):
 *  - Seeker en HUNT: PRIMERA PERSONA a la altura de los ojos, orientada por el
 *    mouse-look (yaw+pitch) — la caza es escanear el escenario, como el original.
 *  - Hider en PREP/HUNT: TERCERA PERSONA orbitando tras el avatar según el yaw del
 *    ratón (permite girar para encajar la pose y auto-inspeccionar tu camuflaje).
 *  - Lobby / Ended: vista aérea-trasera fija (la de siempre).
 *
 * Skill `r3f-rendering`: muta la cámara DENTRO de `useFrame` (jamás setState por
 * frame); lee la posición PREDICHA del local vía `getState()` y el `lookState` de
 * módulo; scratch reutilizado; suavizado dependiente de `delta` (estable ante FPS).
 */
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { DEFAULT_SIM_CONFIG, rayAABB, type MapData } from '@mecha/sim';
import { worldStore } from '../store/worldStore';
import { lookState } from '../hooks/useMouseLook';
import { sampleLocalMut } from '../hooks/interpolation';
import { revealIndexAt } from '../hooks/reveal';

const TICK_MS = 1000 / DEFAULT_SIM_CONFIG.tickHz;

const EYE_HEIGHT = 1.5; // = SimConfig.eyeHeight (origen del rayo de captura)
const TP_DIST = 5.5; // distancia de la cámara en tercera persona
const TP_HEIGHT = 3.0;
const OVERVIEW = new THREE.Vector3(0, 46, 38); // vista aérea (lobby/ended; casa 80×64)
const FOV_FPP = 75; // primera persona (Seeker en Hunt): campo amplio para escanear
const FOV_TP = 60; // tercera persona / vistas generales
const REVEAL_RADIUS = 4.5; // órbita del tour de revelado (V1-F)
const REVEAL_HEIGHT = 2.6;

const _target = new THREE.Vector3();
const _desired = new THREE.Vector3();
const _lookDir = new THREE.Vector3();
const _lp = new THREE.Vector3(); // pos local SUAVIZADA entre ticks (sin temblor)

const CAM_PAD = 0.45; // separación cámara↔muro
const CAM_MIN_H = 0.6; // distancia horizontal mínima al avatar
const CAM_SIDE = 0.3; // semiancho de la cámara (rayos laterales paralelos)
const CAM_LOW_Y = 2.65; // con un muro detrás la cámara baja del borde del muro (3 m)
const CAM_IN_RATE = 14; // 1/s — acercarse (rápido: no atravesar el muro)
const CAM_OUT_RATE = 3.5; // 1/s — alejarse (lento: sin tirones al liberar)
const CAM_Y_RATE = 6; // 1/s — cambio de altura

// Estado SUAVIZADO de la cámara en tercera persona (persistente entre frames).
let _camH = TP_DIST;
let _camY = TP_HEIGHT;

/**
 * Espacio libre HORIZONTAL detrás del avatar (playtest r5/r6). Tres rayos
 * paralelos (centro ± CAM_SIDE) contra los AABB de los MUROS del mapa compartido;
 * los muros se tratan como infinitamente altos, así la cámara se queda siempre
 * DENTRO del cuarto. Devuelve la distancia utilizable (≤ TP_DIST). Sin
 * asignaciones: ~200 muros × 3 rayAABB por frame.
 *
 * La v1 recortaba la posición YA interpolada y además subía la cámara por encima
 * del muro: cada frame cambiaba la dirección del rayo ⇒ SALTOS, y la cornisa del
 * muro llenaba media pantalla. Ahora el recorte depende solo del yaw y el
 * resultado se filtra en el tiempo.
 */
function freeSpaceBehind(map: MapData, x: number, z: number, bx: number, bz: number): number {
  let best = TP_DIST + CAM_PAD;
  const zones = map.zones;
  for (let i = 0; i < zones.length; i++) {
    const zn = zones[i]!;
    if (zn.kind !== 'wall') continue;
    for (let k = -1; k <= 1; k++) {
      // Desplazamiento lateral: perpendicular a (bx,bz) en el plano XZ.
      const t = rayAABB(
        x - bz * CAM_SIDE * k, 1.5, z + bx * CAM_SIDE * k, bx, 0, bz,
        zn.minX, -1, zn.minZ,
        zn.maxX, 99, zn.maxZ,
      );
      if (t !== null && t < best) best = t;
    }
  }
  return Math.max(CAM_MIN_H, Math.min(TP_DIST, best - CAM_PAD));
}

export function CameraRig() {
  const camera = useThree((s) => s.camera);
  // SOLO dev: expone la cámara para medir saltos en los E2E headless.
  if (import.meta.env.DEV) (window as unknown as Record<string, unknown>).__cam = camera;
  useFrame((_, delta) => {
    const st = worldStore.getState();
    // La cámara sigue la MISMA pos suavizada que dibuja MechaMesh (sim a 30 Hz,
    // render a 60+): sin esto el mundo/avatar "tiembla" al caminar.
    sampleLocalMut(st.localPrevPos, st.local.pos, st.localPredAt, performance.now(), TICK_MS, _lp);
    const lp = _lp;
    const phase = st.phase;
    const isSeeker = st.local.role === 'seeker';

    // FOV por modo (75° FPP / 60° resto). Solo recalcula la proyección DURANTE la
    // transición de fase/rol (~0.5 s) — nunca en régimen (skill r3f-rendering).
    const fov = isSeeker && phase === 'hunt' ? FOV_FPP : FOV_TP;
    const persp = camera as THREE.PerspectiveCamera;
    if (persp.isPerspectiveCamera && persp.fov !== fov) {
      // Transición suave (antes saltaba 60°→75° de golpe al empezar la caza).
      const next = persp.fov + (fov - persp.fov) * Math.min(1, delta * 7);
      persp.fov = Math.abs(fov - next) < 0.05 ? fov : next;
      persp.updateProjectionMatrix();
    }

    if (isSeeker && phase === 'hunt') {
      // ── Primera persona: cámara EN los ojos, sin suavizado (respuesta 1:1). ──
      camera.position.set(lp.x, lp.y + EYE_HEIGHT, lp.z);
      const cosP = Math.cos(lookState.pitch);
      _lookDir.set(
        -Math.sin(lookState.yaw) * cosP,
        Math.sin(lookState.pitch),
        -Math.cos(lookState.yaw) * cosP,
      );
      _target.copy(camera.position).add(_lookDir);
      camera.lookAt(_target);
      return;
    }

    if (phase === 'prep' || phase === 'hunt') {
      // ── Tercera persona orbitando por el yaw (el pitch eleva un poco la vista). ──
      const fx = -Math.sin(lookState.yaw);
      const fz = -Math.cos(lookState.yaw);
      const lift = TP_HEIGHT - lookState.pitch * 2; // mirar arriba baja la cámara y viceversa
      // Distancia y altura FILTRADAS: entra rápido, sale despacio, nunca de golpe.
      const dt = Math.min(delta, 0.1);
      const freeH = freeSpaceBehind(st.map, lp.x, lp.z, -fx, -fz);
      _camH += (freeH - _camH) * Math.min(1, dt * (freeH < _camH ? CAM_IN_RATE : CAM_OUT_RATE));
      // Con algo detrás, la cámara se queda bajo el borde del muro (dentro del cuarto).
      const wantY = freeH < TP_DIST - 0.05 ? Math.min(lift, CAM_LOW_Y) : lift;
      _camY += (wantY - _camY) * Math.min(1, dt * CAM_Y_RATE);
      _target.set(lp.x, lp.y + 1.2, lp.z);
      _desired.set(lp.x - fx * _camH, lp.y + _camY, lp.z - fz * _camH);
      camera.position.lerp(_desired, 1 - Math.pow(0.000001, delta));
      camera.lookAt(_target);
      return;
    }

    // ── ENDED con tour de revelado (V1-F, answer-check): la cámara ORBITA el
    //    escondite de cada Hider (atrapados primero, supervivientes al final). ──
    if (phase === 'ended' && st.revealList && st.endedAt !== null) {
      const elapsed = (performance.now() - st.endedAt) / 1000;
      const idx = revealIndexAt(elapsed, st.revealList.length);
      if (idx >= 0) {
        const entry = st.revealList[idx]!;
        const angle = elapsed * 0.7; // órbita lenta continua
        _target.set(entry.x, 0.9, entry.z);
        _desired.set(
          entry.x + Math.sin(angle) * REVEAL_RADIUS,
          entry.y + REVEAL_HEIGHT,
          entry.z + Math.cos(angle) * REVEAL_RADIUS,
        );
        camera.position.lerp(_desired, 1 - Math.pow(0.0000001, delta)); // viaje rápido + órbita suave
        camera.lookAt(_target);
        return;
      }
    }

    // ── Lobby / Ended (tras el tour): vista aérea-trasera con suavizado. ──
    _target.set(lp.x, lp.y + 1, lp.z);
    _desired.copy(_target).add(OVERVIEW);
    camera.position.lerp(_desired, 1 - Math.pow(0.0015, delta));
    camera.lookAt(_target);
  });
  return null;
}

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
import { worldStore } from '../store/worldStore';
import { lookState } from '../hooks/useMouseLook';

const EYE_HEIGHT = 1.5; // = SimConfig.eyeHeight (origen del rayo de captura)
const TP_DIST = 5.5; // distancia de la cámara en tercera persona
const TP_HEIGHT = 3.0;
const OVERVIEW = new THREE.Vector3(0, 12, 12); // vista aérea (lobby/ended)

const _target = new THREE.Vector3();
const _desired = new THREE.Vector3();
const _lookDir = new THREE.Vector3();

export function CameraRig() {
  const camera = useThree((s) => s.camera);
  useFrame((_, delta) => {
    const st = worldStore.getState();
    const lp = st.local.pos;
    const phase = st.phase;
    const isSeeker = st.local.role === 'seeker';

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
      _target.set(lp.x, lp.y + 1.2, lp.z);
      _desired.set(lp.x - fx * TP_DIST, lp.y + lift, lp.z - fz * TP_DIST);
      camera.position.lerp(_desired, 1 - Math.pow(0.000001, delta));
      camera.lookAt(_target);
      return;
    }

    // ── Lobby / Ended: vista aérea-trasera con suavizado. ──
    _target.set(lp.x, lp.y + 1, lp.z);
    _desired.copy(_target).add(OVERVIEW);
    camera.position.lerp(_desired, 1 - Math.pow(0.0015, delta));
    camera.lookAt(_target);
  });
  return null;
}

/**
 * Players — render de TODOS los avatares con UN `InstancedMesh` POR POSE (V1-B):
 * de pie (cápsula), agachado (cápsula baja), bola (esfera) y plano-pared (panel).
 * 4 draw calls como máximo; cada jugador se escribe en la malla de su pose y se
 * ORIENTA por su yaw (derivado del apunte) — girar para encajar contra un prop.
 *
 * El jugador local NO se dibuja cuando está en primera persona (Seeker en HUNT):
 * la cámara está dentro de su cuerpo.
 *
 * Skill `r3f-rendering`: cero `setState` por frame; en `useFrame` se MUTAN matrices/
 * colores de instancia leyendo `worldStore` vía `getState()`; geometrías y material
 * memoizados; scratch de módulo (sin asignar por frame). El local usa su posición
 * PREDICHA; los remotos se INTERPOLAN en el pasado.
 */
import { useRef, useMemo } from 'react';
import * as THREE from 'three';
import { useFrame } from '@react-three/fiber';
import { POSE_COUNT } from '@mecha/sim';
import { worldStore } from '../store/worldStore';
import { sampleRemote, INTERP_DELAY_MS } from '../hooks/interpolation';

const MAX_PLAYERS = 16;

// Media altura visual por pose (el origen de la geometría está en su centro).
const POSE_HALF_H: readonly number[] = [0.85, 0.57, 0.55, 0.75];

// Scratch de ámbito de módulo: el render es monohilo y `useFrame` es síncrono.
const _obj = new THREE.Object3D();
const _color = new THREE.Color();
const _counts = new Int32Array(POSE_COUNT);

export function Players() {
  const refs = useRef<Array<THREE.InstancedMesh | null>>([null, null, null, null]);

  const geometries = useMemo(
    () => [
      new THREE.CapsuleGeometry(0.4, 0.9, 4, 8), // de pie (~1.7 de alto)
      new THREE.CapsuleGeometry(0.42, 0.3, 4, 8), // agachado (~1.14)
      new THREE.SphereGeometry(0.55, 12, 10), // bola
      new THREE.BoxGeometry(0.9, 1.5, 0.28), // plano contra la pared
    ],
    [],
  );
  const material = useMemo(() => new THREE.MeshStandardMaterial({ roughness: 0.8 }), []);

  useFrame(() => {
    const meshes = refs.current;
    const st = worldStore.getState();
    const renderTime = performance.now() - INTERP_DELAY_MS;
    _counts.fill(0);

    const writeAvatar = (
      pose: number,
      x: number,
      y: number,
      z: number,
      aimX: number,
      aimZ: number,
      colorHex: number,
    ): void => {
      const pi = pose & 3;
      const mesh = meshes[pi];
      if (!mesh || _counts[pi]! >= MAX_PLAYERS) return;
      const i = _counts[pi]!;
      _obj.position.set(x, y + POSE_HALF_H[pi]!, z);
      _obj.rotation.y = Math.atan2(aimX, aimZ); // orientado por el apunte (yaw)
      _obj.updateMatrix();
      mesh.setMatrixAt(i, _obj.matrix);
      _color.setHex(colorHex, THREE.SRGBColorSpace);
      mesh.setColorAt(i, _color);
      _counts[pi] = i + 1;
    };

    // Jugador local: posición PREDICHA. Oculto en primera persona (Seeker en Hunt).
    const fpp = st.local.role === 'seeker' && st.phase === 'hunt';
    if (!fpp) {
      const lc = st.local.color;
      writeAvatar(
        st.local.pose,
        st.local.pos.x,
        st.local.pos.y,
        st.local.pos.z,
        st.local.aimX,
        st.local.aimZ,
        ((lc.r & 0xff) << 16) | ((lc.g & 0xff) << 8) | (lc.b & 0xff),
      );
    }

    // Remotos: INTERPOLADOS en el pasado (suave entre ticks de red).
    for (const e of st.remotes.values()) {
      sampleRemote(e.buffer, renderTime, e.render);
      writeAvatar(
        e.pose,
        e.render.x,
        e.render.y,
        e.render.z,
        e.aimX,
        e.aimZ,
        (e.colorPacked >>> 8) & 0xffffff,
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

/**
 * ShotTracers — feedback VISUAL del disparo (solo presentación, V1): al disparar, un
 * trazador luminoso sale de la cámara hacia donde apuntas y se desvanece en ~130 ms.
 * El impacto REAL lo resuelve el servidor; esto solo hace visible la acción
 * (feedback del playtest: "cuando se dispara debería verse alguna acción").
 *
 * `signalLocalShot()` lo llama el input al enviar un CATCH; el componente consume la
 * señal en `useFrame` y ocupa un slot de un POOL fijo de mallas (cilindros finos).
 *
 * Skill `r3f-rendering`: pool pre-asignado, mutación de refs en useFrame, cero
 * `setState`, scratch de módulo, materiales/geometrías compartidos.
 */
import { useMemo, useRef } from 'react';
import * as THREE from 'three';
import { useFrame, useThree } from '@react-three/fiber';
import { DEFAULT_SIM_CONFIG } from '@mecha/sim';

const POOL_SIZE = 3;
const LIFE_MS = 130;
const MAX_LEN = DEFAULT_SIM_CONFIG.catchRange; // el trazador mide lo que alcanza el arma

// Señal de módulo: disparos locales pendientes de visualizar.
let _pendingShots = 0;
export function signalLocalShot(): void {
  _pendingShots++;
}

const _raycaster = new THREE.Raycaster();
const _dir = new THREE.Vector3();
const _from = new THREE.Vector3();
const _end = new THREE.Vector3();

interface TracerSlot {
  bornAt: number; // ms; 0 = libre
}

export function ShotTracers() {
  const camera = useThree((s) => s.camera);
  const scene = useThree((s) => s.scene);
  const refs = useRef<Array<THREE.Mesh | null>>(new Array<THREE.Mesh | null>(POOL_SIZE).fill(null));
  const slots = useRef<TracerSlot[]>(
    Array.from({ length: POOL_SIZE }, () => ({ bornAt: 0 })),
  );

  const geometry = useMemo(() => {
    const g = new THREE.CylinderGeometry(0.025, 0.025, 1, 6);
    g.rotateX(Math.PI / 2); // alinear el eje del cilindro con +Z (dirección del tiro)
    return g;
  }, []);
  // Un material POR SLOT (3): la opacidad de cada trazador se desvanece por separado.
  const materials = useMemo(
    () =>
      Array.from(
        { length: POOL_SIZE },
        () =>
          new THREE.MeshBasicMaterial({
            color: '#ffd25e',
            transparent: true,
            opacity: 0.9,
            depthWrite: false,
          }),
      ),
    [],
  );

  useFrame(() => {
    const now = performance.now();

    // Spawnear los disparos señalados (rara vez: cooldown ~0.6 s).
    while (_pendingShots > 0) {
      _pendingShots--;
      const idx = slots.current.findIndex((s) => s.bornAt === 0);
      if (idx < 0) break;
      const mesh = refs.current[idx];
      if (!mesh) break;

      camera.getWorldDirection(_dir);
      _from.copy(camera.position).addScaledVector(_dir, 0.4); // fuera del near plane
      // Punto final VISUAL: primer obstáculo de la escena (no atravesar muros a la vista).
      _raycaster.set(camera.position, _dir);
      _raycaster.far = MAX_LEN;
      const hits = _raycaster.intersectObjects(scene.children, true);
      const hit = hits.find((h) => !(h.object.userData?.isTracer as boolean | undefined));
      // Longitud desde el ARRANQUE del trazador (0.4 tras la cámara): si el obstáculo
      // está a quemarropa (antes del arranque), no se dibuja trazador (el tiro existe).
      const len = Math.min(hit ? hit.distance : MAX_LEN, MAX_LEN) - 0.45;
      if (len < 0.1) continue;

      _end.copy(_from).addScaledVector(_dir, len);
      mesh.position.copy(_from).addScaledVector(_dir, len / 2);
      mesh.lookAt(_end);
      mesh.scale.set(1, 1, len);
      materials[idx]!.opacity = 0.9; // reset del fade del uso anterior del slot
      mesh.visible = true;
      slots.current[idx]!.bornAt = now;
    }

    // Animar/expirar los activos: fade de opacidad por slot hasta desaparecer.
    for (let i = 0; i < POOL_SIZE; i++) {
      const slot = slots.current[i]!;
      if (slot.bornAt === 0) continue;
      const mesh = refs.current[i];
      if (!mesh) continue;
      const age = now - slot.bornAt;
      if (age >= LIFE_MS) {
        slot.bornAt = 0;
        mesh.visible = false;
      } else {
        materials[i]!.opacity = 0.9 * (1 - age / LIFE_MS);
      }
    }
  });

  return (
    <>
      {Array.from({ length: POOL_SIZE }, (_, i) => (
        <mesh
          key={i}
          ref={(m) => {
            refs.current[i] = m;
          }}
          geometry={geometry}
          material={materials[i]!}
          visible={false}
          frustumCulled={false}
          userData={{ isTracer: true }}
        />
      ))}
    </>
  );
}

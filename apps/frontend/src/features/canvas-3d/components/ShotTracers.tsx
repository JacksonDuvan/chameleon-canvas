/**
 * ShotTracers — feedback VISUAL del disparo (solo presentación, V1): al disparar, un
 * trazador luminoso sale de la BOCA DEL ARMA hacia el punto al que apuntas, con un
 * fogonazo en el cañón y una salpicadura de pintura en el impacto.
 * El impacto REAL lo resuelve el servidor; esto solo hace visible la acción
 * (feedback del playtest: "cuando se dispara debería verse alguna acción").
 *
 * Playtest r5: el trazador salía del CENTRO de la cámara, así que se veía de punta
 * como un hexágono tapando la mira. Ahora nace en el cañón del viewmodel
 * (`MUZZLE_OFFSET`, misma esquina que `SeekerViewmodel`) y converge al punto de mira.
 *
 * `signalLocalShot()` lo llama el input al enviar un CATCH; el componente consume la
 * señal en `useFrame` y ocupa un slot de un POOL fijo de mallas.
 *
 * Skill `r3f-rendering`: pool pre-asignado, mutación de refs en useFrame, cero
 * `setState`, scratch de módulo, materiales/geometrías compartidos.
 */
import { useMemo, useRef } from 'react';
import * as THREE from 'three';
import { useFrame, useThree } from '@react-three/fiber';
import { DEFAULT_SIM_CONFIG } from '@mecha/sim';

const POOL_SIZE = 3;
const LIFE_MS = 150; // trazador
const FLASH_MS = 70; // fogonazo
const SPLAT_MS = 320; // salpicadura de impacto
const MAX_LEN = DEFAULT_SIM_CONFIG.catchRange; // el trazador mide lo que alcanza el arma

/** Boca del cañón en espacio de CÁMARA (derecha, abajo, al frente). Compartido con
 *  `SeekerViewmodel` para que el trazador nazca exactamente en el arma. */
export const MUZZLE_OFFSET = { x: 0.3, y: -0.24, z: -0.95 } as const;

// Señal de módulo: disparos locales pendientes de visualizar.
let _pendingShots = 0;
let _lastShotAt = -Infinity;
export function signalLocalShot(): void {
  _pendingShots++;
  _lastShotAt = performance.now();
}
/** ms (performance.now) del último disparo local — lo lee el retroceso del arma. */
export function lastLocalShotAt(): number {
  return _lastShotAt;
}

const _raycaster = new THREE.Raycaster();
const _dir = new THREE.Vector3();
const _from = new THREE.Vector3();
const _end = new THREE.Vector3();
const _seg = new THREE.Vector3();

interface TracerSlot {
  bornAt: number; // ms; 0 = libre
  hit: boolean; // ¿hay superficie de impacto? (si no, sin salpicadura)
}

export function ShotTracers() {
  const camera = useThree((s) => s.camera);
  const scene = useThree((s) => s.scene);
  const tracers = useRef<Array<THREE.Mesh | null>>(new Array<THREE.Mesh | null>(POOL_SIZE).fill(null));
  const flashes = useRef<Array<THREE.Mesh | null>>(new Array<THREE.Mesh | null>(POOL_SIZE).fill(null));
  const splats = useRef<Array<THREE.Mesh | null>>(new Array<THREE.Mesh | null>(POOL_SIZE).fill(null));
  const slots = useRef<TracerSlot[]>(
    Array.from({ length: POOL_SIZE }, () => ({ bornAt: 0, hit: false })),
  );

  const { tracerGeo, blobGeo } = useMemo(() => {
    const g = new THREE.CylinderGeometry(0.018, 0.03, 1, 6);
    g.rotateX(Math.PI / 2); // alinear el eje del cilindro con +Z (dirección del tiro)
    return { tracerGeo: g, blobGeo: new THREE.IcosahedronGeometry(1, 1) };
  }, []);
  // Un material POR SLOT y efecto: cada uno se desvanece por separado.
  const mats = useMemo(() => {
    const mk = (color: string): THREE.MeshBasicMaterial[] =>
      Array.from(
        { length: POOL_SIZE },
        () => new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0, depthWrite: false }),
      );
    return { tracer: mk('#ffd25e'), flash: mk('#fff1b8'), splat: mk('#ffcf4a') };
  }, []);

  useFrame(() => {
    const now = performance.now();

    // Spawnear los disparos señalados (rara vez: cooldown ~0.6 s).
    while (_pendingShots > 0) {
      _pendingShots--;
      const idx = slots.current.findIndex((s) => s.bornAt === 0);
      if (idx < 0) break;
      const tracer = tracers.current[idx];
      const flash = flashes.current[idx];
      const splat = splats.current[idx];
      if (!tracer || !flash || !splat) break;

      camera.getWorldDirection(_dir);
      // Punto final VISUAL: primer obstáculo de la escena (no atravesar muros a la vista).
      _raycaster.set(camera.position, _dir);
      _raycaster.far = MAX_LEN;
      const hits = _raycaster.intersectObjects(scene.children, true);
      // Ni otros efectos NI lo pegado a la cámara / decoración (noSample).
      const hit = hits.find(
        (h) =>
          !(h.object.userData?.isTracer as boolean | undefined) &&
          !(h.object.userData?.noSample as boolean | undefined),
      );
      const reach = hit ? Math.min(hit.distance, MAX_LEN) : MAX_LEN;
      _end.copy(camera.position).addScaledVector(_dir, reach);
      // Origen: la boca del cañón (offset en espacio de cámara → mundo).
      _from.set(MUZZLE_OFFSET.x, MUZZLE_OFFSET.y, MUZZLE_OFFSET.z).applyQuaternion(camera.quaternion).add(camera.position);

      const slot = slots.current[idx]!;
      slot.bornAt = now;
      slot.hit = hit !== undefined;

      flash.position.copy(_from);
      flash.visible = true;

      _seg.subVectors(_end, _from);
      const len = _seg.length();
      // A quemarropa (obstáculo antes del cañón) no hay trazador: solo fogonazo.
      if (len > 0.3 && reach > 1) {
        tracer.position.copy(_from).addScaledVector(_seg, 0.5);
        tracer.lookAt(_end);
        tracer.scale.set(1, 1, len);
        tracer.visible = true;
      } else {
        tracer.visible = false;
      }
      if (slot.hit) {
        // Un pelín hacia la cámara: la salpicadura no queda enterrada en la superficie.
        splat.position.copy(_end).addScaledVector(_dir, -0.06);
        splat.visible = true;
      } else {
        splat.visible = false;
      }
    }

    // Animar/expirar los activos.
    for (let i = 0; i < POOL_SIZE; i++) {
      const slot = slots.current[i]!;
      if (slot.bornAt === 0) continue;
      const tracer = tracers.current[i];
      const flash = flashes.current[i];
      const splat = splats.current[i];
      if (!tracer || !flash || !splat) continue;
      const age = now - slot.bornAt;

      if (age >= LIFE_MS) tracer.visible = false;
      else mats.tracer[i]!.opacity = 0.9 * (1 - age / LIFE_MS);

      if (age >= FLASH_MS) flash.visible = false;
      else {
        const k = age / FLASH_MS;
        flash.scale.setScalar(0.05 + 0.09 * k);
        mats.flash[i]!.opacity = 1 - k;
      }

      if (!slot.hit || age >= SPLAT_MS) splat.visible = false;
      else {
        const k = age / SPLAT_MS;
        const e = 1 - (1 - k) * (1 - k); // ease-out: revienta rápido y se asienta
        splat.scale.setScalar(0.06 + 0.3 * e);
        mats.splat[i]!.opacity = 0.85 * (1 - k);
      }

      if (age >= Math.max(LIFE_MS, SPLAT_MS)) slot.bornAt = 0;
    }
  });

  return (
    <>
      {Array.from({ length: POOL_SIZE }, (_, i) => (
        <group key={i}>
          <mesh
            ref={(m) => {
              tracers.current[i] = m;
            }}
            geometry={tracerGeo}
            material={mats.tracer[i]!}
            visible={false}
            frustumCulled={false}
            userData={{ isTracer: true }}
          />
          <mesh
            ref={(m) => {
              flashes.current[i] = m;
            }}
            geometry={blobGeo}
            material={mats.flash[i]!}
            visible={false}
            frustumCulled={false}
            userData={{ isTracer: true }}
          />
          <mesh
            ref={(m) => {
              splats.current[i] = m;
            }}
            geometry={blobGeo}
            material={mats.splat[i]!}
            visible={false}
            frustumCulled={false}
            userData={{ isTracer: true }}
          />
        </group>
      ))}
    </>
  );
}

/**
 * SeekerViewmodel — el ARMA en primera persona del Seeker (V1-G v2, fiel a las
 * capturas del original: el blaster asoma por la esquina inferior derecha).
 * Solo presentación: el disparo real es un comando de input que resuelve el servidor.
 *
 * Sin `createPortal` a la cámara: un grupo en la raíz copia posición+orientación de
 * la cámara cada frame (funciona aunque la cámara no cuelgue del grafo de escena) y
 * el arma vive como hijo con offset local fijo.
 *
 * Skill `r3f-rendering`: mutación de refs en `useFrame`, geometrías/materiales
 * memoizados, cero setState. `userData.noSample`: ni el cuentagotas ni el trazador
 * deben "ver" el arma (está pegada a la cámara).
 */
import { useMemo, useRef } from 'react';
import * as THREE from 'three';
import { useFrame, useThree } from '@react-three/fiber';
import { worldStore } from '../store/worldStore';
import { lastLocalShotAt } from './ShotTracers';

const RECOIL_MS = 170; // duración del retroceso tras cada disparo
const REST = { x: 0.36, y: -0.3, z: -0.6 } as const; // esquina inferior derecha

const NO_SAMPLE = { noSample: true };
/** El arma se dibuja DESPUÉS del mundo y con el depth limpio: pegado a un muro,
 *  el cañón ya no se "mete" en la pared (playtest r5). */
const GUN_ORDER = 11;
const _clearDepth = (renderer: THREE.WebGLRenderer): void => renderer.clearDepth();

export function SeekerViewmodel() {
  const camera = useThree((s) => s.camera);
  const group = useRef<THREE.Group>(null!);
  const gun = useRef<THREE.Group>(null!);
  const sway = useRef({ phase: 0, amp: 0, px: 0, pz: 0 });

  const { bodyGeo, barrelGeo, gripGeo, dark, accent, clearGeo, clearMat } = useMemo(
    () => ({
      clearGeo: new THREE.PlaneGeometry(0.001, 0.001),
      clearMat: new THREE.MeshBasicMaterial({ colorWrite: false, depthWrite: false, depthTest: false }),
      bodyGeo: new THREE.BoxGeometry(0.09, 0.11, 0.34),
      barrelGeo: new THREE.CylinderGeometry(0.028, 0.028, 0.26, 10),
      gripGeo: new THREE.BoxGeometry(0.07, 0.16, 0.09),
      dark: new THREE.MeshStandardMaterial({ color: '#5a6570', roughness: 0.5, metalness: 0.3 }),
      accent: new THREE.MeshStandardMaterial({ color: '#ffd54a', roughness: 0.5, metalness: 0.2 }),
    }),
    [],
  );

  useFrame((_, delta) => {
    const g = group.current;
    if (!g) return;
    const st = worldStore.getState();
    g.visible = st.local.role === 'seeker' && st.phase === 'hunt' && !st.local.caught;
    if (!g.visible) return;
    g.position.copy(camera.position);
    g.quaternion.copy(camera.quaternion);

    const w = gun.current;
    if (!w) return;
    // Balanceo al caminar: amplitud ≈ velocidad de la cámara (solo presentación).
    const s = sway.current;
    const dt = Math.min(delta, 0.1);
    const speed = dt > 0 ? Math.hypot(camera.position.x - s.px, camera.position.z - s.pz) / dt : 0;
    s.px = camera.position.x;
    s.pz = camera.position.z;
    s.amp += (Math.min(1, speed / 6) - s.amp) * Math.min(1, dt * 10);
    s.phase += dt * 9 * s.amp;
    // Retroceso: patada hacia atrás/arriba que decae (ease-out) tras el disparo.
    const age = performance.now() - lastLocalShotAt();
    const k = age < RECOIL_MS ? 1 - age / RECOIL_MS : 0;
    const kick = k * k;
    w.position.set(
      REST.x + Math.sin(s.phase) * 0.012 * s.amp,
      REST.y + Math.abs(Math.cos(s.phase)) * 0.014 * s.amp + kick * 0.02,
      REST.z + kick * 0.09,
    );
    w.rotation.set(kick * 0.22, -0.06, 0);
  });

  return (
    <group ref={group} visible={false}>
      {/* Offset local: esquina inferior derecha, apuntando al frente (-Z local). */}
      <group ref={gun} position={[REST.x, REST.y, REST.z]} rotation={[0, -0.06, 0]} scale={0.85}>
        {/* Malla invisible que limpia el depth justo antes de las piezas del arma. */}
        <mesh
          geometry={clearGeo}
          material={clearMat}
          renderOrder={GUN_ORDER - 1}
          frustumCulled={false}
          onBeforeRender={_clearDepth}
          userData={NO_SAMPLE}
        />
        <mesh geometry={bodyGeo} material={dark} renderOrder={GUN_ORDER} userData={NO_SAMPLE} />
        <mesh
          geometry={barrelGeo}
          material={accent}
          rotation-x={Math.PI / 2}
          position={[0, 0.015, -0.27]}
          renderOrder={GUN_ORDER}
          userData={NO_SAMPLE}
        />
        <mesh geometry={gripGeo} material={dark} position={[0, -0.12, 0.09]} rotation-x={0.25} renderOrder={GUN_ORDER} userData={NO_SAMPLE} />
      </group>
    </group>
  );
}

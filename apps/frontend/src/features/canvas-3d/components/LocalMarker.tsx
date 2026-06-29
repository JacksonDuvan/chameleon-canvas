/**
 * LocalMarker — flecha flotante sobre el avatar del jugador local ("tú"). Refuerza la
 * claridad junto con `CameraRig`: aunque varias cápsulas se solapen, sabes cuál eres.
 *
 * Skill `r3f-rendering`: muta el `ref` dentro de `useFrame` leyendo el store con
 * `getState()`; geometría/material memoizados (compartidos, sin recrear por frame);
 * cero asignaciones por frame.
 */
import { useRef, useMemo } from 'react';
import * as THREE from 'three';
import { useFrame } from '@react-three/fiber';
import { worldStore } from '../store/worldStore';

export function LocalMarker() {
  const ref = useRef<THREE.Mesh>(null!);
  const geometry = useMemo(() => new THREE.ConeGeometry(0.28, 0.55, 8), []);
  const material = useMemo(
    () => new THREE.MeshStandardMaterial({ color: '#ffd54a', emissive: '#7a5b00', roughness: 0.4 }),
    [],
  );

  useFrame((state) => {
    const m = ref.current;
    if (!m) return;
    const lp = worldStore.getState().local.pos;
    const bob = Math.sin(state.clock.elapsedTime * 3) * 0.08;
    m.position.set(lp.x, lp.y + 2.3 + bob, lp.z);
    m.rotation.y = state.clock.elapsedTime * 1.5;
  });

  // Cono invertido (rotación X = π) → apunta hacia abajo, al avatar.
  return <mesh ref={ref} geometry={geometry} material={material} rotation={[Math.PI, 0, 0]} />;
}

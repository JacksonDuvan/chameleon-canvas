/**
 * Environment — el escenario: suelo, luz direccional (clave para el "match de
 * sombras": una sombra mal calculada delata al Hider congelado) y superficies con
 * materiales/colores llamativos (ladrillo, madera…) de los que el Hider absorbe color
 * con el cuentagotas (raycaster).
 *
 * Skill `r3f-rendering`: geometrías y materiales memoizados/compartidos; nada de
 * recrear recursos por render. Estático (no anima): no necesita `useFrame`.
 */
import { useMemo } from 'react';
import * as THREE from 'three';

// Superficies de muestreo del cuentagotas (data-driven; el raycaster lee su color).
const SURFACES: ReadonlyArray<{ pos: [number, number, number]; color: string }> = [
  { pos: [-6, 1, -6], color: '#8a3b2e' }, // ladrillo
  { pos: [6, 1, -6], color: '#6b4a2b' }, // madera
  { pos: [-6, 1, 6], color: '#3f6b3a' }, // musgo
  { pos: [6, 1, 6], color: '#4a5a7a' }, // metal azulado
];

export function Environment() {
  const floorGeo = useMemo(() => new THREE.PlaneGeometry(40, 40), []);
  const floorMat = useMemo(() => new THREE.MeshStandardMaterial({ color: '#cfcabc' }), []);
  const boxGeo = useMemo(() => new THREE.BoxGeometry(2, 2, 2), []);
  // Un material compartido por superficie (color distinto; memoizado, no recreado).
  const surfaceMats = useMemo(
    () => SURFACES.map((s) => new THREE.MeshStandardMaterial({ color: s.color, roughness: 0.9 })),
    [],
  );

  return (
    <>
      <ambientLight intensity={0.4} />
      <directionalLight
        position={[10, 18, 8]}
        intensity={1.1}
        castShadow
        shadow-mapSize-width={1024}
        shadow-mapSize-height={1024}
      />
      <mesh
        geometry={floorGeo}
        material={floorMat}
        rotation-x={-Math.PI / 2}
        receiveShadow
      />
      {SURFACES.map((s, i) => {
        const mat = surfaceMats[i];
        return mat ? (
          <mesh key={i} geometry={boxGeo} material={mat} position={s.pos} castShadow receiveShadow />
        ) : null;
      })}
    </>
  );
}

/**
 * Environment — el escenario. Renderiza el mapa desde la ÚNICA fuente de verdad
 * compartida `DEFAULT_MAP` de `@mecha/sim` (P0.1): mismas zonas y colores que usa el
 * servidor para razonar sobre camuflaje. Suelo por zonas de colores distintos + props
 * y muros de los que el Hider absorbe color con el cuentagotas (raycaster).
 *
 * Cada malla lleva `userData.refColor` (color de referencia empaquetado 0xRRGGBBAA):
 * el cuentagotas (P0.2) leerá ese valor exacto, evitando la deriva sRGB↔lineal de
 * `material.color`, de modo que "color absorbido == color de referencia" al puntuar.
 *
 * Skill `r3f-rendering`: geometrías y materiales memoizados/compartidos (una sola vez);
 * estático, sin `useFrame`. La luz direccional prepara el "match de sombras" (P1.2).
 */
import { useMemo } from 'react';
import * as THREE from 'three';
import { DEFAULT_MAP } from '@mecha/sim';

/** Color empaquetado 0xRRGGBBAA → THREE.Color (interpretado en sRGB). */
function toColor(packed: number): THREE.Color {
  return new THREE.Color().setHex((packed >>> 8) & 0xffffff, THREE.SRGBColorSpace);
}

interface BuiltZone {
  readonly id: string;
  readonly geometry: THREE.BufferGeometry;
  readonly material: THREE.Material;
  readonly position: [number, number, number];
  readonly isFloor: boolean;
  readonly refColor: number;
}

export function Environment() {
  const { baseGeo, baseMat, baseRef, built } = useMemo(() => {
    const b = DEFAULT_MAP.bounds;
    const baseGeo = new THREE.PlaneGeometry(b.maxX - b.minX, b.maxZ - b.minZ);
    const baseMat = new THREE.MeshStandardMaterial({
      color: toColor(DEFAULT_MAP.floorColor),
      roughness: 1,
    });
    const built: BuiltZone[] = DEFAULT_MAP.zones.map((z) => {
      const w = z.maxX - z.minX;
      const d = z.maxZ - z.minZ;
      const cx = (z.minX + z.maxX) / 2;
      const cz = (z.minZ + z.maxZ) / 2;
      const material = new THREE.MeshStandardMaterial({
        color: toColor(z.color),
        roughness: z.roughness,
        metalness: z.metalness,
      });
      const isFloor = z.kind === 'floor';
      // Forma visual del prop: caja, cilindro (barriles/jardineras) o esfera (bolas).
      // La colisión/oclusión del sim usa el AABB — aproximación aceptada.
      let geometry: THREE.BufferGeometry;
      if (isFloor) geometry = new THREE.PlaneGeometry(w, d);
      else if (z.shape === 'cylinder')
        geometry = new THREE.CylinderGeometry(Math.min(w, d) / 2, Math.min(w, d) / 2, z.height, 14);
      else if (z.shape === 'sphere')
        geometry = new THREE.SphereGeometry(Math.min(w, d, z.height) / 2, 14, 12);
      else geometry = new THREE.BoxGeometry(w, z.height, d);
      return {
        id: z.id,
        geometry,
        material,
        position: [cx, z.y, cz] as [number, number, number],
        isFloor,
        refColor: z.color,
      };
    });
    return { baseGeo, baseMat, baseRef: DEFAULT_MAP.floorColor, built };
  }, []);

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
      {/* Suelo base (fallback de color de referencia). */}
      <mesh
        geometry={baseGeo}
        material={baseMat}
        rotation-x={-Math.PI / 2}
        receiveShadow
        userData={{ refColor: baseRef }}
      />
      {built.map((z) =>
        z.isFloor ? (
          <mesh
            key={z.id}
            geometry={z.geometry}
            material={z.material}
            position={z.position}
            rotation-x={-Math.PI / 2}
            receiveShadow
            userData={{ refColor: z.refColor }}
          />
        ) : (
          <mesh
            key={z.id}
            geometry={z.geometry}
            material={z.material}
            position={z.position}
            castShadow
            receiveShadow
            userData={{ refColor: z.refColor }}
          />
        ),
      )}
    </>
  );
}

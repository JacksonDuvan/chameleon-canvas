/**
 * Environment — el escenario. Renderiza el mapa desde la ÚNICA fuente de verdad
 * compartida `DEFAULT_MAP` de `@mecha/sim` (P0.1): mismas zonas y colores que usa el
 * servidor para razonar sobre camuflaje. El mapa sigue siendo DATO; el render es libre
 * (V1-G): cielo + sol cálido + sombras suaves PCSS + materiales flat-shading low-poly.
 *
 * Cada malla JUGABLE lleva `userData.refColor` (color de referencia 0xRRGGBBAA): el
 * cuentagotas (P0.2) lee ese valor exacto, evitando la deriva sRGB↔lineal de
 * `material.color`, de modo que "color absorbido == color de referencia" al puntuar.
 * La decoración de horizonte (colinas/suelo exterior, INALCANZABLE, fuera de los muros)
 * lleva `userData.noSample`: el cuentagotas la ignora — no existe para el servidor.
 *
 * Skill `r3f-rendering`: geometrías y materiales memoizados/compartidos (una sola vez);
 * estático, sin `useFrame`. La luz direccional prepara el "match de sombras" (P1.2).
 */
import { useEffect, useMemo } from 'react';
import { useStore } from 'zustand';
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { Sky, SoftShadows } from '@react-three/drei';
import { POSE_FLAT, POSE_STAND } from '@mecha/sim';
import { worldStore } from '../store/worldStore';
import { buildPoseGeometries, SPHERE_SEGS_W, SPHERE_SEGS_H } from './avatarGeometry';

/** Roughness de los avatares (`MechaMesh`): los señuelos-muñeco y las bolas lo COMPARTEN
 *  para que un jugador pintado junto a ellos no se delate por el brillo. */
const AVATAR_ROUGHNESS = 0.8;

/** Dirección del sol: compartida por el cielo y la luz direccional (sombras coherentes). */
const SUN_POSITION: [number, number, number] = [14, 20, 8];

/** Color empaquetado 0xRRGGBBAA → THREE.Color (interpretado en sRGB). */
function toColor(packed: number): THREE.Color {
  return new THREE.Color().setHex((packed >>> 8) & 0xffffff, THREE.SRGBColorSpace);
}

interface BuiltZone {
  readonly id: string;
  readonly geometry: THREE.BufferGeometry;
  readonly material: THREE.Material;
  readonly position: [number, number, number];
  readonly rotationY: number;
  readonly isFloor: boolean;
  readonly refColor: number;
}

/** Colinas low-poly del horizonte (decoración pura, fuera del recinto jugable). */
interface Hill {
  readonly x: number;
  readonly z: number;
  readonly r: number;
  readonly h: number;
  readonly mat: number; // índice en HILL_COLORS
}
const HILL_COLORS = ['#6f8f6a', '#5f7f68', '#7d9a72'] as const;
const HILLS: readonly Hill[] = [
  { x: -52, z: -30, r: 16, h: 11, mat: 0 },
  { x: -34, z: -55, r: 12, h: 8, mat: 1 },
  { x: 8, z: -62, r: 18, h: 13, mat: 2 },
  { x: 48, z: -40, r: 13, h: 9, mat: 0 },
  { x: 62, z: 2, r: 17, h: 12, mat: 1 },
  { x: 45, z: 45, r: 12, h: 8, mat: 2 },
  { x: 6, z: 60, r: 16, h: 10, mat: 0 },
  { x: -40, z: 50, r: 14, h: 10, mat: 2 },
  { x: -63, z: 12, r: 18, h: 13, mat: 1 },
];

export function Environment() {
  // Mapa ALEATORIO por ronda: se regenera cuando cambia `mapSeed` (selector reactivo;
  // es estado LENTO, cambia una vez por ronda → re-render puntual permitido, regla 4).
  const map = useStore(worldStore, (s) => s.map);
  const memo = useMemo(() => {
    const b = map.bounds;
    const baseGeo = new THREE.PlaneGeometry(b.maxX - b.minX, b.maxZ - b.minZ);
    const baseMat = new THREE.MeshStandardMaterial({
      color: toColor(map.floorColor),
      roughness: 1,
    });
    // Geometrías del avatar COMPARTIDAS con los señuelos del mapa: 'figure' = pose de
    // pie, 'figureWall' = pose plana (galleta). Mismo muñeco ⇒ mimetismo real.
    const poseGeos = buildPoseGeometries();
    const figureGeo = poseGeos[POSE_STAND]!;
    const cookieGeo = poseGeos[POSE_FLAT]!;
    const built: BuiltZone[] = map.zones.map((z) => {
      const w = z.maxX - z.minX;
      const d = z.maxZ - z.minZ;
      const cx = (z.minX + z.maxX) / 2;
      const cz = (z.minZ + z.maxZ) / 2;
      const isFloor = z.kind === 'floor';
      const isFigure = z.shape === 'figure' || z.shape === 'figureWall';
      const isMimic = isFigure || z.shape === 'sphere';
      const material = new THREE.MeshStandardMaterial({
        color: toColor(z.color),
        // Los señuelos que imitan poses copian el ACABADO del avatar (liso, mismo
        // roughness): que no se delate nadie por el brillo ni el facetado.
        roughness: isMimic ? AVATAR_ROUGHNESS : z.roughness,
        metalness: isMimic ? 0 : z.metalness,
        flatShading: !isFloor && !isMimic, // el facetado solo en la arquitectura
      });
      // Forma visual del prop: caja biselada, cilindro, esfera (MISMA teselación que
      // la pose "bola") o muñeco-señuelo (geometría del avatar, pies en y=0).
      // La colisión/oclusión del sim usa el AABB — aproximación aceptada.
      let geometry: THREE.BufferGeometry;
      let position: [number, number, number] = [cx, z.y, cz];
      if (isFloor) geometry = new THREE.PlaneGeometry(w, d);
      else if (z.shape === 'figure' || z.shape === 'figureWall') {
        geometry = z.shape === 'figure' ? figureGeo : cookieGeo;
        position = [cx, z.y - z.height / 2, cz]; // pies del muñeco en la base de la zona
      } else if (z.shape === 'cylinder')
        geometry = new THREE.CylinderGeometry(Math.min(w, d) / 2, Math.min(w, d) / 2, z.height, 12);
      else if (z.shape === 'sphere')
        geometry = new THREE.SphereGeometry(
          Math.min(w, d, z.height) / 2,
          SPHERE_SEGS_W,
          SPHERE_SEGS_H,
        );
      else if (z.kind === 'prop')
        geometry = new RoundedBoxGeometry(w, z.height, d, 2, Math.min(0.07, Math.min(w, z.height, d) * 0.15));
      else geometry = new THREE.BoxGeometry(w, z.height, d);
      return {
        id: z.id,
        geometry,
        material,
        position,
        rotationY: ((z.rot ?? 0) * Math.PI) / 2,
        isFloor,
        refColor: z.color,
      };
    });
    // ── Horizonte decorativo (no jugable, `noSample`) ──
    const ground = {
      geometry: new THREE.CircleGeometry(150, 40),
      material: new THREE.MeshStandardMaterial({ color: '#86a568', roughness: 1 }),
    };
    const hillGeo = new THREE.ConeGeometry(1, 1, 6); // unidad; cada colina la escala
    const hillMats = HILL_COLORS.map(
      (c) => new THREE.MeshStandardMaterial({ color: c, roughness: 1, flatShading: true }),
    );
    return { baseGeo, baseMat, baseRef: map.floorColor, built, ground, hillGeo, hillMats };
  }, [map]);
  const { baseGeo, baseMat, baseRef, built, ground, hillGeo, hillMats } = memo;

  // Al cambiar de mapa (nueva ronda) se recomputa `memo`: libera los recursos GPU del
  // mapa anterior para no acumular geometrías/materiales (skill r3f-rendering, regla 7).
  useEffect(() => {
    return () => {
      baseGeo.dispose();
      baseMat.dispose();
      ground.geometry.dispose();
      ground.material.dispose();
      hillGeo.dispose();
      for (const m of hillMats) m.dispose();
      for (const z of built) {
        z.geometry.dispose();
        (z.material as THREE.Material).dispose();
      }
    };
  }, [memo, baseGeo, baseMat, ground, hillGeo, hillMats, built]);

  return (
    <>
      {/* Cielo físico + sombras suaves (PCSS): el "parece un juego" de docs/09 §5. */}
      <Sky sunPosition={SUN_POSITION} turbidity={4.5} rayleigh={1} mieCoefficient={0.004} />
      <SoftShadows size={14} samples={10} focus={0.6} />
      {/* Hemisferio cielo/suelo (relleno suave) + sol cálido con sombras sobre TODA la
          arena. Relleno alto a propósito: las caras NO iluminadas de los props deben
          seguir leyéndose (el color local importa para camuflarse). */}
      <hemisphereLight args={['#cfe5ff', '#b0a184', 1.15]} />
      <directionalLight
        position={SUN_POSITION}
        color="#fff4e0"
        intensity={1.8}
        castShadow
        shadow-mapSize-width={2048}
        shadow-mapSize-height={2048}
        shadow-camera-left={-52}
        shadow-camera-right={52}
        shadow-camera-top={52}
        shadow-camera-bottom={-52}
        shadow-camera-near={4}
        shadow-camera-far={110}
        shadow-bias={-0.0004}
        shadow-normalBias={0.05}
      />
      {/* Suelo exterior + colinas: horizonte low-poly, invisible para el cuentagotas. */}
      <mesh
        geometry={ground.geometry}
        material={ground.material}
        rotation-x={-Math.PI / 2}
        position-y={-0.05}
        receiveShadow
        userData={{ noSample: true }}
      />
      {HILLS.map((h, i) => (
        <mesh
          key={i}
          geometry={hillGeo}
          material={hillMats[h.mat]!}
          position={[h.x, h.h / 2 - 0.4, h.z]}
          scale={[h.r, h.h, h.r]}
          userData={{ noSample: true }}
        />
      ))}
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
            rotation-y={z.rotationY}
            castShadow
            receiveShadow
            userData={{ refColor: z.refColor }}
          />
        ),
      )}
    </>
  );
}

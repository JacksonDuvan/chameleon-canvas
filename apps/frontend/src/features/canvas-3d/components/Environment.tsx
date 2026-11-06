/**
 * Environment — la CASA-oficina (rework visual r4, spec del usuario). Renderiza el
 * mapa desde la ÚNICA fuente de verdad compartida `map` de `@mecha/sim`: mismas
 * zonas y colores con los que el servidor razona camuflaje.
 *
 * DIRECTRIZ VISUAL (threejs-game-director, sin assets externos):
 *  - Luz interior: AMBIENTE tenue frío #223344·0.4 + SOL diagonal con sombras 2048
 *    + LÁMPARAS cálidas de techo (`PointLight` decay 2) con POOL de 6 luces
 *    reasignadas por frame a las lámparas más cercanas a la cámara (regla de
 *    `r3f-rendering`: mutación de refs en useFrame, cero setState; >6 point lights
 *    fijas matarían el forward renderer).
 *  - Materiales: muros mate (rough 0.8/metal 0 — datos del generador), suelos
 *    pulidos (rough 0.3/metal 0.1) que reflejan lámparas y paredes vía PMREM
 *    `RoomEnvironment` (módulo LOCAL de three: nada que descargar).
 *  - ACESFilmic + PCFSoftShadowMap se configuran en el <Canvas> (index.tsx).
 *
 * OPTIMIZACIÓN (`r3f-rendering` reglas 5-6 + `workers-memory-optimization`):
 *  - Geometrías UNITARIAS compartidas (box/cyl/sphere/plane) escaladas por malla:
 *    ~300 zonas ⇒ ~5 buffers de GPU en vez de 300.
 *  - Materiales CACHEADOS por (color|rough|metal|flat): ~40 materiales en vez
 *    de ~300 (menos binds y compila una sola vez). NADA de esto se libera al
 *    cambiar de ronda: se REUTILIZA (cero churn de GPU entre mapas).
 *  - Lámparas: geometría fusionada (stem+shade) en UN InstancedMesh (1 draw call
 *    para ~60-90 lámparas).
 *
 * CONTRATO INTOCABLE: cada malla jugable lleva `userData.refColor` (cuentagotas);
 * la decoración inalcanzable lleva `userData.noSample`.
 */
import { useEffect, useMemo, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { useStore } from 'zustand';
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { Sky } from '@react-three/drei';
import { POSE_FLAT, POSE_STAND } from '@mecha/sim';
import { worldStore } from '../store/worldStore';
import { buildPoseGeometries, SPHERE_SEGS_W, SPHERE_SEGS_H } from './avatarGeometry';

/** Roughness de los avatares (`MechaMesh`): señuelos y bolas lo COMPARTEN. */
const AVATAR_ROUGHNESS = 0.8;

/** Sol diagonal (compartido por cielo y luz con sombras coherentes). */
const SUN_POSITION: [number, number, number] = [14, 20, 8];

// ── Spec de iluminación de interiores (r4) ──
const AMBIENT_COLOR = '#223344';
const AMBIENT_INTENSITY = 0.4;
const LAMP_COLOR = '#ffd9a0'; // cálida de oficina
const LAMP_INTENSITY = 14; // candela (decay físico)
const LAMP_DISTANCE = 14;
const LAMP_DECAY = 2; // decaimiento físico realista (spec)
const LAMP_Y = 2.78;
const LAMP_POOL = 6; // luces reales simultáneas (pool por cercanía a cámara)

/** Color empaquetado 0xRRGGBBAA → THREE.Color (interpretado en sRGB). */
function toColor(packed: number): THREE.Color {
  return new THREE.Color().setHex((packed >>> 8) & 0xffffff, THREE.SRGBColorSpace);
}

// ── Geometrías UNITARIAS compartidas (una vez por app; escaladas por malla) ──
const UNIT_BOX = new THREE.BoxGeometry(1, 1, 1);
const UNIT_CYL = new THREE.CylinderGeometry(0.5, 0.5, 1, 12);
const UNIT_SPH = new THREE.SphereGeometry(0.5, SPHERE_SEGS_W, SPHERE_SEGS_H);
const UNIT_PLANE = new THREE.PlaneGeometry(1, 1);

/**
 * Geometrías de pose: singleton de MÓDULO (se comparten avatares + señuelos y
 * SOBREVIVEN a las rondas — el `useMemo` por mapa de antes filtraba 6 fusiones
 * por ronda sin liberarlas). `MechaMesh` sigue con su propia copia por montaje;
 * unificarlo a este cache es trabajo futuro menor.
 */
let poseGeosCache: THREE.BufferGeometry[] | null = null;
function getPoseGeometries(): THREE.BufferGeometry[] {
  if (!poseGeosCache) poseGeosCache = buildPoseGeometries();
  return poseGeosCache;
}

// ── Cache de materiales: clave = color|rough|metal|flat (sobrevive a las rondas) ──
const materialCache = new Map<string, THREE.MeshStandardMaterial>();
function getMaterial(
  packed: number,
  roughness: number,
  metalness: number,
  flat: boolean,
  emissive = 0,
  emissiveIntensity = 0,
): THREE.MeshStandardMaterial {
  const key = `${packed}|${roughness}|${metalness}|${flat}|${emissive}|${emissiveIntensity}`;
  let m = materialCache.get(key);
  if (!m) {
    m = new THREE.MeshStandardMaterial({
      color: toColor(packed),
      roughness,
      metalness,
      flatShading: flat,
      ...(emissive
        ? { emissive: toColor(emissive), emissiveIntensity }
        : {}),
    });
    materialCache.set(key, m);
  }
  return m;
}

interface BuiltZone {
  readonly id: string;
  readonly geometry: THREE.BufferGeometry;
  readonly material: THREE.Material;
  readonly position: [number, number, number];
  readonly rotationY: number;
  readonly scale: [number, number, number];
  readonly isFloor: boolean;
  readonly refColor: number;
}

/** Lámpara de oficina low-poly: poste + pantalla, fusionados (para instancing). */
function buildLampGeometry(): THREE.BufferGeometry {
  const stem = new THREE.CylinderGeometry(0.03, 0.05, LAMP_Y, 8).translate(0, LAMP_Y / 2, 0);
  const shade = new THREE.CylinderGeometry(0.26, 0.3, 0.14, 10).translate(0, LAMP_Y, 0);
  const merged = mergeGeometries([stem, shade], false);
  stem.dispose();
  shade.dispose();
  if (!merged) throw new Error('Environment: fusión de lámpara fallida');
  return merged;
}

/** Posiciones de lámparas: centros de suelos, retícula ~8 m (frío, por mapa). */
function lampPositions(zones: ReadonlyArray<{ kind: string; minX: number; maxX: number; minZ: number; maxZ: number }>): Array<{ x: number; z: number }> {
  const pts: Array<{ x: number; z: number }> = [];
  for (const z of zones) {
    if (z.kind !== 'floor') continue;
    const w = z.maxX - z.minX;
    const d = z.maxZ - z.minZ;
    const nx = Math.max(1, Math.round(w / 8));
    const nz = Math.max(1, Math.round(d / 8));
    const stepX = w / nx;
    const stepZ = d / nz;
    for (let i = 0; i < nx; i++) {
      for (let j = 0; j < nz; j++) {
        pts.push({ x: z.minX + stepX * (i + 0.5), z: z.minZ + stepZ * (j + 0.5) });
      }
    }
  }
  return pts;
}

/**
 * LightPool — 6 PointLights cálidas reasignadas POR FRAME a las lámparas más
 * cercanas a la cámara. Cero asignaciones (scratch preasignado), cero setState
 * (skill `r3f-rendering`). Las lámparas lejanas siguen "encendidas" visualmente
 * por su malla emisiva (instanced).
 */
function LightPool({ lamps }: { lamps: ReadonlyArray<{ x: number; z: number }> }) {
  const lightsRef = useRef<Array<THREE.PointLight | null>>([]);
  const scratch = useRef({
    dist: new Float64Array(LAMP_POOL),
    idx: new Int32Array(LAMP_POOL),
    taken: new Uint8Array(1024), // marca lámparas ya elegidas (se resetea por frame)
  });
  useEffect(() => {
    scratch.current.taken = new Uint8Array(Math.max(1024, lamps.length));
  }, [lamps]);

  useFrame(({ camera }) => {
    const { dist, idx, taken } = scratch.current;
    taken.fill(0);
    dist.fill(Infinity);
    idx.fill(-1);
    const cx = camera.position.x;
    const cz = camera.position.z;
    // Top-K sin allocar: por cada slot del pool, la lámpara libre más cercana.
    for (let k = 0; k < LAMP_POOL; k++) {
      let bestD = Infinity;
      let bestI = -1;
      for (let i = 0; i < lamps.length; i++) {
        if (taken[i]) continue;
        const lamp = lamps[i]!;
        const dx = lamp.x - cx;
        const dz = lamp.z - cz;
        const d = dx * dx + dz * dz;
        if (d < bestD) {
          bestD = d;
          bestI = i;
        }
      }
      if (bestI < 0) break;
      taken[bestI] = 1;
      idx[k] = bestI;
      dist[k] = bestD;
    }
    for (let k = 0; k < LAMP_POOL; k++) {
      const light = lightsRef.current[k];
      if (!light) continue;
      const i = idx[k]!;
      if (i < 0) {
        light.intensity = 0;
        continue;
      }
      const lamp = lamps[i]!;
      light.position.set(lamp.x, LAMP_Y, lamp.z);
      light.intensity = LAMP_INTENSITY;
    }
  });

  return (
    <>
      {Array.from({ length: LAMP_POOL }, (_, i) => (
        <pointLight
          key={i}
          ref={(r: THREE.PointLight | null) => {
            lightsRef.current[i] = r;
          }}
          color={LAMP_COLOR}
          intensity={0}
          distance={LAMP_DISTANCE}
          decay={LAMP_DECAY}
        />
      ))}
    </>
  );
}

/**
 * Reflexiones sutiles de oficina: PMREM del `RoomEnvironment` (ESCENA PROCEDURAL
 * local de three — sin descargas ni HDRs externos, requisito del usuario). Los
 * suculos pulidos (metalness 0.1) reciben brillos especulares de "ventanas".
 */
function OfficeReflections() {
  const gl = useThree((s) => s.gl);
  const scene = useThree((s) => s.scene);
  useEffect(() => {
    const pmrem = new THREE.PMREMGenerator(gl);
    const room = new RoomEnvironment();
    const tex = pmrem.fromScene(room, 0.04).texture;
    scene.environment = tex;
    scene.environmentIntensity = 0.3; // sutil: no lava los colores de camuflaje
    room.dispose?.();
    pmrem.dispose();
    return () => {
      scene.environment = null;
      tex.dispose();
    };
  }, [gl, scene]);
  return null;
}

/** Lámparas instanciadas (1 draw call para todas). */
function Lamps({ lamps }: { lamps: ReadonlyArray<{ x: number; z: number }> }) {
  const geo = useMemo(buildLampGeometry, []);
  const mat = useMemo(
    () => new THREE.MeshStandardMaterial({ color: '#3a3f46', roughness: 0.6, metalness: 0.4 }),
    [],
  );
  const bulbMat = useMemo(
    () =>
      new THREE.MeshStandardMaterial({
        color: LAMP_COLOR,
        emissive: LAMP_COLOR,
        emissiveIntensity: 1.6,
      }),
    [],
  );
  const bulbGeo = useMemo(() => new THREE.SphereGeometry(0.09, 8, 6), []);
  const ref = useRef<THREE.InstancedMesh>(null);
  const bulbRef = useRef<THREE.InstancedMesh>(null);
  useEffect(() => {
    const m = new THREE.Matrix4();
    const im = ref.current;
    const bulbs = bulbRef.current;
    if (!im || !bulbs) return;
    for (let i = 0; i < lamps.length; i++) {
      const lamp = lamps[i]!;
      m.makeTranslation(lamp.x, 0, lamp.z);
      im.setMatrixAt(i, m);
      m.makeTranslation(lamp.x, LAMP_Y - 0.1, lamp.z);
      bulbs.setMatrixAt(i, m);
    }
    im.count = lamps.length;
    bulbs.count = lamps.length;
    im.instanceMatrix.needsUpdate = true;
    bulbs.instanceMatrix.needsUpdate = true;
  }, [lamps]);
  useEffect(
    () => () => {
      geo.dispose();
      mat.dispose();
      bulbMat.dispose();
      bulbGeo.dispose();
    },
    [geo, mat, bulbMat, bulbGeo],
  );
  return (
    <>
      <instancedMesh ref={ref} args={[geo, mat, Math.max(1, lamps.length)]} castShadow />
      <instancedMesh ref={bulbRef} args={[bulbGeo, bulbMat, Math.max(1, lamps.length)]} />
    </>
  );
}

/** Colinas low-poly del horizonte (decoración pura, fuera del recinto jugable). */
interface Hill {
  readonly x: number;
  readonly z: number;
  readonly r: number;
  readonly h: number;
  readonly mat: number;
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

// ── Horizonte decorativo: materiales/geometría creados UNA vez (hooks arriba) ──
const HILL_GEO = new THREE.ConeGeometry(1, 1, 6);
const GROUND_MAT = new THREE.MeshStandardMaterial({ color: '#86a568', roughness: 1 });
const HILL_MATS = HILL_COLORS.map(
  (c) => new THREE.MeshStandardMaterial({ color: c, roughness: 1, flatShading: true }),
);

export function Environment() {
  // Mapa ALEATORIO por ronda: se regenera cuando cambia `mapSeed` (selector
  // reactivo; estado LENTO — cambia una vez por ronda; regla 4 de r3f-rendering).
  const map = useStore(worldStore, (s) => s.map);
  const lamps = useMemo(() => lampPositions(map.zones), [map]);

  const built = useMemo<BuiltZone[]>(() => {
    const poseGeos = getPoseGeometries();
    const figureGeo = poseGeos[POSE_STAND]!;
    const cookieGeo = poseGeos[POSE_FLAT]!;
    return map.zones.map((z) => {
      const w = z.maxX - z.minX;
      const d = z.maxZ - z.minZ;
      const cx = (z.minX + z.maxX) / 2;
      const cz = (z.minZ + z.maxZ) / 2;
      const isFloor = z.kind === 'floor';
      const isFigure = z.shape === 'figure' || z.shape === 'figureWall';
      const isMimic = isFigure || z.shape === 'sphere';
      // Material: datos del generador (muros mate 0.8/0, suelos pulidos 0.3/0.1,
      // muebles según su tipo); señuelos que imitan poses copian el ACABADO del
      // avatar (liso) para que nadie se delate por el brillo.
      const material = isMimic
        ? getMaterial(z.color, AVATAR_ROUGHNESS, 0, false)
        : getMaterial(z.color, z.roughness, z.metalness, !isFloor);
      let geometry: THREE.BufferGeometry;
      const position: [number, number, number] = [cx, z.y, cz];
      const scale: [number, number, number] = [w, z.height, d];
      if (isFloor) {
        geometry = UNIT_PLANE;
      } else if (isFigure) {
        geometry = z.shape === 'figure' ? figureGeo : cookieGeo;
        position[1] = z.y - z.height / 2; // pies del muñeco en la base de la zona
        scale[0] = 1;
        scale[1] = 1;
        scale[2] = 1;
      } else if (z.shape === 'cylinder') {
        geometry = UNIT_CYL;
        const diam = Math.min(w, d);
        scale[0] = diam;
        scale[1] = z.height;
        scale[2] = diam;
      } else if (z.shape === 'sphere') {
        geometry = UNIT_SPH;
        const s = Math.min(w, d, z.height);
        scale[0] = s;
        scale[1] = s;
        scale[2] = s;
      } else {
        // muro / caja / mueble: cubo unitario escalado (low-poly indie, bisel fuera)
        geometry = UNIT_BOX;
      }
      return {
        id: z.id,
        geometry,
        material,
        position,
        rotationY: ((z.rot ?? 0) * Math.PI) / 2,
        scale,
        isFloor,
        refColor: z.color,
      };
    });
    // NOTA: nada que disponer aquí — geometrías unitarias y materiales son
    // COMPARTIDOS y sobreviven a la ronda; las de poses las administra MechaMesh.
  }, [map]);

  return (
    <>
      {/* Cielo físico (día suave; el sol diagonal lo comparte la luz con sombras). */}
      <Sky sunPosition={SUN_POSITION} turbidity={4.5} rayleigh={1} mieCoefficient={0.004} />
      {/* ── Iluminación interior (spec r4) ── */}
      {/* Relleno tenue y FRÍO de sombras (spec: #223344 · 0.4). */}
      <ambientLight color={AMBIENT_COLOR} intensity={AMBIENT_INTENSITY} />
      {/* Sol diagonal: volumen general + sombras 2048 sobre TODA la casa. */}
      <directionalLight
        position={SUN_POSITION}
        color="#fff4e0"
        intensity={1.9}
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
      {/* Lámparas de oficina: mallas instanciadas + pool de PointLights cálidas. */}
      <Lamps lamps={lamps} />
      <LightPool lamps={lamps} />
      {/* Reflexiones sutiles (PMREM procedural local) para los suelos pulidos. */}
      <OfficeReflections />

      {/* Suelo exterior + colinas: horizonte low-poly, invisible para el cuentagotas. */}
      <mesh
        geometry={UNIT_PLANE}
        material={GROUND_MAT}
        scale={[300, 300, 1]}
        rotation-x={-Math.PI / 2}
        position-y={-0.05}
        receiveShadow
        userData={{ noSample: true }}
      />
      {HILLS.map((h, i) => (
        <mesh
          key={i}
          geometry={HILL_GEO}
          material={HILL_MATS[h.mat]!}
          position={[h.x, h.h / 2 - 0.4, h.z]}
          scale={[h.r, h.h, h.r]}
          userData={{ noSample: true }}
        />
      ))}
      {/* Suelo base (fallback de color de referencia). */}
      <mesh
        geometry={UNIT_PLANE}
        material={getMaterial(map.floorColor, 1, 0, false)}
        scale={[map.bounds.maxX - map.bounds.minX, map.bounds.maxZ - map.bounds.minZ, 1]}
        rotation-x={-Math.PI / 2}
        receiveShadow
        userData={{ refColor: map.floorColor }}
      />
      {built.map((z) =>
        z.isFloor ? (
          <mesh
            key={z.id}
            geometry={z.geometry}
            material={z.material}
            position={z.position}
            scale={[z.scale[0], z.scale[1], 1]}
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
            scale={[z.scale[0], z.scale[1], z.scale[2]]}
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

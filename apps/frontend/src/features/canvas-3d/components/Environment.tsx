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
import { DEFAULT_SIM_CONFIG, POSE_FLAT, POSE_STAND } from '@mecha/sim';
import { worldStore } from '../store/worldStore';
import { buildPoseGeometries, SPHERE_SEGS_W, SPHERE_SEGS_H } from './avatarGeometry';
import { sampleLocalMut } from '../hooks/interpolation';
import { getFurnitureUnit } from './furnitureGeometry';
import { applySurfaceDetail } from './surfaceDetail';

/** Roughness de los avatares (`MechaMesh`): señuelos y bolas lo COMPARTEN. */
const AVATAR_ROUGHNESS = 0.8;

/** Sol diagonal (compartido por cielo y luz con sombras coherentes). */
const SUN_POSITION: [number, number, number] = [14, 20, 8];

// ── Spec de iluminación de interiores (r4) ──
const AMBIENT_COLOR = '#223344';
const AMBIENT_INTENSITY = 0.4;
const LAMP_COLOR = '#ffd9a0'; // cálida de oficina
const LAMP_INTENSITY = 14; // candela (decay físico)
// Alcance corto: los PointLights NO proyectan sombra, así que con 14 m la luz
// "atravesaba" los muros e iluminaba el cuarto vecino (playtest r5).
const LAMP_DISTANCE = 9;
const LAMP_DECAY = 2; // decaimiento físico realista (spec)
const LAMP_Y = 3.45; // pantalla COLGANTE por ENCIMA de la cámara en 3ª persona (≤3 m): a 2.7 m se
// interponía entre la cámara y el avatar (playtest r6)
const LAMP_LIGHT_Y = 2.6; // la luz real, un poco por debajo de la pantalla
const LAMP_POOL = 6; // luces reales simultáneas (pool por cercanía a cámara)
const LAMP_FADE = 5; // 1/s — fundido al reasignar una luz del pool (sin "pops")

// ── Sombras del sol: el frustum SIGUE al jugador (4× más nítidas que cubrir toda la casa) ──
const SHADOW_MAP = 2048;
const SHADOW_EXT_PLAY = 26; // semiancho en partida (centrado en el jugador)
const SHADOW_EXT_OVERVIEW = 52; // lobby/results: toda la casa a la vista
const TICK_MS = 1000 / DEFAULT_SIM_CONFIG.tickHz;

// ── Remates decorativos de muro (zócalo + cornisa): escala y lectura de "interior" ──
const TRIM_BASE_H = 0.16;
const TRIM_CAP_H = 0.07;
const TRIM_OUT = 0.03; // sobresale 3 cm del muro (nunca coplanario con él)

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
    // Relieve procedural en espacio de mundo (grano + bump; baldosas en suelos, que
    // son los únicos materiales no-flat del mapa). Ver `surfaceDetail`.
    m = applySurfaceDetail(
      new THREE.MeshStandardMaterial({
        color: toColor(packed),
        roughness,
        metalness,
        flatShading: flat,
        ...(emissive ? { emissive: toColor(emissive), emissiveIntensity } : {}),
      }),
      !flat && roughness < 0.6,
    );
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
  readonly isWall: boolean;
  readonly refColor: number;
}

/**
 * Lámpara COLGANTE low-poly: cable + pantalla cónica, fusionados (para instancing).
 * Antes era un poste desde el suelo: llenaba pasillos y cuartos de barras negras
 * que el servidor no conoce (se atravesaban y tapaban la vista — playtest r5).
 */
function buildLampGeometry(): THREE.BufferGeometry {
  const cord = new THREE.CylinderGeometry(0.01, 0.01, 0.5, 5).translate(0, LAMP_Y + 0.34, 0);
  const shade = new THREE.CylinderGeometry(0.07, 0.24, 0.16, 10, 1, true).translate(0, LAMP_Y, 0);
  const cap = new THREE.CylinderGeometry(0.07, 0.07, 0.03, 10).translate(0, LAMP_Y + 0.08, 0);
  const merged = mergeGeometries([cord, shade, cap], false);
  cord.dispose();
  shade.dispose();
  cap.dispose();
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
 * LightPool — 6 PointLights cálidas asignadas a las lámparas más cercanas a la
 * cámara. Cada luz CONSERVA su lámpara mientras siga en el top-K; cuando deja de
 * estarlo se funde a 0 y solo entonces salta a una lámpara libre y vuelve a
 * subir (antes se teletransportaba a plena intensidad ⇒ parpadeos al caminar).
 * Cero asignaciones (scratch preasignado), cero setState (skill `r3f-rendering`).
 */
function LightPool({ lamps }: { lamps: ReadonlyArray<{ x: number; z: number }> }) {
  const lightsRef = useRef<Array<THREE.PointLight | null>>([]);
  const scratch = useRef({
    idx: new Int32Array(LAMP_POOL), // top-K de este frame
    held: new Int32Array(LAMP_POOL).fill(-1), // lámpara que tiene cada luz
    taken: new Uint8Array(1024), // marca lámparas ya elegidas (se resetea por frame)
  });
  useEffect(() => {
    scratch.current.taken = new Uint8Array(Math.max(1024, lamps.length));
    scratch.current.held.fill(-1); // mapa nuevo: los índices viejos ya no valen
  }, [lamps]);

  useFrame(({ camera }, delta) => {
    const { idx, held, taken } = scratch.current;
    const k01 = Math.min(1, delta * LAMP_FADE);
    taken.fill(0);
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
    }
    // `taken` pasa a significar "lámpara del top-K que YA tiene una luz".
    taken.fill(0);
    for (let k = 0; k < LAMP_POOL; k++) {
      const h = held[k]!;
      if (h < 0) continue;
      let inSet = false;
      for (let j = 0; j < LAMP_POOL; j++) if (idx[j] === h) inSet = true;
      if (inSet) taken[h] = 1;
      else if ((lightsRef.current[k]?.intensity ?? 0) < 0.05) held[k] = -1; // apagada: libre
    }
    for (let k = 0; k < LAMP_POOL; k++) {
      const light = lightsRef.current[k];
      if (!light) continue;
      if (held[k]! < 0) {
        // Luz libre: toma una lámpara del top-K que aún no tenga luz.
        for (let j = 0; j < LAMP_POOL; j++) {
          const cand = idx[j]!;
          if (cand >= 0 && !taken[cand]) {
            held[k] = cand;
            taken[cand] = 1;
            const lamp = lamps[cand]!;
            light.position.set(lamp.x, LAMP_LIGHT_Y, lamp.z);
            light.intensity = 0;
            break;
          }
        }
      }
      const h = held[k]!;
      let target = 0;
      if (h >= 0) for (let j = 0; j < LAMP_POOL; j++) if (idx[j] === h) target = LAMP_INTENSITY;
      light.intensity += (target - light.intensity) * k01;
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
 * SunLight — sol diagonal cuyo frustum de sombras SIGUE al jugador. Cubrir los
 * 104 m de la casa con 2048 px daba ~5 cm/texel (sombras de contacto borrosas);
 * centrado en el jugador con ±26 m son ~2.5 cm. El centro se ajusta a la rejilla
 * de texels EN ESPACIO DE LUZ para que las sombras no "naden" al caminar. En
 * lobby/results (vista aérea) vuelve a cubrir toda la casa.
 */
const _sunDir = new THREE.Vector3(...SUN_POSITION).normalize();
const _sunRight = new THREE.Vector3().crossVectors(new THREE.Vector3(0, 1, 0), _sunDir).normalize();
const _sunUp = new THREE.Vector3().crossVectors(_sunDir, _sunRight).normalize();
const _sunCenter = new THREE.Vector3();
function SunLight() {
  const ref = useRef<THREE.DirectionalLight>(null);
  const target = useMemo(() => new THREE.Object3D(), []);
  useEffect(() => {
    if (ref.current) ref.current.target = target;
  }, [target]);

  useFrame(() => {
    const light = ref.current;
    if (!light) return;
    const st = worldStore.getState();
    const inRound = st.phase === 'prep' || st.phase === 'hunt';
    const ext = inRound ? SHADOW_EXT_PLAY : SHADOW_EXT_OVERVIEW;
    const cam = light.shadow.camera;
    if (cam.right !== ext) {
      cam.left = -ext;
      cam.right = ext;
      cam.top = ext;
      cam.bottom = -ext;
      cam.updateProjectionMatrix(); // solo al cambiar de fase
    }
    if (inRound) {
      sampleLocalMut(st.localPrevPos, st.local.pos, st.localPredAt, performance.now(), TICK_MS, _sunCenter);
      _sunCenter.y = 0;
      const texel = (2 * ext) / SHADOW_MAP;
      const r = _sunCenter.dot(_sunRight);
      const u = _sunCenter.dot(_sunUp);
      _sunCenter
        .addScaledVector(_sunRight, Math.round(r / texel) * texel - r)
        .addScaledVector(_sunUp, Math.round(u / texel) * texel - u);
    } else {
      _sunCenter.set(0, 0, 0);
    }
    target.position.copy(_sunCenter);
    target.updateMatrixWorld();
    light.position.copy(_sunCenter).addScaledVector(_sunDir, 60);
  });

  return (
    <>
      <primitive object={target} />
      <directionalLight
        ref={ref}
        position={SUN_POSITION}
        color="#fff4e0"
        intensity={1.9}
        castShadow
        shadow-mapSize-width={SHADOW_MAP}
        shadow-mapSize-height={SHADOW_MAP}
        shadow-camera-left={-SHADOW_EXT_OVERVIEW}
        shadow-camera-right={SHADOW_EXT_OVERVIEW}
        shadow-camera-top={SHADOW_EXT_OVERVIEW}
        shadow-camera-bottom={-SHADOW_EXT_OVERVIEW}
        shadow-camera-near={4}
        shadow-camera-far={130}
        shadow-bias={-0.0004}
        shadow-normalBias={0.05}
      />
    </>
  );
}

/**
 * Remates de muro (zócalo oscuro + cornisa clara): 2 InstancedMesh para TODOS los
 * muros. Un único color por remate ⇒ los solapes coplanarios en las esquinas son
 * invisibles (mismo material, misma normal). `noSample`: no existen para el
 * servidor, así que ni el cuentagotas ni el trazador los ven.
 */
const TRIM_BASE_MAT = new THREE.MeshStandardMaterial({ color: '#4b443d', roughness: 0.9 });
const TRIM_CAP_MAT = new THREE.MeshStandardMaterial({ color: '#f1ebdd', roughness: 0.85 });
const NO_SAMPLE = { noSample: true };
function WallTrim({ walls }: { walls: ReadonlyArray<BuiltZone> }) {
  const baseRef = useRef<THREE.InstancedMesh>(null);
  const capRef = useRef<THREE.InstancedMesh>(null);
  useEffect(() => {
    const base = baseRef.current;
    const cap = capRef.current;
    if (!base || !cap) return;
    const o = new THREE.Object3D();
    for (let i = 0; i < walls.length; i++) {
      const w = walls[i]!;
      const top = w.position[1] + w.scale[1] / 2;
      const bottom = w.position[1] - w.scale[1] / 2;
      o.position.set(w.position[0], bottom + TRIM_BASE_H / 2, w.position[2]);
      o.scale.set(w.scale[0] + TRIM_OUT * 2, TRIM_BASE_H, w.scale[2] + TRIM_OUT * 2);
      o.updateMatrix();
      base.setMatrixAt(i, o.matrix);
      o.position.set(w.position[0], top + TRIM_CAP_H / 2, w.position[2]);
      o.scale.set(w.scale[0] + TRIM_OUT * 2, TRIM_CAP_H, w.scale[2] + TRIM_OUT * 2);
      o.updateMatrix();
      cap.setMatrixAt(i, o.matrix);
    }
    base.count = walls.length;
    cap.count = walls.length;
    base.instanceMatrix.needsUpdate = true;
    cap.instanceMatrix.needsUpdate = true;
  }, [walls]);
  // key por capacidad: un mapa con más muros que el anterior recrea el buffer.
  const cap = Math.max(1, walls.length);
  return (
    <>
      <instancedMesh key={`b${cap}`} ref={baseRef} args={[UNIT_BOX, TRIM_BASE_MAT, cap]} receiveShadow frustumCulled={false} userData={NO_SAMPLE} />
      <instancedMesh key={`c${cap}`} ref={capRef} args={[UNIT_BOX, TRIM_CAP_MAT, cap]} receiveShadow frustumCulled={false} userData={NO_SAMPLE} />
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
    () =>
      new THREE.MeshStandardMaterial({ color: '#3a3f46', roughness: 0.6, metalness: 0.4, side: THREE.DoubleSide }),
    [],
  );
  const bulbMat = useMemo(
    () =>
      new THREE.MeshStandardMaterial({
        color: LAMP_COLOR,
        emissive: LAMP_COLOR,
        emissiveIntensity: 4.5, // HDR: por encima del umbral del bloom (PostFx)
      }),
    [],
  );
  const bulbGeo = useMemo(() => new THREE.SphereGeometry(0.07, 8, 6), []);
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
      m.makeTranslation(lamp.x, LAMP_Y - 0.04, lamp.z);
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
      {/* key por capacidad (un mapa con más lámparas recrea el buffer); sin culling:
          la bounding sphere de la geometría está en el origen. `noSample`: decoración. */}
      <instancedMesh key={`l${Math.max(1, lamps.length)}`} ref={ref} args={[geo, mat, Math.max(1, lamps.length)]} frustumCulled={false} userData={NO_SAMPLE} />
      <instancedMesh key={`b${Math.max(1, lamps.length)}`} ref={bulbRef} args={[bulbGeo, bulbMat, Math.max(1, lamps.length)]} frustumCulled={false} userData={NO_SAMPLE} />
    </>
  );
}

/**
 * SkyDome — cielo de DEGRADADO propio (horizonte claro → cénit azul) + disco solar.
 * Sustituye al cielo físico de drei: con el buffer HDR del posprocesado su franja
 * de dispersión se salía de rango y aparecía una BANDA morada cruzando el cielo.
 * Un degradado acotado es estable en ambos modos de calidad; el sol va en HDR
 * (color > 1) para que el bloom le dé halo. `noSample` + sin niebla ni depth.
 */
const SKY_HORIZON = new THREE.Color('#cfdce8'); // = color de la niebla (index.tsx)
const SKY_ZENITH = new THREE.Color('#4f8fd6');
const SKY_GEO = (() => {
  const g = new THREE.SphereGeometry(380, 32, 16);
  const pos = g.getAttribute('position');
  const colors = new Float32Array(pos.count * 3);
  const c = new THREE.Color();
  for (let i = 0; i < pos.count; i++) {
    const h = Math.max(0, pos.getY(i) / 380); // 0 horizonte → 1 cénit
    c.copy(SKY_HORIZON).lerp(SKY_ZENITH, Math.pow(h, 0.55));
    colors[i * 3] = c.r;
    colors[i * 3 + 1] = c.g;
    colors[i * 3 + 2] = c.b;
  }
  g.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  return g;
})();
const SKY_MAT = new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.BackSide, fog: false, depthWrite: false });
const SUN_GEO = new THREE.SphereGeometry(9, 16, 12);
const SUN_MAT = new THREE.MeshBasicMaterial({ color: new THREE.Color(4, 3.6, 2.8), fog: false });
const SUN_DISC_POS = new THREE.Vector3(...SUN_POSITION).normalize().multiplyScalar(340);
function SkyDome() {
  const ref = useRef<THREE.Group>(null);
  // La cúpula sigue a la cámara: el cielo está "en el infinito".
  useFrame(({ camera }) => {
    ref.current?.position.set(camera.position.x, 0, camera.position.z);
  });
  return (
    <group ref={ref}>
      <mesh geometry={SKY_GEO} material={SKY_MAT} renderOrder={-10} frustumCulled={false} userData={NO_SAMPLE} />
      <mesh geometry={SUN_GEO} material={SUN_MAT} position={SUN_DISC_POS} frustumCulled={false} userData={NO_SAMPLE} />
    </group>
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
      } else if (z.furniture) {
        geometry = getFurnitureUnit(z.furniture); // unitario: escala = AABB de la zona
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
        isWall: z.kind === 'wall',
        refColor: z.color,
      };
    });
    // NOTA: nada que disponer aquí — geometrías unitarias y materiales son
    // COMPARTIDOS y sobreviven a la ronda; las de poses las administra MechaMesh.
  }, [map]);
  const walls = useMemo(() => built.filter((z) => z.isWall), [built]);

  return (
    <>
      {/* Cielo: cúpula de degradado propia + disco solar (ver `SkyDome`). */}
      <SkyDome />
      {/* ── Iluminación interior (spec r4) ── */}
      {/* Relleno tenue y FRÍO de sombras (spec: #223344 · 0.4). */}
      <ambientLight color={AMBIENT_COLOR} intensity={AMBIENT_INTENSITY} />
      {/* Sol diagonal: volumen general + sombras 2048 sobre TODA la casa. */}
      <SunLight />
      {/* Lámparas de oficina: mallas instanciadas + pool de PointLights cálidas. */}
      <WallTrim walls={walls} />
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
            // Plano XY girado: ancho=X, alto local=profundidad Z. (Bug r5: usaba la
            // ALTURA de la zona —0 en suelos— y los suelos de color eran invisibles.)
            scale={[z.scale[0], z.scale[2], 1]}
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

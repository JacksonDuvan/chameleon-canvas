/**
 * surfaceDetail — relieve PROCEDURAL para los materiales del juego (playtest r6:
 * "gráficos mucho mejores"), sin texturas descargadas.
 *
 * Parchea un `MeshStandardMaterial` (onBeforeCompile) para que, en ESPACIO DE MUNDO:
 *  - el color base varíe unos pocos % (grano fino + manchas amplias): yeso, pintura,
 *    plástico — deja de ser un color plano de CAD;
 *  - el roughness varíe con el mismo grano (el brillo "rompe" sobre la superficie);
 *  - la normal se perturbe (bump por derivadas) para que la luz rasante lea textura;
 *  - los SUELOS lleven juntas de baldosa de 1 m con un tinte por baldosa.
 *
 * CONTRATO DE CAMUFLAJE: el patrón depende solo de la posición/normal de MUNDO y
 * se aplica IGUAL a escenario y avatares ⇒ un Hider pintado del color de un muro
 * muestra el mismo grano que el muro (el detalle nunca lo delata). El color de
 * referencia que puntúa el servidor (`userData.refColor`) no cambia.
 *
 * Una sola textura de ruido 128² compartida por todos los materiales.
 */
import * as THREE from 'three';

/** PRNG determinista (mulberry32): el ruido es el mismo en todos los clientes. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Ruido de valor TILEABLE (rejilla `cells`², interpolación suave) muestreado a `size`². */
function valueNoise(size: number, cells: number, rnd: () => number): Float32Array {
  const grid = new Float32Array(cells * cells);
  for (let i = 0; i < grid.length; i++) grid[i] = rnd();
  const out = new Float32Array(size * size);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const gx = (x / size) * cells;
      const gy = (y / size) * cells;
      const x0 = Math.floor(gx);
      const y0 = Math.floor(gy);
      const fx = gx - x0;
      const fy = gy - y0;
      const sx = fx * fx * (3 - 2 * fx);
      const sy = fy * fy * (3 - 2 * fy);
      const x1 = (x0 + 1) % cells;
      const y1 = (y0 + 1) % cells;
      const a = grid[y0 * cells + x0]!;
      const b = grid[y0 * cells + x1]!;
      const c = grid[y1 * cells + x0]!;
      const d = grid[y1 * cells + x1]!;
      out[y * size + x] = a + (b - a) * sx + (c - a) * sy + (a - b - c + d) * sx * sy;
    }
  }
  return out;
}

let detailTexture: THREE.DataTexture | null = null;
/** R = grano fino (3 octavas) · G = manchas amplias (2 octavas). Tileable, con mipmaps. */
function getDetailTexture(): THREE.DataTexture {
  if (detailTexture) return detailTexture;
  const size = 128;
  const rnd = mulberry32(0xc0ffee);
  const f1 = valueNoise(size, 32, rnd);
  const f2 = valueNoise(size, 64, rnd);
  const f3 = valueNoise(size, 16, rnd);
  const b1 = valueNoise(size, 4, rnd);
  const b2 = valueNoise(size, 8, rnd);
  const data = new Uint8Array(size * size * 4);
  for (let i = 0; i < size * size; i++) {
    data[i * 4] = Math.round((f1[i]! * 0.5 + f2[i]! * 0.3 + f3[i]! * 0.2) * 255);
    data[i * 4 + 1] = Math.round((b1[i]! * 0.65 + b2[i]! * 0.35) * 255);
    data[i * 4 + 2] = 0;
    data[i * 4 + 3] = 255;
  }
  const tex = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.generateMipmaps = true;
  tex.colorSpace = THREE.NoColorSpace; // datos, no color
  tex.needsUpdate = true;
  detailTexture = tex;
  return tex;
}

const VERTEX_DECL = /* glsl */ `
varying vec3 vDetailPos;
varying vec3 vDetailNrm;
`;
const VERTEX_MAIN = /* glsl */ `
{
  vec4 dWorld = vec4(transformed, 1.0);
  vec3 dNrm = objectNormal;
  #ifdef USE_INSTANCING
    dWorld = instanceMatrix * dWorld;
    dNrm = mat3(instanceMatrix) * dNrm;
  #endif
  dWorld = modelMatrix * dWorld;
  vDetailPos = dWorld.xyz;
  vDetailNrm = mat3(modelMatrix) * dNrm;
}
`;
const FRAGMENT_DECL = /* glsl */ `
uniform sampler2D uDetailMap;
varying vec3 vDetailPos;
varying vec3 vDetailNrm;
`;
/** Tras `color_fragment`: muestrea el ruido (proyección por eje dominante) y tiñe. */
const FRAGMENT_COLOR = /* glsl */ `
vec3 dAxis = abs(normalize(vDetailNrm));
vec2 dUv = dAxis.y > 0.6 ? vDetailPos.xz : (dAxis.x > dAxis.z ? vDetailPos.zy : vDetailPos.xy);
float dGrain = texture2D(uDetailMap, dUv * 0.85).r;
float dBroad = texture2D(uDetailMap, dUv * 0.09 + 0.37).g;
float dSeam = 0.0;
diffuseColor.rgb *= 1.0 + (dGrain - 0.5) * 0.07 + (dBroad - 0.5) * 0.09;
#ifdef DETAIL_FLOOR
  vec2 dTile = vDetailPos.xz;
  vec2 dEdge = abs(fract(dTile) - 0.5);
  dSeam = smoothstep(0.475, 0.497, max(dEdge.x, dEdge.y));
  vec2 dCell = floor(dTile);
  float dTint = fract(sin(dot(dCell, vec2(12.9898, 78.233))) * 43758.5453);
  diffuseColor.rgb *= (1.0 + (dTint - 0.5) * 0.05) * (1.0 - dSeam * 0.16);
#endif
float dHeight = dGrain * 0.7 + dBroad * 0.3 - dSeam * 1.5;
`;
/** Tras `roughnessmap_fragment`: el brillo se rompe con el grano; la junta es mate. */
const FRAGMENT_ROUGH = /* glsl */ `
roughnessFactor = clamp(roughnessFactor + (dGrain - 0.5) * 0.3 - (dBroad - 0.5) * 0.12 + dSeam * 0.35, 0.05, 1.0);
`;
/** Tras `normal_fragment_maps`: bump por derivadas de la altura (como bumpMap de three). */
const FRAGMENT_NORMAL = /* glsl */ `
{
  vec3 dSigX = dFdx(-vViewPosition);
  vec3 dSigY = dFdy(-vViewPosition);
  vec3 dR1 = cross(dSigY, normal);
  vec3 dR2 = cross(normal, dSigX);
  float dDet = dot(dSigX, dR1);
  vec3 dGrad = sign(dDet) * (dFdx(dHeight) * dR1 + dFdy(dHeight) * dR2);
  normal = normalize(abs(dDet) * normal - DETAIL_BUMP * dGrad);
}
`;

function inject(src: string, anchor: string, code: string): string {
  if (!src.includes(anchor)) throw new Error(`surfaceDetail: ancla de shader ausente: ${anchor}`);
  return src.replace(anchor, `${anchor}\n${code}`);
}

/**
 * Añade el relieve procedural a un material estándar (una vez, al crearlo).
 * `floor` activa las juntas de baldosa. Devuelve el mismo material.
 */
export function applySurfaceDetail<T extends THREE.MeshStandardMaterial>(material: T, floor = false): T {
  const tex = getDetailTexture();
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uDetailMap = { value: tex };
    shader.vertexShader = inject(shader.vertexShader, '#include <common>', VERTEX_DECL);
    shader.vertexShader = inject(shader.vertexShader, '#include <project_vertex>', VERTEX_MAIN);
    let fs = shader.fragmentShader;
    fs = inject(fs, '#include <common>', `#define DETAIL_BUMP ${floor ? '0.007' : '0.01'}\n${floor ? '#define DETAIL_FLOOR\n' : ''}${FRAGMENT_DECL}`);
    fs = inject(fs, '#include <color_fragment>', FRAGMENT_COLOR);
    fs = inject(fs, '#include <roughnessmap_fragment>', FRAGMENT_ROUGH);
    fs = inject(fs, '#include <normal_fragment_maps>', FRAGMENT_NORMAL);
    shader.fragmentShader = fs;
  };
  // Variante de programa distinta por tipo (three cachea programas por clave).
  material.customProgramCacheKey = () => (floor ? 'surface-detail-floor' : 'surface-detail');
  return material;
}

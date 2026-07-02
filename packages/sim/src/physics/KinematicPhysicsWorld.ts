/**
 * Adaptador de físicas LIGERO y determinista (puro TS, sin WASM). Implementa el
 * puerto `IPhysicsWorld` con cuerpos esféricos pre-asignados y raycast matemático.
 *
 * V1-A/V1-B: el raycast de captura ahora (1) queda BLOQUEADO por los sólidos del mapa
 * (muros/props → oclusión real: no se caza a través de una caja) y (2) usa una esfera
 * de impacto POR POSE (agacharse/bolita baja y encoge el cuerpo → cubrirse tras una
 * caja baja funciona de verdad, porque el rayo con pitch lo intercepta el obstáculo).
 *
 * Mantiene arrays pre-asignados (cero asignaciones en `syncBodies`). Los obstáculos se
 * extraen UNA vez en el constructor (el mapa es estático). `RapierPhysicsWorld` lo
 * reemplazará cuando haga falta geometría compleja.
 *
 * Skills `workers-memory-optimization` (typed arrays pre-asignados, sin asignar en
 * caliente) + `authoritative-netcode` (impacto determinista en el servidor).
 */
import { raySphere, rayAABB } from '../core/collision';
import { isSolidZone, zoneYMin, zoneYMax, type MapData } from '../core/map/MapData';
import { POSE_BODY_CY, POSE_BODY_R } from '../core/pose';
import type { WorldState } from '../core/entities/WorldState';
import type { IPhysicsWorld, RaycastHit } from './IPhysicsWorld';

export class KinematicPhysicsWorld implements IPhysicsWorld {
  private readonly ids: string[];
  // Centros y radios de los cuerpos (esfera por pose a la altura del torso).
  private readonly cx: Float64Array;
  private readonly cy: Float64Array;
  private readonly cz: Float64Array;
  private readonly cr: Float64Array;
  private count: number;
  // Obstáculos sólidos del mapa (AABBs), extraídos una vez (mapa estático).
  private readonly obMinX: Float64Array;
  private readonly obMinY: Float64Array;
  private readonly obMinZ: Float64Array;
  private readonly obMaxX: Float64Array;
  private readonly obMaxY: Float64Array;
  private readonly obMaxZ: Float64Array;
  private readonly obCount: number;

  constructor(capacity = 16, map?: MapData) {
    this.ids = new Array<string>(capacity).fill('');
    this.cx = new Float64Array(capacity);
    this.cy = new Float64Array(capacity);
    this.cz = new Float64Array(capacity);
    this.cr = new Float64Array(capacity);
    this.count = 0;

    const solids = map ? map.zones.filter(isSolidZone) : [];
    this.obCount = solids.length;
    this.obMinX = new Float64Array(this.obCount);
    this.obMinY = new Float64Array(this.obCount);
    this.obMinZ = new Float64Array(this.obCount);
    this.obMaxX = new Float64Array(this.obCount);
    this.obMaxY = new Float64Array(this.obCount);
    this.obMaxZ = new Float64Array(this.obCount);
    for (let i = 0; i < this.obCount; i++) {
      const z = solids[i]!;
      this.obMinX[i] = z.minX;
      this.obMinY[i] = zoneYMin(z);
      this.obMinZ[i] = z.minZ;
      this.obMaxX[i] = z.maxX;
      this.obMaxY[i] = zoneYMax(z);
      this.obMaxZ[i] = z.maxZ;
    }
  }

  syncBodies(world: WorldState): void {
    const cap = this.ids.length;
    // Orden DETERMINISTA por id (no por orden de inserción del Map): garantiza que
    // cliente y servidor produzcan el mismo array y, por tanto, el mismo resultado
    // de raycast ante empates de distancia. Comparación por unidad de código (sin
    // locale) para que sea idéntica en todas las plataformas. syncBodies solo corre
    // en ticks con captura (poco frecuente), así que este sort no es camino caliente.
    const sorted = [...world.players.values()].sort((a, b) =>
      a.id < b.id ? -1 : a.id > b.id ? 1 : 0,
    );
    const n = sorted.length < cap ? sorted.length : cap;
    for (let i = 0; i < n; i++) {
      const p = sorted[i]!;
      this.ids[i] = p.id;
      this.cx[i] = p.pos.x;
      // Esfera de impacto POR POSE: agacharse/bolita baja el centro y encoge el radio
      // (abstracción del torso; los índices de pose están saneados por `step`).
      this.cy[i] = p.pos.y + (POSE_BODY_CY[p.pose] ?? POSE_BODY_CY[0]!);
      this.cz[i] = p.pos.z;
      this.cr[i] = POSE_BODY_R[p.pose] ?? POSE_BODY_R[0]!;
    }
    this.count = n;
  }

  raycastClosest(
    ox: number,
    oy: number,
    oz: number,
    dx: number,
    dy: number,
    dz: number,
    maxDist: number,
    excludePlayerId: string,
  ): RaycastHit | null {
    // 1) Distancia al primer obstáculo sólido (oclusión): nada detrás de él cuenta.
    let blockT = Infinity;
    for (let i = 0; i < this.obCount; i++) {
      const t = rayAABB(
        ox,
        oy,
        oz,
        dx,
        dy,
        dz,
        this.obMinX[i]!,
        this.obMinY[i]!,
        this.obMinZ[i]!,
        this.obMaxX[i]!,
        this.obMaxY[i]!,
        this.obMaxZ[i]!,
      );
      if (t !== null && t < blockT) blockT = t;
    }

    // 2) Jugador más cercano ANTES del bloqueo.
    let bestT = Infinity;
    let bestI = -1;
    for (let i = 0; i < this.count; i++) {
      if (this.ids[i]! === excludePlayerId) continue;
      const t = raySphere(ox, oy, oz, dx, dy, dz, this.cx[i]!, this.cy[i]!, this.cz[i]!, this.cr[i]!);
      if (t === null || t > maxDist) continue; // fuera de rango (inclusivo en el límite)
      if (t >= blockT) continue; // OCLUIDO: hay un sólido delante
      // `<` estricto: en empate de distancia gana el PRIMERO iterado. Como
      // syncBodies ordena por id, ese es el id menor — determinista en ambos lados.
      if (t < bestT) {
        bestT = t;
        bestI = i;
      }
    }
    if (bestI < 0) return null;
    // Asignación solo en impacto (acción de captura: poco frecuente, no por-tick).
    return { playerId: this.ids[bestI]!, distance: bestT };
  }

  dispose(): void {
    // no-op: no hay recursos WASM en el adaptador ligero.
  }
}
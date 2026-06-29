/**
 * Adaptador de físicas LIGERO y determinista (puro TS, sin WASM). Implementa el
 * puerto `IPhysicsWorld` con cuerpos esféricos pre-asignados y raycast matemático.
 *
 * Es lo que pide el Paso 2: "físicas ligeras, suficientes para no exceder la memoria
 * del isolate". Mantiene arrays pre-asignados (cero asignaciones en `syncBodies`,
 * que corre cada tick que haya una captura). `RapierPhysicsWorld` lo reemplazará
 * cuando haga falta colisión contra geometría compleja.
 *
 * Skills `workers-memory-optimization` (typed arrays pre-asignados, sin asignar en
 * caliente) + `authoritative-netcode` (impacto determinista en el servidor).
 */
import { raySphere } from '../core/collision';
import type { WorldState } from '../core/entities/WorldState';
import type { IPhysicsWorld, RaycastHit } from './IPhysicsWorld';

export class KinematicPhysicsWorld implements IPhysicsWorld {
  private readonly ids: string[];
  // Centros de los cuerpos (cápsula aproximada como esfera a la altura del torso).
  private readonly cx: Float64Array;
  private readonly cy: Float64Array;
  private readonly cz: Float64Array;
  private radius: number;
  private count: number;

  constructor(capacity = 16) {
    this.ids = new Array<string>(capacity).fill('');
    this.cx = new Float64Array(capacity);
    this.cy = new Float64Array(capacity);
    this.cz = new Float64Array(capacity);
    this.radius = 0.5;
    this.count = 0;
  }

  syncBodies(world: WorldState): void {
    this.radius = world.config.playerRadius;
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
      // El cuerpo se centra a la altura de los ojos: el rayo de captura es
      // horizontal a esa altura, así impacta limpio (abstracción del torso).
      this.cy[i] = p.pos.y + world.config.eyeHeight;
      this.cz[i] = p.pos.z;
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
    let bestT = Infinity;
    let bestI = -1;
    for (let i = 0; i < this.count; i++) {
      if (this.ids[i]! === excludePlayerId) continue;
      const t = raySphere(
        ox,
        oy,
        oz,
        dx,
        dy,
        dz,
        this.cx[i]!,
        this.cy[i]!,
        this.cz[i]!,
        this.radius,
      );
      if (t === null || t > maxDist) continue; // fuera de rango (inclusivo en el límite)
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

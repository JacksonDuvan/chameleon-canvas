import { describe, it, expect } from 'vitest';
import { initialWorld, type WorldState } from '../core/entities/WorldState';
import { PlayerState } from '../core/entities/PlayerState';
import { POSE_CROUCH } from '../core/pose';
import type { MapData } from '../core/map/MapData';
import { KinematicPhysicsWorld } from './KinematicPhysicsWorld';

const EYE = initialWorld().config.eyeHeight; // 1.5

/** Mapa mínimo con un único sólido (para probar oclusión). */
function mapWithSolid(minX: number, minZ: number, maxX: number, maxZ: number, height: number): MapData {
  return {
    id: 'm',
    bounds: { minX: -100, maxX: 100, minY: 0, maxY: 5, minZ: -100, maxZ: 100 },
    floorColor: 0xffffffff,
    zones: [
      { id: 'solid', kind: 'prop', minX, maxX, minZ, maxZ, y: height / 2, height, color: 0xffffffff, roughness: 1, metalness: 0 },
    ],
    spawns: [],
  };
}

/** Construye un mundo con jugadores en el ORDEN dado (orden de inserción del Map). */
function worldWith(specs: Array<{ id: string; x: number; z: number }>): WorldState {
  const w = initialWorld(1);
  for (const s of specs) {
    const p = new PlayerState(s.id, 'hider');
    p.pos.setMut(s.x, 0, s.z);
    w.players.set(s.id, p);
  }
  return w;
}

describe('KinematicPhysicsWorld.raycastClosest', () => {
  it('impacta al cuerpo más cercano en la dirección del rayo', () => {
    const w = worldWith([
      { id: 's', x: 0, z: 0 },
      { id: 'near', x: 3, z: 0 },
      { id: 'far', x: 8, z: 0 },
    ]);
    const phys = new KinematicPhysicsWorld();
    phys.syncBodies(w);
    const hit = phys.raycastClosest(0, EYE, 0, 1, 0, 0, 100, 's');
    expect(hit?.playerId).toBe('near');
  });

  it('excluye a quien dispara', () => {
    const w = worldWith([{ id: 's', x: 0, z: 0 }]);
    const phys = new KinematicPhysicsWorld();
    phys.syncBodies(w);
    // El propio tirador está en el origen; debe excluirse → sin impacto.
    expect(phys.raycastClosest(0, EYE, 0, 1, 0, 0, 100, 's')).toBeNull();
  });

  it('respeta maxDist (rango inclusivo)', () => {
    const w = worldWith([
      { id: 's', x: 0, z: 0 },
      { id: 'h', x: 10, z: 0 }, // superficie en x≈9.5
    ]);
    const phys = new KinematicPhysicsWorld();
    phys.syncBodies(w);
    expect(phys.raycastClosest(0, EYE, 0, 1, 0, 0, 5, 's')).toBeNull();
    expect(phys.raycastClosest(0, EYE, 0, 1, 0, 0, 100, 's')?.playerId).toBe('h');
  });

  it('DETERMINISMO: ante empate de distancia, la víctima NO depende del orden de inserción', () => {
    // 'a' y 'b' equidistantes del rayo +x (offset ±0.1 en z, dentro del radio 0.5).
    const specsAB = [
      { id: 's', x: 0, z: 0 },
      { id: 'a', x: 5, z: 0.1 },
      { id: 'b', x: 5, z: -0.1 },
    ];
    const specsBA = [
      { id: 's', x: 0, z: 0 },
      { id: 'b', x: 5, z: -0.1 },
      { id: 'a', x: 5, z: 0.1 },
    ];
    const physAB = new KinematicPhysicsWorld();
    physAB.syncBodies(worldWith(specsAB));
    const physBA = new KinematicPhysicsWorld();
    physBA.syncBodies(worldWith(specsBA));

    const hitAB = physAB.raycastClosest(0, EYE, 0, 1, 0, 0, 100, 's');
    const hitBA = physBA.raycastClosest(0, EYE, 0, 1, 0, 0, 100, 's');

    expect(hitAB?.playerId).toBe(hitBA?.playerId); // mismo resultado pese al orden
    expect(hitAB?.playerId).toBe('a'); // id menor gana el empate (determinista)
  });

  it('OCLUSIÓN (V1-A): un muro alto entre tirador y objetivo bloquea el rayo', () => {
    const w = worldWith([
      { id: 's', x: 0, z: 0 },
      { id: 'h', x: 6, z: 0 },
    ]);
    const blocked = new KinematicPhysicsWorld(16, mapWithSolid(2, -1, 3, 1, 3)); // muro h=3
    blocked.syncBodies(w);
    expect(blocked.raycastClosest(0, EYE, 0, 1, 0, 0, 100, 's')).toBeNull();

    const open = new KinematicPhysicsWorld(16, mapWithSolid(2, 5, 3, 7, 3)); // muro fuera del camino
    open.syncBodies(w);
    expect(open.raycastClosest(0, EYE, 0, 1, 0, 0, 100, 's')?.playerId).toBe('h');
  });

  it('POSE (V1-B): agachado tras una caja baja queda cubierto; de pie no', () => {
    const w = worldWith([
      { id: 's', x: 0, z: 0 },
      { id: 'h', x: 3, z: 0 },
    ]);
    const lowBox = mapWithSolid(1, -1, 2, 1, 1); // caja de 1 m entre ambos
    const h = w.players.get('h')!;

    // De pie (cuerpo centrado a 1.1): el rayo horizontal a 1.5 pasa POR ENCIMA de la
    // caja (top y=1) e impacta el torso.
    const phys = new KinematicPhysicsWorld(16, lowBox);
    phys.syncBodies(w);
    expect(phys.raycastClosest(0, EYE, 0, 1, 0, 0, 100, 's')?.playerId).toBe('h');

    // Agachado: el cuerpo baja (cy 0.55). El rayo horizontal ya no lo alcanza…
    h.pose = POSE_CROUCH;
    phys.syncBodies(w);
    expect(phys.raycastClosest(0, EYE, 0, 1, 0, 0, 100, 's')).toBeNull();

    // …y si el Seeker apunta HACIA ABAJO al torso agachado, la caja intercepta el rayo.
    const dx = 3;
    const dy = 0.55 - EYE;
    const inv = 1 / Math.hypot(dx, dy);
    expect(phys.raycastClosest(0, EYE, 0, dx * inv, dy * inv, 0, 100, 's')).toBeNull();

    // Sin la caja, ese mismo disparo en picado SÍ lo alcanza (la pose no es inmunidad).
    const openPhys = new KinematicPhysicsWorld(16);
    openPhys.syncBodies(w);
    expect(openPhys.raycastClosest(0, EYE, 0, dx * inv, dy * inv, 0, 100, 's')?.playerId).toBe('h');
  });
});

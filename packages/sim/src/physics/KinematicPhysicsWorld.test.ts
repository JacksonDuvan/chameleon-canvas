import { describe, it, expect } from 'vitest';
import { initialWorld, type WorldState } from '../core/entities/WorldState';
import { PlayerState } from '../core/entities/PlayerState';
import { KinematicPhysicsWorld } from './KinematicPhysicsWorld';

const EYE = initialWorld().config.eyeHeight; // 1.5

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
});

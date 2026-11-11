/**
 * Salto + muebles pisables + reparto de Seekers elegido por el host (playtest r6).
 * Todo determinista: mismas funciones en servidor y predicción del cliente.
 */
import { describe, it, expect } from 'vitest';
import { applyMovement, applyVertical, groundHeightAt, isStandable } from './movement';
import { PlayerState } from './entities/PlayerState';
import { initialWorld } from './entities/WorldState';
import { DEFAULT_SIM_CONFIG } from './config';
import { step } from './step';
import { makeRng } from './rng';
import { clampSeekerCount, defaultSeekerCount, spawnPlayer, startGame } from './phases';
import { KinematicPhysicsWorld } from '../physics/KinematicPhysicsWorld';
import type { MapData, MapZone } from './map/MapData';
import { ActionKind, type UserCommand } from '@shared/protocol';

const DT = 1 / 30;
const cfg = DEFAULT_SIM_CONFIG;

function zone(over: Partial<MapZone> & Pick<MapZone, 'id' | 'kind'>): MapZone {
  return { minX: 0, maxX: 0, minZ: 0, maxZ: 0, y: 0, height: 0, color: 0xffffffff, roughness: 1, metalness: 0, ...over };
}
/** Mapa plano con una MESA (prop 0.75 m) en x∈[2,3.6] y un MURO (3 m) en x∈[6,6.6]. */
const MAP: MapData = {
  id: 'jump-test',
  bounds: cfg.bounds,
  floorColor: 0xffffffff,
  zones: [
    zone({ id: 'desk', kind: 'prop', minX: 2, maxX: 3.6, minZ: -0.4, maxZ: 0.4, y: 0.375, height: 0.75 }),
    zone({ id: 'wall', kind: 'wall', minX: 6, maxX: 6.6, minZ: -5, maxZ: 5, y: 1.5, height: 3 }),
  ],
  spawns: [{ x: 0, y: 0, z: 0 }],
};

function cmd(playerId: string, over: Partial<UserCommand> = {}): UserCommand {
  return { seq: 1, playerId, moveX: 0, moveZ: 0, aimX: 0, aimY: 0, aimZ: 1, pose: 0, action: ActionKind.NONE, jump: false, ...over };
}

/** Simula hasta aterrizar; devuelve la altura máxima alcanzada. */
function apex(p: PlayerState): number {
  let max = p.pos.y;
  applyVertical(p, true, cfg, DT, MAP);
  for (let i = 0; i < 200 && !p.grounded; i++) {
    max = Math.max(max, p.pos.y);
    applyVertical(p, false, cfg, DT, MAP);
  }
  return max;
}

describe('applyVertical (salto y gravedad)', () => {
  it('en reposo se queda en el suelo, apoyado y sin velocidad', () => {
    const p = new PlayerState('h', 'hider');
    for (let i = 0; i < 30; i++) applyVertical(p, false, cfg, DT, MAP);
    expect(p.pos.y).toBe(0);
    expect(p.vy).toBe(0);
    expect(p.grounded).toBe(true);
  });

  it('el Hider salta ~1.3 m: llega a mesas/cajas pero no a un archivador', () => {
    const p = new PlayerState('h', 'hider');
    const h = apex(p);
    expect(h).toBeGreaterThan(1.1); // caja (1.1 m) alcanzable
    expect(h).toBeLessThan(1.4); // barril/terminal (1.4 m) NO
    expect(p.grounded).toBe(true);
    expect(p.pos.y).toBe(0);
  });

  it('el Seeker salta MUCHO más alto: sus ojos pasan por encima de los muros de 3 m', () => {
    const p = new PlayerState('s', 'seeker');
    const h = apex(p);
    expect(h + cfg.eyeHeight).toBeGreaterThan(4.5);
    expect(h).toBeLessThanOrEqual(cfg.bounds.maxY);
  });

  it('no hay doble salto en el aire', () => {
    const p = new PlayerState('h', 'hider');
    applyVertical(p, true, cfg, DT, MAP);
    const vy = p.vy;
    applyVertical(p, true, cfg, DT, MAP); // sigue pulsando: no re-impulsa
    expect(p.vy).toBeLessThan(vy);
  });

  it('es determinista: misma secuencia ⇒ mismo estado', () => {
    const a = new PlayerState('a', 'seeker');
    const b = new PlayerState('b', 'seeker');
    for (let i = 0; i < 40; i++) {
      applyVertical(a, i % 7 === 0, cfg, DT, MAP);
      applyVertical(b, i % 7 === 0, cfg, DT, MAP);
    }
    expect(a.pos.y).toBe(b.pos.y);
    expect(a.vy).toBe(b.vy);
  });
});

describe('muebles pisables', () => {
  it('solo los props son pisables; los muros nunca', () => {
    expect(isStandable(MAP.zones[0]!)).toBe(true);
    expect(isStandable(MAP.zones[1]!)).toBe(false);
  });

  it('groundHeightAt: tope del mueble solo si los pies ya están a su altura', () => {
    expect(groundHeightAt(MAP, 2.8, 0, 0)).toBe(0); // en el suelo: la mesa no es apoyo
    expect(groundHeightAt(MAP, 2.8, 0, 0.75)).toBe(0.75);
    expect(groundHeightAt(MAP, 2.8, 0, 2)).toBe(0.75);
    expect(groundHeightAt(MAP, 0, 0, 2)).toBe(0); // fuera de la mesa
  });

  it('a ras de suelo la mesa sigue siendo un obstáculo', () => {
    const p = new PlayerState('h', 'hider');
    p.pos.setMut(1.2, 0, 0);
    for (let i = 0; i < 30; i++) applyMovement(p, cmd('h', { moveX: 1 }), cfg, DT, MAP);
    expect(p.pos.x).toBeLessThanOrEqual(2 - cfg.playerRadius + 1e-9);
  });

  it('saltando hacia la mesa el Hider aterriza ENCIMA y se queda ahí', () => {
    const p = new PlayerState('h', 'hider');
    p.pos.setMut(1.2, 0, 0);
    for (let i = 0; i < 40; i++) {
      const c = cmd('h', { moveX: p.pos.x < 2.8 ? 1 : 0 });
      applyMovement(p, c, cfg, DT, MAP);
      applyVertical(p, i === 0, cfg, DT, MAP);
    }
    expect(p.grounded).toBe(true);
    expect(p.pos.y).toBeCloseTo(0.75, 6);
    expect(p.pos.x).toBeGreaterThan(2);
  });

  it('al salir del borde del mueble cae al suelo', () => {
    const p = new PlayerState('h', 'hider');
    p.pos.setMut(2.8, 0.75, 0);
    for (let i = 0; i < 60; i++) {
      applyMovement(p, cmd('h', { moveX: -1 }), cfg, DT, MAP);
      applyVertical(p, false, cfg, DT, MAP);
    }
    expect(p.pos.y).toBe(0);
    expect(p.grounded).toBe(true);
  });

  it('ni el salto alto del Seeker cruza un muro', () => {
    const p = new PlayerState('s', 'seeker');
    p.pos.setMut(5, 0, 0);
    for (let i = 0; i < 90; i++) {
      applyMovement(p, cmd('s', { moveX: 1 }), cfg, DT, MAP);
      applyVertical(p, true, cfg, DT, MAP);
    }
    expect(p.pos.x).toBeLessThanOrEqual(6 - cfg.playerRadius + 1e-9);
  });
});

describe('step + salto', () => {
  const physics = new KinematicPhysicsWorld(8, MAP);
  const rng = makeRng(1);

  it('solo salta quien puede moverse; un Hider congelado en el aire CAE', () => {
    const w = initialWorld(1);
    const h = spawnPlayer(w, 'h');
    w.phase = 'prep';
    step(w, [cmd('h', { jump: true })], DT, rng, physics, MAP);
    expect(h.grounded).toBe(false);
    expect(h.pos.y).toBeGreaterThan(0);
    // Empieza la caza con el Hider en el aire: queda congelado pero la gravedad sigue.
    w.phase = 'hunt';
    h.frozen = true;
    for (let i = 0; i < 60; i++) step(w, [cmd('h', { jump: true })], DT, rng, physics, MAP);
    expect(h.pos.y).toBe(0);
    expect(h.grounded).toBe(true);
  });

  it('en el lobby nadie salta', () => {
    const w = initialWorld(1);
    const h = spawnPlayer(w, 'h');
    step(w, [cmd('h', { jump: true })], DT, rng, physics, MAP);
    expect(h.pos.y).toBe(0);
  });

  it('un jugador en el aire que deja de mandar comandos acaba cayendo', () => {
    const w = initialWorld(1);
    const s = spawnPlayer(w, 's');
    s.role = 'seeker';
    w.phase = 'hunt';
    step(w, [cmd('s', { jump: true })], DT, rng, physics, MAP);
    expect(s.grounded).toBe(false);
    for (let i = 0; i < 120; i++) step(w, [], DT, rng, physics, MAP);
    expect(s.pos.y).toBe(0);
    expect(s.grounded).toBe(true);
  });
});

describe('reparto de Seekers elegido por el host', () => {
  it('clampSeekerCount: entre 1 y jugadores−1; sin valor ⇒ automático', () => {
    expect(clampSeekerCount(undefined, 8)).toBe(defaultSeekerCount(8));
    expect(clampSeekerCount(3, 8)).toBe(3);
    expect(clampSeekerCount(0, 8)).toBe(1);
    expect(clampSeekerCount(-4, 8)).toBe(1);
    expect(clampSeekerCount(99, 8)).toBe(7); // siempre queda un Hider
    expect(clampSeekerCount(2.5, 8)).toBe(defaultSeekerCount(8));
    expect(clampSeekerCount(5, 2)).toBe(1);
  });

  it('startGame respeta la cantidad pedida', () => {
    for (const want of [1, 2, 3, 5]) {
      const w = initialWorld(7);
      for (let i = 0; i < 6; i++) spawnPlayer(w, `p${i}`);
      startGame(w, makeRng(w.seed), want);
      let seekers = 0;
      for (const p of w.players.values()) if (p.role === 'seeker') seekers++;
      expect(seekers).toBe(want);
    }
  });
});

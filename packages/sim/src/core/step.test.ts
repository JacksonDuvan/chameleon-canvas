import { describe, it, expect } from 'vitest';
import { initialWorld, type WorldState } from './entities/WorldState';
import { PlayerState } from './entities/PlayerState';
import { makeRng } from './rng';
import { step } from './step';
import { KinematicPhysicsWorld } from '../physics/KinematicPhysicsWorld';
import { ActionKind, type GamePhase, type UserCommand } from '@shared/protocol';

const DT = 1 / 30;
const rng = makeRng(1);
const physics = new KinematicPhysicsWorld();

function mkCmd(playerId: string, over: Partial<UserCommand> = {}): UserCommand {
  return {
    seq: 1,
    playerId,
    moveX: 0,
    moveZ: 0,
    aimX: 0,
    aimZ: 1,
    action: ActionKind.NONE,
    ...over,
  };
}

function worldInPhase(
  phase: GamePhase,
  players: Array<{ id: string; role: 'hider' | 'seeker'; x?: number; z?: number; frozen?: boolean }>,
): WorldState {
  const w = initialWorld(1);
  w.phase = phase;
  for (const spec of players) {
    const p = new PlayerState(spec.id, spec.role);
    p.pos.setMut(spec.x ?? 0, 0, spec.z ?? 0);
    p.frozen = spec.frozen ?? false;
    w.players.set(spec.id, p);
  }
  return w;
}

describe('step — bucle', () => {
  it('incrementa el tick en 1', () => {
    const w = worldInPhase('lobby', []);
    step(w, [], DT, rng, physics);
    expect(w.tick).toBe(1);
  });

  it('estampa lastProcessedInput con el seq del comando', () => {
    const w = worldInPhase('prep', [{ id: 'h', role: 'hider' }]);
    step(w, [mkCmd('h', { seq: 42 })], DT, rng, physics);
    expect(w.players.get('h')!.lastProcessedInput).toBe(42);
  });
});

describe('step — movimiento y anti-trampas', () => {
  it('un Hider se mueve en Prep a velocidad máxima', () => {
    const w = worldInPhase('prep', [{ id: 'h', role: 'hider' }]);
    step(w, [mkCmd('h', { moveX: 1 })], DT, rng, physics);
    expect(w.players.get('h')!.pos.x).toBeCloseTo(w.config.maxSpeed * DT, 9);
  });

  it('clampa la intención: moverse en diagonal no es más rápido que el máximo', () => {
    const w = worldInPhase('prep', [{ id: 'h', role: 'hider' }]);
    step(w, [mkCmd('h', { moveX: 1, moveZ: 1 })], DT, rng, physics);
    const p = w.players.get('h')!;
    const speed = Math.sqrt(p.pos.x ** 2 + p.pos.z ** 2) / DT;
    expect(speed).toBeCloseTo(w.config.maxSpeed, 6);
  });

  it('un Seeker NO se mueve en Prep (espera a ciegas)', () => {
    const w = worldInPhase('prep', [{ id: 's', role: 'seeker' }]);
    step(w, [mkCmd('s', { moveX: 1 })], DT, rng, physics);
    expect(w.players.get('s')!.pos.x).toBe(0);
  });

  it('en Hunt: el Hider congelado no se mueve y el Seeker sí', () => {
    const w = worldInPhase('hunt', [
      { id: 'h', role: 'hider', frozen: true },
      { id: 's', role: 'seeker' },
    ]);
    step(w, [mkCmd('h', { moveX: 1 }), mkCmd('s', { moveX: 1 })], DT, rng, physics);
    expect(w.players.get('h')!.pos.x).toBe(0);
    expect(w.players.get('s')!.pos.x).toBeCloseTo(w.config.maxSpeed * DT, 9);
  });

  it('clampa la posición a los límites del escenario', () => {
    const w = worldInPhase('prep', [{ id: 'h', role: 'hider', x: 19.9 }]);
    // empuja repetidamente contra el borde +x (max 20)
    for (let i = 0; i < 100; i++) step(w, [mkCmd('h', { moveX: 1 })], DT, rng, physics);
    expect(w.players.get('h')!.pos.x).toBe(w.config.bounds.maxX);
  });
});

describe('step — captura (disparo del Seeker)', () => {
  it('el Seeker atrapa a un Hider en rango y este pasa a Seeker', () => {
    const w = worldInPhase('hunt', [
      { id: 's', role: 'seeker', x: 0 },
      { id: 'h', role: 'hider', x: 2, frozen: true },
    ]);
    step(w, [mkCmd('s', { aimX: 1, aimZ: 0, action: ActionKind.CATCH })], DT, rng, physics);
    const h = w.players.get('h')!;
    expect(h.caught).toBe(true);
    expect(h.role).toBe('seeker');
    expect(h.frozen).toBe(false);
  });

  it('no atrapa si el Hider está fuera de alcance', () => {
    const w = worldInPhase('hunt', [
      { id: 's', role: 'seeker', x: 0 },
      { id: 'h', role: 'hider', x: 10, frozen: true }, // > catchRange (3)
    ]);
    step(w, [mkCmd('s', { aimX: 1, aimZ: 0, action: ActionKind.CATCH })], DT, rng, physics);
    expect(w.players.get('h')!.caught).toBe(false);
  });

  it('no atrapa si apunta en otra dirección', () => {
    const w = worldInPhase('hunt', [
      { id: 's', role: 'seeker', x: 0 },
      { id: 'h', role: 'hider', x: 2, frozen: true },
    ]);
    step(w, [mkCmd('s', { aimX: -1, aimZ: 0, action: ActionKind.CATCH })], DT, rng, physics);
    expect(w.players.get('h')!.caught).toBe(false);
  });

  it('CATCH no tiene efecto fuera de la Hunt Phase', () => {
    const w = worldInPhase('prep', [
      { id: 's', role: 'seeker', x: 0 },
      { id: 'h', role: 'hider', x: 2 },
    ]);
    step(w, [mkCmd('s', { aimX: 1, aimZ: 0, action: ActionKind.CATCH })], DT, rng, physics);
    expect(w.players.get('h')!.caught).toBe(false);
  });

  it('normaliza el apunte del cliente: una diagonal sin normalizar igual impacta', () => {
    const w = worldInPhase('hunt', [
      { id: 's', role: 'seeker', x: 0 },
      { id: 'h', role: 'hider', x: 2, z: 2, frozen: true },
    ]);
    // aim diagonal SIN normalizar (||(5,5)|| ≈ 7.07); el servidor debe normalizarlo.
    step(w, [mkCmd('s', { aimX: 5, aimZ: 5, action: ActionKind.CATCH })], DT, rng, physics);
    expect(w.players.get('h')!.caught).toBe(true);
  });
});

describe('step — FREEZE', () => {
  it('FREEZE congela la pose del Hider', () => {
    const w = worldInPhase('prep', [{ id: 'h', role: 'hider' }]);
    step(w, [mkCmd('h', { action: ActionKind.FREEZE })], DT, rng, physics);
    expect(w.players.get('h')!.frozen).toBe(true);
  });
});

describe('step — determinismo', () => {
  function serialize(w: WorldState) {
    return {
      tick: w.tick,
      phase: w.phase,
      outcome: w.outcome,
      players: [...w.players.values()]
        .sort((a, b) => a.id.localeCompare(b.id))
        .map((p) => ({
          id: p.id,
          role: p.role,
          caught: p.caught,
          x: p.pos.x,
          z: p.pos.z,
          lpi: p.lastProcessedInput,
        })),
    };
  }

  it('mismas entradas ⇒ mismo estado, en dos mundos independientes', () => {
    const make = () =>
      worldInPhase('hunt', [
        { id: 's', role: 'seeker', x: 0 },
        { id: 'h', role: 'hider', x: 2, frozen: true },
      ]);
    const a = make();
    const b = make();
    const cmds = (seq: number): UserCommand[] => [
      mkCmd('s', { seq, moveX: 1, aimX: 1, aimZ: 0, action: seq === 5 ? ActionKind.CATCH : ActionKind.NONE }),
    ];
    const rngA = makeRng(7);
    const rngB = makeRng(7);
    const physA = new KinematicPhysicsWorld();
    const physB = new KinematicPhysicsWorld();
    for (let t = 1; t <= 10; t++) {
      step(a, cmds(t), DT, rngA, physA);
      step(b, cmds(t), DT, rngB, physB);
    }
    expect(serialize(a)).toEqual(serialize(b));
    expect(a.players.get('h')!.role).toBe('seeker'); // fue atrapado en el tick 5
  });
});

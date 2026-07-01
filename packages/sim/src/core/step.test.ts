import { describe, it, expect } from 'vitest';
import { initialWorld, type WorldState } from './entities/WorldState';
import { PlayerState } from './entities/PlayerState';
import { makeRng } from './rng';
import { step } from './step';
import type { MapData } from './map/MapData';
import { KinematicPhysicsWorld } from '../physics/KinematicPhysicsWorld';
import { ActionKind, type GamePhase, type UserCommand } from '@shared/protocol';

const DT = 1 / 30;
const rng = makeRng(1);
const physics = new KinematicPhysicsWorld();

/** Color empaquetado 0xRRGGBBAA (alpha 255). */
function packColor(r: number, g: number, b: number): number {
  return ((r << 24) | (g << 16) | (b << 8) | 0xff) >>> 0;
}
/** Mapa plano de un solo color (para controlar el camuflaje en los tests de captura). */
function flatMap(packed: number): MapData {
  return {
    id: 'flat',
    bounds: { minX: -100, maxX: 100, minY: 0, maxY: 5, minZ: -100, maxZ: 100 },
    floorColor: packed,
    zones: [],
    spawns: [],
  };
}
// El Hider por defecto es BLANCO (biblia: "camaleón blanco puro"). Sobre suelo NEGRO
// (MAP_VISIBLE) resalta → camoScore 0 → fijación mínima; sobre suelo BLANCO (MAP_CAMO)
// se funde → camoScore 1 → fijación máxima.
const MAP_VISIBLE = flatMap(packColor(0, 0, 0));
const MAP_CAMO = flatMap(packColor(255, 255, 255));

/** Mantiene el gatillo (CATCH) del Seeker apuntando a +x durante `ticks` ticks. */
function holdCatch(w: WorldState, seekerId: string, ticks: number, map: MapData): void {
  for (let i = 0; i < ticks; i++) {
    step(w, [mkCmd(seekerId, { aimX: 1, aimZ: 0, action: ActionKind.CATCH })], DT, rng, physics, map);
  }
}

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
  players: Array<{
    id: string;
    role: 'hider' | 'seeker';
    x?: number;
    z?: number;
    frozen?: boolean;
    color?: readonly [number, number, number];
  }>,
): WorldState {
  const w = initialWorld(1);
  w.phase = phase;
  for (const spec of players) {
    const p = new PlayerState(spec.id, spec.role);
    p.pos.setMut(spec.x ?? 0, 0, spec.z ?? 0);
    p.frozen = spec.frozen ?? false;
    if (spec.color) p.color.setMut(spec.color[0], spec.color[1], spec.color[2]);
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

describe('step — captura por fijación (P0.3, híbrido)', () => {
  it('un objetivo VISIBLE cae casi al instante manteniendo el gatillo', () => {
    const w = worldInPhase('hunt', [
      { id: 's', role: 'seeker', x: 0 },
      { id: 'h', role: 'hider', x: 2, frozen: true },
    ]);
    holdCatch(w, 's', 3, MAP_VISIBLE); // camoScore 0 → fijación mínima (2)
    const h = w.players.get('h')!;
    expect(h.caught).toBe(true);
    expect(h.role).toBe('seeker');
    expect(h.frozen).toBe(false);
  });

  it('un objetivo bien camuflado y quieto RESISTE una fijación corta', () => {
    const w = worldInPhase('hunt', [
      { id: 's', role: 'seeker', x: 0 },
      { id: 'h', role: 'hider', x: 2, frozen: true },
    ]);
    holdCatch(w, 's', 10, MAP_CAMO); // camoScore 1 → requiere ~75 ticks
    expect(w.players.get('h')!.caught).toBe(false);
  });

  it('el mismo objetivo camuflado SÍ cae si el Seeker sostiene la mira lo suficiente', () => {
    const w = worldInPhase('hunt', [
      { id: 's', role: 'seeker', x: 0 },
      { id: 'h', role: 'hider', x: 2, frozen: true },
    ]);
    holdCatch(w, 's', 80, MAP_CAMO); // > fijación máxima (75)
    expect(w.players.get('h')!.caught).toBe(true);
  });

  it('soltar el gatillo REINICIA la fijación (hay que sostenerla sin interrupción)', () => {
    const w = worldInPhase('hunt', [
      { id: 's', role: 'seeker', x: 0 },
      { id: 'h', role: 'hider', x: 2, frozen: true },
    ]);
    holdCatch(w, 's', 40, MAP_CAMO); // acumula, pero < 75
    step(w, [mkCmd('s', { aimX: 1, aimZ: 0, action: ActionKind.NONE })], DT, rng, physics, MAP_CAMO); // suelta
    expect(w.players.get('s')!.lockTicks).toBe(0);
    holdCatch(w, 's', 40, MAP_CAMO); // reempieza de 0 → sigue sin llegar a 75
    expect(w.players.get('h')!.caught).toBe(false);
  });

  it('marca beingWatched en el objetivo mientras el Seeker lo fija, y lo limpia al soltar', () => {
    const w = worldInPhase('hunt', [
      { id: 's', role: 'seeker', x: 0 },
      { id: 'h', role: 'hider', x: 2, frozen: true },
    ]);
    holdCatch(w, 's', 5, MAP_CAMO);
    expect(w.players.get('h')!.beingWatched).toBe(true);
    step(w, [mkCmd('s', { aimX: 1, aimZ: 0, action: ActionKind.NONE })], DT, rng, physics, MAP_CAMO);
    expect(w.players.get('h')!.beingWatched).toBe(false);
  });

  it('no atrapa si el Hider está fuera de alcance', () => {
    const w = worldInPhase('hunt', [
      { id: 's', role: 'seeker', x: 0 },
      { id: 'h', role: 'hider', x: 10, frozen: true }, // > catchRange (3)
    ]);
    holdCatch(w, 's', 10, MAP_VISIBLE);
    expect(w.players.get('h')!.caught).toBe(false);
  });

  it('no atrapa si apunta en otra dirección', () => {
    const w = worldInPhase('hunt', [
      { id: 's', role: 'seeker', x: 0 },
      { id: 'h', role: 'hider', x: 2, frozen: true },
    ]);
    for (let i = 0; i < 10; i++) {
      step(w, [mkCmd('s', { aimX: -1, aimZ: 0, action: ActionKind.CATCH })], DT, rng, physics, MAP_VISIBLE);
    }
    expect(w.players.get('h')!.caught).toBe(false);
  });

  it('CATCH no tiene efecto fuera de la Hunt Phase', () => {
    const w = worldInPhase('prep', [
      { id: 's', role: 'seeker', x: 0 },
      { id: 'h', role: 'hider', x: 2 },
    ]);
    holdCatch(w, 's', 10, MAP_VISIBLE);
    expect(w.players.get('h')!.caught).toBe(false);
  });
});

describe('step — camuflaje (P0.2)', () => {
  it('un Hider con color igual al suelo y quieto tiene camoScore alto; opuesto, bajo', () => {
    const camo = worldInPhase('hunt', [{ id: 'h', role: 'hider', x: 2, frozen: true }]);
    step(camo, [], DT, rng, physics, MAP_CAMO); // negro sobre negro
    expect(camo.players.get('h')!.camoScore).toBeCloseTo(1, 6);

    const vis = worldInPhase('hunt', [{ id: 'h', role: 'hider', x: 2, frozen: true }]);
    step(vis, [], DT, rng, physics, MAP_VISIBLE); // negro sobre blanco
    expect(vis.players.get('h')!.camoScore).toBeCloseTo(0, 6);
  });

  it('el Seeker no tiene camoScore (0)', () => {
    const w = worldInPhase('hunt', [{ id: 's', role: 'seeker' }]);
    step(w, [], DT, rng, physics, MAP_CAMO);
    expect(w.players.get('s')!.camoScore).toBe(0);
  });

  it('la velocidad no se arrastra: dejar de mandar comando ⇒ no penaliza por movimiento', () => {
    const w = worldInPhase('prep', [{ id: 'h', role: 'hider' }]); // Hider blanco sobre suelo blanco
    // Tick 1: se mueve → penalizado por movimiento (camoScore bajo aunque el color encaje).
    step(w, [mkCmd('h', { moveX: 1 })], DT, rng, physics, MAP_CAMO);
    expect(w.players.get('h')!.camoScore).toBeLessThan(0.5);
    // Tick 2: NO manda comando (p. ej. pérdida de paquete) → debe contar como quieto.
    step(w, [], DT, rng, physics, MAP_CAMO);
    expect(w.players.get('h')!.camoScore).toBeCloseTo(1, 6);
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
          camo: p.camoScore,
          lock: p.lockTicks,
          watched: p.beingWatched,
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
    // El Seeker mantiene el gatillo desde el tick 3; objetivo VISIBLE → cae rápido.
    const cmds = (seq: number): UserCommand[] => [
      mkCmd('s', { seq, aimX: 1, aimZ: 0, action: seq >= 3 ? ActionKind.CATCH : ActionKind.NONE }),
    ];
    const rngA = makeRng(7);
    const rngB = makeRng(7);
    const physA = new KinematicPhysicsWorld();
    const physB = new KinematicPhysicsWorld();
    for (let t = 1; t <= 10; t++) {
      step(a, cmds(t), DT, rngA, physA, MAP_VISIBLE);
      step(b, cmds(t), DT, rngB, physB, MAP_VISIBLE);
    }
    expect(serialize(a)).toEqual(serialize(b));
    expect(a.players.get('h')!.role).toBe('seeker'); // fue atrapado al sostener la mira
  });
});

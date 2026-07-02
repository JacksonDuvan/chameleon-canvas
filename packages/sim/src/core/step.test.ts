import { describe, it, expect } from 'vitest';
import { initialWorld, type WorldState } from './entities/WorldState';
import { PlayerState } from './entities/PlayerState';
import { DEFAULT_SIM_CONFIG, type SimConfig } from './config';
import { makeRng } from './rng';
import { step } from './step';
import type { MapData } from './map/MapData';
import { KinematicPhysicsWorld } from '../physics/KinematicPhysicsWorld';
import { ActionKind, type GamePhase, type UserCommand } from '@shared/protocol';

const DT = 1 / 30;
const rng = makeRng(1);
const physics = new KinematicPhysicsWorld();
// Modo de munición LIMITADA del original (update 2.3.0): opción del host, no el default.
const LIMITED_CFG: SimConfig = { ...DEFAULT_SIM_CONFIG, ammoLimitEnabled: true };

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
// (MAP_VISIBLE) resalta (camoScore 0); sobre suelo BLANCO (MAP_CAMO) se funde
// (camoScore 1). El camuflaje NO modula el disparo: engaña al ojo, no al rayo.
const MAP_VISIBLE = flatMap(packColor(0, 0, 0));
const MAP_CAMO = flatMap(packColor(255, 255, 255));

/** Un tick con DISPARO del Seeker apuntando a +x. */
function shoot(w: WorldState, seekerId: string, map: MapData): void {
  step(w, [mkCmd(seekerId, { aimX: 1, aimZ: 0, action: ActionKind.CATCH })], DT, rng, physics, map);
}

function mkCmd(playerId: string, over: Partial<UserCommand> = {}): UserCommand {
  return {
    seq: 1,
    playerId,
    moveX: 0,
    moveZ: 0,
    aimX: 0,
    aimY: 0,
    aimZ: 1,
    pose: 0,
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
  cfg: SimConfig = DEFAULT_SIM_CONFIG,
): WorldState {
  const w = initialWorld(1, cfg);
  w.phase = phase;
  for (const spec of players) {
    const p = new PlayerState(spec.id, spec.role);
    p.pos.setMut(spec.x ?? 0, 0, spec.z ?? 0);
    p.frozen = spec.frozen ?? false;
    if (spec.color) p.color.setMut(spec.color[0], spec.color[1], spec.color[2]);
    // Como en startGame: los Seekers entran con munición (economía de disparos).
    if (spec.role === 'seeker') p.ammo = w.config.shotAmmo;
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

describe('step — disparos (modelo del original: tag por impacto)', () => {
  it('un disparo certero atrapa al Hider AL INSTANTE (pasa a Seeker con munición)', () => {
    const w = worldInPhase('hunt', [
      { id: 's', role: 'seeker', x: 0 },
      { id: 'h', role: 'hider', x: 2, frozen: true },
    ]);
    shoot(w, 's', MAP_VISIBLE); // 1 solo disparo
    const h = w.players.get('h')!;
    expect(h.caught).toBe(true);
    expect(h.role).toBe('seeker');
    expect(h.frozen).toBe(false);
    expect(h.ammo).toBe(w.config.shotAmmo); // el convertido recibe munición
  });

  it('el camuflaje perfecto NO protege de un disparo certero (engaña al ojo, no al rayo)', () => {
    const w = worldInPhase('hunt', [
      { id: 's', role: 'seeker', x: 0 },
      { id: 'h', role: 'hider', x: 2, frozen: true },
    ]);
    shoot(w, 's', MAP_CAMO); // Hider blanco sobre blanco (camo 1): igual cae si le aciertan
    expect(w.players.get('h')!.caught).toBe(true);
  });

  it('por defecto la munición es ILIMITADA: fallar no la gasta (como el juego base)', () => {
    const w = worldInPhase('hunt', [
      { id: 's', role: 'seeker', x: 0 },
      { id: 'h', role: 'hider', x: 2, z: 10, frozen: true }, // fuera de la línea de tiro
    ]);
    shoot(w, 's', MAP_VISIBLE);
    expect(w.players.get('s')!.ammo).toBe(w.config.shotAmmo); // intacta
    expect(w.players.get('h')!.caught).toBe(false);
  });

  it('COOLDOWN: un segundo disparo inmediato se ignora; pasado el cooldown vuelve a tirar', () => {
    const w = worldInPhase('hunt', [
      { id: 's', role: 'seeker', x: 0 },
      { id: 'h', role: 'hider', x: 2, frozen: true },
    ]);
    // Aparta al hider de la línea de tiro para el primer disparo (fallo intencional).
    w.players.get('h')!.pos.setMut(2, 0, 10);
    shoot(w, 's', MAP_VISIBLE); // dispara (falla) → cooldown activo
    // Recoloca al hider EN la línea de tiro: el disparo en cooldown NO debe atraparlo.
    w.players.get('h')!.pos.setMut(2, 0, 0);
    shoot(w, 's', MAP_VISIBLE);
    expect(w.players.get('h')!.caught).toBe(false); // dentro del cooldown: no hubo tiro
    // Pasado el cooldown, vuelve a poder disparar (y ahora sí lo atrapa).
    for (let i = 0; i < w.config.shotCooldownTicks; i++) step(w, [], DT, rng, physics, MAP_VISIBLE);
    shoot(w, 's', MAP_VISIBLE);
    expect(w.players.get('h')!.caught).toBe(true);
  });

  it('no atrapa si el Hider está fuera de alcance', () => {
    const w = worldInPhase('hunt', [
      { id: 's', role: 'seeker', x: 0 },
      { id: 'h', role: 'hider', x: 50, frozen: true }, // > catchRange (30, alcance de arma)
    ]);
    shoot(w, 's', MAP_VISIBLE);
    expect(w.players.get('h')!.caught).toBe(false);
  });

  it('no atrapa si apunta en otra dirección', () => {
    const w = worldInPhase('hunt', [
      { id: 's', role: 'seeker', x: 0 },
      { id: 'h', role: 'hider', x: 2, frozen: true },
    ]);
    step(w, [mkCmd('s', { aimX: -1, aimZ: 0, action: ActionKind.CATCH })], DT, rng, physics, MAP_VISIBLE);
    expect(w.players.get('h')!.caught).toBe(false);
  });

  it('CATCH no tiene efecto fuera de la Hunt Phase', () => {
    const w = worldInPhase('prep', [
      { id: 's', role: 'seeker', x: 0 },
      { id: 'h', role: 'hider', x: 2 },
    ]);
    shoot(w, 's', MAP_VISIBLE);
    expect(w.players.get('h')!.caught).toBe(false);
    expect(w.players.get('s')!.ammo).toBe(w.config.shotAmmo); // ni gasta munición
  });
});

describe('step — modo de munición LIMITADA (opción del host, como el 2.3.0 del original)', () => {
  it('FALLAR cuesta 1 bala; ACERTAR es gratis', () => {
    const w = worldInPhase(
      'hunt',
      [
        { id: 's', role: 'seeker', x: 0 },
        { id: 'h', role: 'hider', x: 2, z: 10, frozen: true }, // fuera de la línea de tiro
      ],
      LIMITED_CFG,
    );
    shoot(w, 's', MAP_VISIBLE); // fallo
    expect(w.players.get('s')!.ammo).toBe(LIMITED_CFG.shotAmmo - 1);

    // Pasado el cooldown, recoloca al hider EN la línea y acierta: no gasta.
    for (let i = 0; i < w.config.shotCooldownTicks; i++) step(w, [], DT, rng, physics, MAP_VISIBLE);
    w.players.get('h')!.pos.setMut(2, 0, 0);
    shoot(w, 's', MAP_VISIBLE);
    expect(w.players.get('h')!.caught).toBe(true);
    expect(w.players.get('s')!.ammo).toBe(LIMITED_CFG.shotAmmo - 1); // el acierto fue gratis
  });

  it('sin munición NO hay disparo', () => {
    const w = worldInPhase(
      'hunt',
      [
        { id: 's', role: 'seeker', x: 0 },
        { id: 'h', role: 'hider', x: 2, frozen: true },
        { id: 's2', role: 'seeker', x: -5 }, // conserva balas: la ronda no termina
      ],
      LIMITED_CFG,
    );
    w.players.get('s')!.ammo = 0;
    shoot(w, 's', MAP_VISIBLE);
    expect(w.players.get('h')!.caught).toBe(false);
  });

  it('si TODOS los Seekers llegan a 0 balas, los Hiders ganan AL INSTANTE', () => {
    const w = worldInPhase(
      'hunt',
      [
        { id: 's', role: 'seeker', x: 0 },
        { id: 'h', role: 'hider', x: 2, z: 10, frozen: true }, // sobrevive lejos
      ],
      LIMITED_CFG,
    );
    w.players.get('s')!.ammo = 1; // última bala
    shoot(w, 's', MAP_VISIBLE); // falla → 0 balas en todo el bando Seeker
    expect(w.phase).toBe('ended');
    expect(w.outcome).toBe('hiders');
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

describe('step — sin congelado voluntario (regresión del playtest)', () => {
  it('la acción FREEZE ya NO congela (era una trampa: bloqueaba WASD/R sin aviso)', () => {
    const w = worldInPhase('prep', [{ id: 'h', role: 'hider' }]);
    step(w, [mkCmd('h', { action: ActionKind.FREEZE })], DT, rng, physics);
    expect(w.players.get('h')!.frozen).toBe(false);
    // …y sigue pudiendo moverse y cambiar de pose.
    step(w, [mkCmd('h', { moveX: 1, pose: 2 })], DT, rng, physics);
    expect(w.players.get('h')!.pos.x).toBeGreaterThan(0);
    expect(w.players.get('h')!.pose).toBe(2);
  });
});

describe('step — poses (V1-B)', () => {
  it('el Hider adopta la pose del comando en Prep (y se sanea a 0..3)', () => {
    const w = worldInPhase('prep', [{ id: 'h', role: 'hider' }]);
    step(w, [mkCmd('h', { pose: 2 })], DT, rng, physics);
    expect(w.players.get('h')!.pose).toBe(2);
    step(w, [mkCmd('h', { pose: 255 })], DT, rng, physics); // valor tramposo
    expect(w.players.get('h')!.pose).toBe(3); // 255 & 3
  });

  it('la pose queda FIJA durante Hunt (congelado automático)', () => {
    const w2 = worldInPhase('hunt', [{ id: 'h', role: 'hider', frozen: true }]);
    step(w2, [mkCmd('h', { pose: 2 })], DT, rng, physics);
    expect(w2.players.get('h')!.pose).toBe(0); // en Hunt no se cambia
  });

  it('el Seeker no adopta poses', () => {
    const w = worldInPhase('prep', [{ id: 's', role: 'seeker' }]);
    step(w, [mkCmd('s', { pose: 2 })], DT, rng, physics);
    expect(w.players.get('s')!.pose).toBe(0);
  });
});

describe('step — oclusión (V1-A)', () => {
  it('NO se puede disparar a través de un muro', () => {
    const wallMap: MapData = {
      id: 'walled',
      bounds: { minX: -100, maxX: 100, minY: 0, maxY: 5, minZ: -100, maxZ: 100 },
      floorColor: packColor(0, 0, 0), // Hider blanco sobre negro: totalmente VISIBLE
      zones: [
        { id: 'wall', kind: 'wall', minX: 0.8, maxX: 1.2, minZ: -2, maxZ: 2, y: 1.5, height: 3, color: packColor(0, 0, 0), roughness: 1, metalness: 0 },
      ],
      spawns: [],
    };
    const w = worldInPhase('hunt', [
      { id: 's', role: 'seeker', x: 0 },
      { id: 'h', role: 'hider', x: 2, frozen: true },
    ]);
    const walledPhysics = new KinematicPhysicsWorld(16, wallMap);
    step(w, [mkCmd('s', { aimX: 1, aimZ: 0, action: ActionKind.CATCH })], DT, rng, walledPhysics, wallMap);
    const h = w.players.get('h')!;
    expect(h.caught).toBe(false); // el muro corta el disparo aunque esté visible y a 2 m
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
          ammo: p.ammo,
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
    // El Seeker dispara en el tick 3; objetivo en la línea de tiro → cae al instante.
    const cmds = (seq: number): UserCommand[] => [
      mkCmd('s', { seq, aimX: 1, aimZ: 0, action: seq === 3 ? ActionKind.CATCH : ActionKind.NONE }),
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
    expect(a.players.get('h')!.role).toBe('seeker'); // cayó con el disparo del tick 3
  });
});

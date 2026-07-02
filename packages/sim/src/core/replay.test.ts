/**
 * Test corona del netcode: REPLAY determinista. Mismas entradas + misma semilla ⇒
 * mismo mundo, siempre. Es lo que hace válida la predicción del cliente (paridad
 * servidor-cliente) y un golden que avisa si cambian las reglas sin querer.
 * Skill `tdd-testing` (+ `authoritative-netcode`).
 */
import { describe, it, expect } from 'vitest';
import { initialWorld, type WorldState } from './entities/WorldState';
import { DEFAULT_SIM_CONFIG } from './config';
import { spawnPlayer, startGame } from './phases';
import { step } from './step';
import { makeRng } from './rng';
import { KinematicPhysicsWorld } from '../physics/KinematicPhysicsWorld';
import { ActionKind, type UserCommand } from '@shared/protocol';

const DT = 1 / 30;
const SEED = 1234;
// Config de duración corta para recorrer todo el ciclo en pocos ticks.
const FAST_CONFIG = { ...DEFAULT_SIM_CONFIG, prepDurationTicks: 3, huntDurationTicks: 5 };
const IDS = ['p0', 'p1', 'p2', 'p3'];
const TICKS = 12;

/** Stream guionizado: todos empujan +x, apuntan +x, ciclan pose y pulsan CATCH cada tick. */
function commandsForTick(tick: number): UserCommand[] {
  return IDS.map((playerId) => ({
    seq: tick,
    playerId,
    moveX: 1,
    moveZ: 0,
    aimX: 1,
    aimY: 0,
    aimZ: 0,
    pose: tick & 3, // ejercita el camino de poses en el replay
    action: ActionKind.CATCH,
  }));
}

function runReplay(): WorldState {
  const world = initialWorld(SEED, FAST_CONFIG);
  for (const id of IDS) spawnPlayer(world, id);
  startGame(world, makeRng(SEED)); // asignación de roles determinista
  const physics = new KinematicPhysicsWorld();
  const rng = makeRng(SEED); // un solo RNG con estado, reutilizado entre ticks
  for (let t = 1; t <= TICKS; t++) {
    step(world, commandsForTick(t), DT, rng, physics);
  }
  return world;
}

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
        pose: p.pose,
        x: Number(p.pos.x.toFixed(4)),
        z: Number(p.pos.z.toFixed(4)),
        lpi: p.lastProcessedInput,
      })),
  };
}

describe('replay determinista', () => {
  it('mismas entradas + semilla ⇒ mismo mundo (dos corridas independientes)', () => {
    expect(serialize(runReplay())).toEqual(serialize(runReplay()));
  });

  it('recorre el ciclo completo de fases hasta Ended', () => {
    expect(runReplay().phase).toBe('ended');
  });

  it('golden: el estado final no cambia inadvertidamente', () => {
    expect(serialize(runReplay())).toMatchSnapshot();
  });
});

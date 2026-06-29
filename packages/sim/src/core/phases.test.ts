import { describe, it, expect } from 'vitest';
import { initialWorld } from './entities/WorldState';
import { makeRng } from './rng';
import {
  spawnPlayer,
  startGame,
  advancePhaseIfDue,
  anyHiderAlive,
  resetToLobby,
} from './phases';

function worldWith(n: number) {
  const w = initialWorld(1234);
  for (let i = 0; i < n; i++) spawnPlayer(w, `p${i}`);
  return w;
}

describe('spawnPlayer', () => {
  it('añade en Lobby y es idempotente por id', () => {
    const w = worldWith(0);
    const a = spawnPlayer(w, 'p1');
    const b = spawnPlayer(w, 'p1');
    expect(a).toBe(b);
    expect(w.players.size).toBe(1);
    expect(a.role).toBe('hider');
  });
});

describe('startGame', () => {
  it('pasa a Prep y fija el temporizador', () => {
    const w = worldWith(8);
    startGame(w, makeRng(w.seed));
    expect(w.phase).toBe('prep');
    expect(w.phaseEndsAtTick).toBe(w.tick + w.config.prepDurationTicks);
  });

  it('asigna ~1 Seeker por cada 4 jugadores (mínimo 1)', () => {
    const w = worldWith(8);
    startGame(w, makeRng(w.seed));
    const seekers = [...w.players.values()].filter((p) => p.role === 'seeker');
    expect(seekers.length).toBe(2);
  });

  it('asignación de roles determinista con la misma semilla', () => {
    const a = worldWith(8);
    const b = worldWith(8);
    startGame(a, makeRng(99));
    startGame(b, makeRng(99));
    const rolesA = [...a.players.entries()].map(([id, p]) => `${id}:${p.role}`);
    const rolesB = [...b.players.entries()].map(([id, p]) => `${id}:${p.role}`);
    expect(rolesA).toEqual(rolesB);
  });

  it('no hace nada si no está en Lobby', () => {
    const w = worldWith(4);
    startGame(w, makeRng(1));
    const phase = w.phase;
    startGame(w, makeRng(1));
    expect(w.phase).toBe(phase);
  });
});

describe('advancePhaseIfDue', () => {
  it('Prep → Hunt al cumplirse el tiempo y congela a los Hiders', () => {
    const w = worldWith(8);
    startGame(w, makeRng(1));
    w.tick = w.phaseEndsAtTick; // tiempo cumplido
    advancePhaseIfDue(w);
    expect(w.phase).toBe('hunt');
    const hiders = [...w.players.values()].filter((p) => p.role === 'hider');
    expect(hiders.every((p) => p.frozen)).toBe(true);
  });

  it('Hunt → Ended; ganan los Hiders si sobrevive alguno', () => {
    const w = worldWith(8);
    startGame(w, makeRng(1));
    w.tick = w.phaseEndsAtTick;
    advancePhaseIfDue(w); // -> hunt
    w.tick = w.phaseEndsAtTick;
    advancePhaseIfDue(w); // -> ended
    expect(w.phase).toBe('ended');
    expect(w.outcome).toBe('hiders');
  });

  it('Hunt → Ended; ganan los Seekers si todos los Hiders fueron atrapados', () => {
    const w = worldWith(8);
    startGame(w, makeRng(1));
    w.tick = w.phaseEndsAtTick;
    advancePhaseIfDue(w); // -> hunt
    for (const p of w.players.values()) {
      if (p.role === 'hider') p.caught = true;
    }
    expect(anyHiderAlive(w)).toBe(false);
    w.tick = w.phaseEndsAtTick;
    advancePhaseIfDue(w); // -> ended
    expect(w.outcome).toBe('seekers');
  });

  it('no transiciona antes de tiempo', () => {
    const w = worldWith(8);
    startGame(w, makeRng(1));
    w.tick = w.phaseEndsAtTick - 1;
    advancePhaseIfDue(w);
    expect(w.phase).toBe('prep');
  });
});

describe('resetToLobby', () => {
  it('desde Ended vuelve a Lobby y limpia roles/estado para volver a jugar', () => {
    const w = worldWith(8);
    startGame(w, makeRng(1));
    w.tick = w.phaseEndsAtTick;
    advancePhaseIfDue(w); // -> hunt
    for (const p of w.players.values()) p.caught = true;
    w.tick = w.phaseEndsAtTick;
    advancePhaseIfDue(w); // -> ended
    expect(w.phase).toBe('ended');

    resetToLobby(w);

    expect(w.phase).toBe('lobby');
    expect(w.outcome).toBe('none');
    expect(w.phaseEndsAtTick).toBe(0);
    expect([...w.players.values()].every((p) => p.role === 'hider')).toBe(true);
    expect([...w.players.values()].every((p) => !p.caught && !p.frozen)).toBe(true);
  });

  it('tras el reinicio se puede arrancar una nueva ronda (startGame funciona otra vez)', () => {
    const w = worldWith(4);
    startGame(w, makeRng(1));
    resetToLobby(w);
    startGame(w, makeRng(1)); // no-op si no estuviera en lobby
    expect(w.phase).toBe('prep');
  });
});

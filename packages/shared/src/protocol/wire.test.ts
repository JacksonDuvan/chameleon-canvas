import { describe, it, expect } from 'vitest';
import {
  encodeInput,
  decodeInput,
  encodeKeyframe,
  encodeDelta,
  captureBaseline,
  decodeSnapshot,
  type WirePlayer,
  type WireWorld,
} from './wire';
import { ActionKind } from './commands';

function mkPlayer(id: string, over: Partial<WirePlayer> = {}): WirePlayer {
  return {
    id,
    pos: { x: 0, y: 0, z: 0 },
    aimX: 0,
    aimZ: 1,
    color: { r: 0, g: 0, b: 0, a: 255 },
    role: 'hider',
    frozen: false,
    caught: false,
    lastProcessedInput: 0,
    camoScore: 0,
    beingWatched: false,
    ...over,
  };
}

function mkWorld(players: WirePlayer[], over: Partial<WireWorld> = {}): WireWorld {
  return {
    tick: 7,
    phase: 'prep',
    outcome: 'none',
    players: new Map(players.map((p) => [p.id, p])),
    ...over,
  };
}

describe('wire · INPUT', () => {
  it('round-trip dentro de la tolerancia de cuantización', () => {
    const input = {
      seq: 123456,
      moveX: 0.5,
      moveZ: -1,
      aimX: 0.707,
      aimZ: -0.707,
      action: ActionKind.CATCH,
    };
    const decoded = decodeInput(encodeInput(input).slice().buffer);
    expect(decoded.seq).toBe(123456);
    expect(decoded.moveX).toBeCloseTo(0.5, 3);
    expect(decoded.moveZ).toBeCloseTo(-1, 3);
    expect(decoded.aimX).toBeCloseTo(0.707, 3);
    expect(decoded.aimZ).toBeCloseTo(-0.707, 3);
    expect(decoded.action).toBe(ActionKind.CATCH);
  });
});

describe('wire · KEYFRAME', () => {
  it('round-trip de un mundo completo (posiciones a cm, color y flags exactos)', () => {
    const world = mkWorld([
      mkPlayer('s1', {
        role: 'seeker',
        pos: { x: 1.23, y: 0, z: -4.56 },
        color: { r: 200, g: 30, b: 30, a: 255 },
        lastProcessedInput: 42,
      }),
      mkPlayer('h1', { frozen: true, caught: false, pos: { x: -2.5, y: 1.5, z: 8 }, camoScore: 0.75, beingWatched: true }),
    ]);
    const snap = decodeSnapshot(encodeKeyframe(world).slice().buffer);
    expect(snap.type).toBe('keyframe');
    expect(snap.tick).toBe(7);
    expect(snap.phase).toBe('prep');
    expect(snap.players).toHaveLength(2);

    const s1 = snap.players.find((p) => p.id === 's1')!;
    expect(s1.role).toBe('seeker');
    expect(s1.lastProcessedInput).toBe(42);
    expect(s1.x).toBeCloseTo(1.23, 2);
    expect(s1.z).toBeCloseTo(-4.56, 2);
    expect(s1.colorPacked).toBe(0xc81e1eff >>> 0);

    const h1 = snap.players.find((p) => p.id === 'h1')!;
    expect(h1.frozen).toBe(true);
    expect(h1.y).toBeCloseTo(1.5, 2);
    expect(h1.camoScore).toBeCloseTo(0.75, 2); // ±1/255 por la cuantización a u8
    expect(h1.beingWatched).toBe(true);
  });
});

describe('wire · DELTA', () => {
  it('incluye solo los jugadores cuya firma cuantizada cambió', () => {
    const a = mkPlayer('a', { pos: { x: 0, y: 0, z: 0 } });
    const b = mkPlayer('b', { pos: { x: 5, y: 0, z: 0 } });
    const world1 = mkWorld([a, b]);
    const baseline = captureBaseline(world1);

    // world2: 'a' se movió; 'b' igual.
    const world2 = mkWorld([{ ...a, pos: { x: 0.2, y: 0, z: 0 } }, b]);
    const snap = decodeSnapshot(encodeDelta(baseline, world2).slice().buffer);

    expect(snap.type).toBe('delta');
    expect(snap.players.map((p) => p.id)).toEqual(['a']);
    expect(snap.players[0]!.x).toBeCloseTo(0.2, 2);
  });

  it('un mundo sin cambios produce un delta de 0 jugadores', () => {
    const world = mkWorld([mkPlayer('a', { pos: { x: 1, y: 0, z: 1 } })]);
    const baseline = captureBaseline(world);
    const snap = decodeSnapshot(encodeDelta(baseline, world).slice().buffer);
    expect(snap.players).toHaveLength(0);
    expect(snap.type).toBe('delta');
  });

  it('detecta cambios de flags y color, no solo de posición', () => {
    const a = mkPlayer('a');
    const baseline = captureBaseline(mkWorld([a]));
    const moved = mkWorld([{ ...a, caught: true, role: 'seeker' }]);
    const snap = decodeSnapshot(encodeDelta(baseline, moved).slice().buffer);
    expect(snap.players).toHaveLength(1);
    expect(snap.players[0]!.caught).toBe(true);
    expect(snap.players[0]!.role).toBe('seeker');
  });

  it('detecta cambios de camuflaje y de beingWatched (P0.2/P0.3)', () => {
    const a = mkPlayer('a', { camoScore: 0.2 });
    const baseline = captureBaseline(mkWorld([a]));
    const changed = mkWorld([{ ...a, camoScore: 0.9, beingWatched: true }]);
    const snap = decodeSnapshot(encodeDelta(baseline, changed).slice().buffer);
    expect(snap.players).toHaveLength(1);
    expect(snap.players[0]!.camoScore).toBeCloseTo(0.9, 2);
    expect(snap.players[0]!.beingWatched).toBe(true);
  });
});

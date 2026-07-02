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
    aimY: 0,
    aimZ: 1,
    color: { r: 0, g: 0, b: 0, a: 255 },
    role: 'hider',
    frozen: false,
    caught: false,
    lastProcessedInput: 0,
    camoScore: 0,
    pose: 0,
    ammo: 0,
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
  it('round-trip dentro de la tolerancia de cuantización (incluye aimY y pose, v3)', () => {
    const input = {
      seq: 123456,
      moveX: 0.5,
      moveZ: -1,
      aimX: 0.694,
      aimY: -0.194, // pitch hacia abajo (mouse-look del Seeker)
      aimZ: -0.694,
      pose: 2, // bola
      action: ActionKind.CATCH,
    };
    const decoded = decodeInput(encodeInput(input).slice().buffer);
    expect(decoded.seq).toBe(123456);
    expect(decoded.moveX).toBeCloseTo(0.5, 3);
    expect(decoded.moveZ).toBeCloseTo(-1, 3);
    expect(decoded.aimX).toBeCloseTo(0.694, 3);
    expect(decoded.aimY).toBeCloseTo(-0.194, 3);
    expect(decoded.aimZ).toBeCloseTo(-0.694, 3);
    expect(decoded.pose).toBe(2);
    expect(decoded.action).toBe(ActionKind.CATCH);
  });
});

describe('wire · KEYFRAME', () => {
  it('round-trip de un mundo completo (posiciones a cm, color y flags exactos)', () => {
    const world = mkWorld([
      mkPlayer('s1', {
        role: 'seeker',
        pos: { x: 1.23, y: 0, z: -4.56 },
        aimY: -0.3, // apuntando hacia abajo (pitch)
        color: { r: 200, g: 30, b: 30, a: 255 },
        lastProcessedInput: 42,
        ammo: 7,
      }),
      mkPlayer('h1', { frozen: true, caught: false, pos: { x: -2.5, y: 1.5, z: 8 }, camoScore: 0.75, pose: 3 }),
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
    expect(s1.aimY).toBeCloseTo(-0.3, 3); // el pitch viaja en el snapshot (reconciliación)
    expect(s1.colorPacked).toBe(0xc81e1eff >>> 0);
    expect(s1.ammo).toBe(7); // munición restante (v4)

    const h1 = snap.players.find((p) => p.id === 'h1')!;
    expect(h1.frozen).toBe(true);
    expect(h1.y).toBeCloseTo(1.5, 2);
    expect(h1.camoScore).toBeCloseTo(0.75, 2); // ±1/255 por la cuantización a u8
    expect(h1.pose).toBe(3); // wall-flat (bits 4-5 de roleFlags)
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

  it('detecta cambios de camuflaje (P0.2)', () => {
    const a = mkPlayer('a', { camoScore: 0.2 });
    const baseline = captureBaseline(mkWorld([a]));
    const changed = mkWorld([{ ...a, camoScore: 0.9 }]);
    const snap = decodeSnapshot(encodeDelta(baseline, changed).slice().buffer);
    expect(snap.players).toHaveLength(1);
    expect(snap.players[0]!.camoScore).toBeCloseTo(0.9, 2);
  });

  it('detecta cambios de pose y de munición (V1-B / v4)', () => {
    const a = mkPlayer('a');
    const baseline = captureBaseline(mkWorld([a]));
    const posed = mkWorld([{ ...a, pose: 1 }]);
    const snapPose = decodeSnapshot(encodeDelta(baseline, posed).slice().buffer);
    expect(snapPose.players.map((p) => p.id)).toEqual(['a']);
    expect(snapPose.players[0]!.pose).toBe(1);

    const b = mkPlayer('b', { role: 'seeker', ammo: 10 });
    const base2 = captureBaseline(mkWorld([b]));
    const shot = mkWorld([{ ...b, ammo: 9 }]); // disparó: el delta debe propagarlo
    const snapShot = decodeSnapshot(encodeDelta(base2, shot).slice().buffer);
    expect(snapShot.players.map((p) => p.id)).toEqual(['b']);
    expect(snapShot.players[0]!.ammo).toBe(9);
  });
});

import { describe, it, expect } from 'vitest';
import { predict, reconcile, type PendingInput, type AuthoritativeLocal } from './prediction';
import { PlayerState, DEFAULT_SIM_CONFIG } from '@mecha/sim';
import { ActionKind, type UserCommand } from '@mecha/shared';

const DT = 1 / 30;
const cfg = DEFAULT_SIM_CONFIG;
const STEP = cfg.maxSpeed * DT; // desplazamiento por input con moveX=1 (0.2)

function pending(seq: number, moveX = 1): PendingInput {
  const cmd: UserCommand = {
    seq,
    playerId: 'local',
    moveX,
    moveZ: 0,
    aimX: 1,
    aimY: 0,
    aimZ: 0,
    pose: 0,
    action: ActionKind.NONE,
  };
  return { seq, cmd, dt: DT };
}

function authAt(lastProcessedInput: number, x: number): AuthoritativeLocal {
  return {
    lastProcessedInput,
    x,
    y: 0,
    z: 0,
    aimX: 1,
    aimY: 0,
    aimZ: 0,
    role: 'hider',
    frozen: false,
    caught: false,
    pose: 0,
  };
}

describe('predict', () => {
  it('aplica el movimiento del input al jugador local (mismas reglas que el servidor)', () => {
    const local = new PlayerState('local', 'hider');
    predict(local, pending(1), 'prep', cfg);
    expect(local.pos.x).toBeCloseTo(STEP, 9);
  });

  it('no mueve a un Hider en Hunt (regla de fase)', () => {
    const local = new PlayerState('local', 'hider');
    predict(local, pending(1), 'hunt', cfg);
    expect(local.pos.x).toBe(0);
  });
});

describe('reconcile', () => {
  it('RE-APLICA los inputs no confirmados sobre el estado autoritativo (no hace snap)', () => {
    const local = new PlayerState('local', 'hider');
    // El cliente predijo 5 inputs hacia +x.
    const buf = [pending(1), pending(2), pending(3), pending(4), pending(5)];
    for (const p of buf) predict(local, p, 'prep', cfg);
    expect(local.pos.x).toBeCloseTo(5 * STEP, 9);

    // El servidor confirma hasta el input 3 (pos autoritativa = 3 pasos).
    reconcile(local, buf, authAt(3, 3 * STEP), 'prep', cfg);

    // Quedan pendientes 4 y 5; el resultado = auth (3 pasos) + 2 re-aplicados = 5 pasos.
    // NO es la posición cruda del servidor (3 pasos) → no hay snapping.
    expect(local.pos.x).toBeCloseTo(5 * STEP, 9);
    expect(buf.map((p) => p.seq)).toEqual([4, 5]); // descartó los confirmados
    expect(local.lastProcessedInput).toBe(3);
  });

  it('si todos los inputs están confirmados, el local queda EXACTO en el autoritativo', () => {
    const local = new PlayerState('local', 'hider');
    const buf = [pending(1), pending(2)];
    for (const p of buf) predict(local, p, 'prep', cfg);

    reconcile(local, buf, authAt(2, 2 * STEP), 'prep', cfg);

    expect(local.pos.x).toBeCloseTo(2 * STEP, 9);
    expect(buf.length).toBe(0); // todos descartados
  });

  it('una predicción errónea converge suavemente al estado del servidor', () => {
    const local = new PlayerState('local', 'hider');
    // El cliente predijo 3 pasos, pero el servidor (p.ej. por colisión) lo paró en 1 paso.
    const buf = [pending(1), pending(2), pending(3)];
    for (const p of buf) predict(local, p, 'prep', cfg);

    // Server confirmó 2 inputs pero la pos autoritativa es menor (chocó): x = 1 paso.
    reconcile(local, buf, authAt(2, 1 * STEP), 'prep', cfg);

    // Resultado = auth (1 paso) + re-aplicar input 3 (1 paso) = 2 pasos. Converge sin snap brusco.
    expect(local.pos.x).toBeCloseTo(2 * STEP, 9);
    expect(buf.map((p) => p.seq)).toEqual([3]);
  });

  it('si lastProcessedInput RETROCEDE (rollback del servidor), limpia pending y confía en el autoritativo', () => {
    const local = new PlayerState('local', 'hider');
    const buf = [pending(1), pending(2), pending(3)];
    for (const p of buf) predict(local, p, 'prep', cfg);
    local.lastProcessedInput = 3; // el cliente cree que el servidor procesó hasta 3

    // Snapshot anómalo: lastProcessedInput retrocede a 1.
    reconcile(local, buf, authAt(1, 1 * STEP), 'prep', cfg);

    expect(buf.length).toBe(0); // pending limpiado (defensa anti-desync)
    expect(local.pos.x).toBeCloseTo(1 * STEP, 9); // posición autoritativa pura (nada re-aplicado)
    expect(local.lastProcessedInput).toBe(1);
  });

  it('respeta la fase al re-aplicar: un Hider no se mueve si se reconcilia en Hunt', () => {
    const local = new PlayerState('local', 'hider');
    const buf = [pending(1), pending(2)]; // inputs de movimiento, aún no confirmados
    reconcile(local, buf, authAt(0, 0), 'hunt', cfg);
    expect(local.pos.x).toBe(0); // Hiders congelados en Hunt: re-aplicar no lo mueve
    expect(buf.map((p) => p.seq)).toEqual([1, 2]); // siguen pendientes
  });

  it('reconcilia rol/frozen/caught/pose y aim al estado autoritativo', () => {
    const local = new PlayerState('local', 'hider');
    const auth: AuthoritativeLocal = {
      lastProcessedInput: 5,
      x: 1,
      y: 0,
      z: 2,
      aimX: 0,
      aimY: -0.5,
      aimZ: 1,
      role: 'seeker',
      frozen: false,
      caught: true,
      pose: 2,
    };
    reconcile(local, [], auth, 'hunt', cfg);
    expect(local.role).toBe('seeker');
    expect(local.caught).toBe(true);
    expect(local.pose).toBe(2);
    expect(local.aimY).toBe(-0.5); // el pitch también se reconcilia (aim 3D completo)
    expect([local.pos.x, local.pos.z]).toEqual([1, 2]);
  });
});

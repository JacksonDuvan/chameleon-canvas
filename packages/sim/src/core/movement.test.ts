import { describe, it, expect } from 'vitest';
import { applyAim, applyMovement, canMove } from './movement';
import { PlayerState } from './entities/PlayerState';
import { initialWorld, type WorldState } from './entities/WorldState';
import { DEFAULT_SIM_CONFIG } from './config';
import { step } from './step';
import { makeRng } from './rng';
import { KinematicPhysicsWorld } from '../physics/KinematicPhysicsWorld';
import { ActionKind, type UserCommand } from '@shared/protocol';

const DT = 1 / 30;
const cfg = DEFAULT_SIM_CONFIG;

function cmd(playerId: string, over: Partial<UserCommand> = {}): UserCommand {
  return { seq: 1, playerId, moveX: 0, moveZ: 0, aimX: 0, aimZ: 1, action: ActionKind.NONE, ...over };
}

describe('canMove', () => {
  it('Prep: solo Hiders; Hunt: solo Seekers; lobby/ended: nadie', () => {
    const hider = new PlayerState('h', 'hider');
    const seeker = new PlayerState('s', 'seeker');
    expect(canMove('prep', hider)).toBe(true);
    expect(canMove('prep', seeker)).toBe(false);
    expect(canMove('hunt', hider)).toBe(false);
    expect(canMove('hunt', seeker)).toBe(true);
    expect(canMove('lobby', hider)).toBe(false);
    expect(canMove('ended', seeker)).toBe(false);
  });

  it('un jugador congelado nunca se mueve', () => {
    const hider = new PlayerState('h', 'hider');
    hider.frozen = true;
    expect(canMove('prep', hider)).toBe(false);
  });
});

describe('applyAim', () => {
  it('normaliza el apunte', () => {
    const p = new PlayerState('p');
    applyAim(p, cmd('p', { aimX: 5, aimZ: 0 }));
    expect(p.aimX).toBeCloseTo(1, 9);
    expect(p.aimZ).toBeCloseTo(0, 9);
  });

  it('conserva el apunte previo si el comando trae vector cero', () => {
    const p = new PlayerState('p'); // aim por defecto (0,1)
    applyAim(p, cmd('p', { aimX: 0, aimZ: 0 }));
    expect([p.aimX, p.aimZ]).toEqual([0, 1]);
  });
});

describe('applyMovement', () => {
  it('integra a velocidad máxima y clampa la diagonal', () => {
    const p = new PlayerState('p');
    applyMovement(p, cmd('p', { moveX: 1, moveZ: 1 }), cfg, DT);
    const speed = Math.sqrt(p.pos.x ** 2 + p.pos.z ** 2) / DT;
    expect(speed).toBeCloseTo(cfg.maxSpeed, 6);
  });
});

describe('paridad servidor-cliente del movimiento', () => {
  // El servidor (step) y la predicción del cliente (applyAim+applyMovement) DEBEN
  // producir la posición local idéntica para los mismos inputs: es lo que valida la
  // predicción (skill `authoritative-netcode`).
  it('step() del servidor == applyMovement local sobre el mismo stream de inputs', () => {
    const inputs: UserCommand[] = Array.from({ length: 20 }, (_, i) =>
      cmd('p', { seq: i + 1, moveX: Math.sin(i) * 0.8, moveZ: 0.6, aimX: 1, aimZ: 0 }),
    );

    // Servidor: un mundo con el jugador, en Prep (Hider se mueve), corriendo step por tick.
    const server: WorldState = initialWorld(1);
    server.phase = 'prep';
    server.players.set('p', new PlayerState('p', 'hider'));
    const physics = new KinematicPhysicsWorld();
    const rng = makeRng(1);
    for (const input of inputs) step(server, [input], DT, rng, physics);

    // Cliente: jugador local aislado, aplicando las MISMAS funciones por input.
    const local = new PlayerState('p', 'hider');
    for (const input of inputs) {
      applyAim(local, input);
      if (canMove('prep', local)) applyMovement(local, input, cfg, DT);
    }

    const sp = server.players.get('p')!;
    expect(local.pos.x).toBeCloseTo(sp.pos.x, 9);
    expect(local.pos.z).toBeCloseTo(sp.pos.z, 9);
    expect([local.aimX, local.aimZ]).toEqual([sp.aimX, sp.aimZ]);
  });
});

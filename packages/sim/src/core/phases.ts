/**
 * Ciclo de vida de la ronda y transición de fases (DETERMINISTA).
 *
 * Reglas de negocio de Meccha Chameleon: Lobby → Prep (Hiders se mueven/camuflan,
 * Seekers esperan) → Hunt (Hiders congelados, Seekers cazan) → Ended. Un Hider
 * atrapado pasa a Seeker. Los Hiders ganan si sobrevive al menos uno al acabar Hunt.
 *
 * Las transiciones temporizadas (Prep→Hunt→Ended) van en `advancePhaseIfDue` y las
 * ejecuta `step` cada tick, así el CLIENTE las predice igual (mismos umbrales de
 * tick). El arranque (`startGame`) y la asignación de roles usan el RNG con semilla.
 */
import type { WorldState } from './entities/WorldState';
import { PlayerState } from './entities/PlayerState';
import type { Rng } from './rng';

/** Añade un jugador en Lobby con posición de spawn determinista (rejilla). */
export function spawnPlayer(world: WorldState, id: string): PlayerState {
  const existing = world.players.get(id);
  if (existing) return existing;
  const i = world.players.size;
  const p = new PlayerState(id, 'hider');
  p.pos.setMut(((i % 5) - 2) * 2, 0, (Math.floor(i / 5) - 2) * 2);
  world.players.set(id, p);
  return p;
}

export function removePlayer(world: WorldState, id: string): void {
  world.players.delete(id);
}

/** Arranca la ronda: asigna roles deterministamente y pasa a Prep. */
export function startGame(world: WorldState, rng: Rng): void {
  if (world.phase !== 'lobby') return;

  const ids: string[] = [];
  for (const id of world.players.keys()) ids.push(id);

  // Barajado Fisher-Yates determinista.
  for (let i = ids.length - 1; i > 0; i--) {
    const j = rng.nextInt(i + 1);
    const tmp = ids[i]!;
    ids[i] = ids[j]!;
    ids[j] = tmp;
  }

  const seekerCount = Math.max(1, Math.floor(ids.length / 4));
  for (let i = 0; i < ids.length; i++) {
    const p = world.players.get(ids[i]!);
    if (!p) continue;
    p.role = i < seekerCount ? 'seeker' : 'hider';
    p.frozen = false;
    p.caught = false;
  }

  world.phase = 'prep';
  world.phaseEndsAtTick = world.tick + world.config.prepDurationTicks;
}

/**
 * Reinicia la ronda a Lobby para "jugar otra vez": limpia resultado/temporizador,
 * devuelve a todos a Hider (sin congelar ni atrapar) y los re-posiciona en la rejilla
 * de spawn. DETERMINISTA y sin RNG (los roles se reasignan en el próximo `startGame`).
 */
export function resetToLobby(world: WorldState): void {
  world.phase = 'lobby';
  world.phaseEndsAtTick = 0;
  world.outcome = 'none';
  let i = 0;
  for (const p of world.players.values()) {
    p.role = 'hider';
    p.frozen = false;
    p.caught = false;
    p.colorLockedUntil = 0;
    p.pos.setMut(((i % 5) - 2) * 2, 0, (Math.floor(i / 5) - 2) * 2);
    i++;
  }
}

/** ¿Sobrevive al menos un Hider sin atrapar? (condición de victoria de los Hiders). */
export function anyHiderAlive(world: WorldState): boolean {
  for (const p of world.players.values()) {
    if (p.role === 'hider' && !p.caught) return true;
  }
  return false;
}

/** Transición temporizada de fase. La invoca `step` cada tick. */
export function advancePhaseIfDue(world: WorldState): void {
  if (world.phaseEndsAtTick <= 0 || world.tick < world.phaseEndsAtTick) return;

  if (world.phase === 'prep') {
    world.phase = 'hunt';
    world.phaseEndsAtTick = world.tick + world.config.huntDurationTicks;
    for (const p of world.players.values()) {
      if (p.role === 'hider') p.frozen = true; // Hiders congelados en Hunt
    }
  } else if (world.phase === 'hunt') {
    world.phase = 'ended';
    world.phaseEndsAtTick = 0;
    world.outcome = anyHiderAlive(world) ? 'hiders' : 'seekers';
  }
}

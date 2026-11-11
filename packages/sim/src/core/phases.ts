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

/**
 * Añade un jugador en Lobby con posición de spawn determinista (rejilla).
 * Rejilla 5×5 con paso 1.4 m (±2.8 m): cabe en el HALL CENTRAL de la casa
 * (intersección de la cruz, 8×8 m libre de sólidos) sin pisar los muros de los
 * bloques, que nacen en x=±4 / z=±4. Paso > diámetro del jugador (1 m).
 */
export function spawnPlayer(world: WorldState, id: string): PlayerState {
  const existing = world.players.get(id);
  if (existing) return existing;
  const i = world.players.size;
  const p = new PlayerState(id, 'hider');
  p.pos.setMut(((i % 5) - 2) * 1.4, 0, (Math.floor(i / 5) - 2) * 1.4);
  world.players.set(id, p);
  return p;
}

export function removePlayer(world: WorldState, id: string): void {
  world.players.delete(id);
}

/** Seekers por defecto si el host no elige: 1 de cada 4 jugadores (mínimo 1). */
export function defaultSeekerCount(players: number): number {
  return Math.max(1, Math.floor(players / 4));
}

/** Sanea la cantidad de Seekers pedida por el host: entre 1 y (jugadores − 1), para
 *  que siempre quede al menos un Hider. Valores no enteros/ausentes ⇒ automático. */
export function clampSeekerCount(requested: number | undefined, players: number): number {
  if (requested === undefined || !Number.isInteger(requested)) return defaultSeekerCount(players);
  const max = Math.max(1, players - 1);
  return requested < 1 ? 1 : requested > max ? max : requested;
}

/**
 * Arranca la ronda: asigna roles deterministamente y pasa a Prep. `seekers` = cuántos
 * buscan (opción del host, playtest r6); sin él, reparto automático.
 */
export function startGame(world: WorldState, rng: Rng, seekers?: number): void {
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

  // Mapa aleatorio de la ronda: nueva semilla del RNG (determinista, misma en ambos
  // lados vía el wire) → el escenario cambia cada ronda y el Seeker no se lo aprende.
  world.mapSeed = (rng.nextInt(0x7fffffff) ^ (world.tick + 1)) >>> 0 || 1;

  const seekerCount = clampSeekerCount(seekers, ids.length);
  for (let i = 0; i < ids.length; i++) {
    const p = world.players.get(ids[i]!);
    if (!p) continue;
    p.role = i < seekerCount ? 'seeker' : 'hider';
    p.frozen = false;
    p.caught = false;
    p.pose = 0;
    // Economía de disparos (original): los Seekers reciben munición limitada.
    p.ammo = p.role === 'seeker' ? world.config.shotAmmo : 0;
    p.shotCooldownUntil = 0;
    p.pos.y = 0; // nadie empieza la ronda en el aire ni subido a un mueble del lobby
    p.vy = 0;
    p.grounded = true;
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
    p.pose = 0;
    p.ammo = 0;
    p.shotCooldownUntil = 0;
    p.vy = 0;
    p.grounded = true;
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

/**
 * Adaptador driven: `IRoomRepository` sobre el storage del Durable Object.
 *
 * El storage del DO usa structured-clone, que NO conserva los prototipos de clase
 * (Vec3, PlayerState…). Por eso se serializa a un snapshot plano y se rehidrata a
 * instancias de clase al leer. Captura las excepciones de I/O en el borde y las
 * convierte en `Err` tipado (el dominio nunca ve try/catch). Skill
 * `hexagonal-vertical-slicing`.
 *
 * Nota: esta es la persistencia base (estado completo). El delta-encoding BINARIO
 * del camino caliente por WebSocket es otra cosa y se hace en el Paso 3
 * (ver `@shared/protocol` wire-format).
 */
import { Ok, Err, type Result } from '@shared/result';
import type {
  IRoomRepository,
  RoomRepoError,
} from '@/slices/gameplay/domain/ports/IRoomRepository';
import { Room, type RoomConfig } from '@/slices/gameplay/domain/entities/Room';
import { Player } from '@/slices/gameplay/domain/entities/Player';
import { PlayerState, type SimConfig, type GameOutcome } from '@mecha/sim';
import type { GamePhase, PlayerRole } from '@shared/protocol';
import type { DurableObjectStorage } from '@cloudflare/workers-types';

interface PlayerSnapshot {
  id: string;
  role: PlayerRole;
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  aimX: number;
  aimZ: number;
  r: number;
  g: number;
  b: number;
  a: number;
  frozen: boolean;
  caught: boolean;
  colorLockedUntil: number;
  lastProcessedInput: number;
}

interface RoomSnapshot {
  id: string;
  hostId: string | null;
  config: RoomConfig;
  tick: number;
  phase: GamePhase;
  phaseEndsAtTick: number;
  outcome: GameOutcome;
  seed: number;
  rngState: number;
  simConfig: SimConfig;
  players: PlayerSnapshot[];
  roster: Array<{ id: string; displayName: string; isHost: boolean; premium: boolean }>;
}

function toSnapshot(room: Room): RoomSnapshot {
  const players: PlayerSnapshot[] = [];
  for (const p of room.world.players.values()) {
    players.push({
      id: p.id,
      role: p.role,
      x: p.pos.x,
      y: p.pos.y,
      z: p.pos.z,
      vx: p.vel.x,
      vy: p.vel.y,
      vz: p.vel.z,
      aimX: p.aimX,
      aimZ: p.aimZ,
      r: p.color.r,
      g: p.color.g,
      b: p.color.b,
      a: p.color.a,
      frozen: p.frozen,
      caught: p.caught,
      colorLockedUntil: p.colorLockedUntil,
      lastProcessedInput: p.lastProcessedInput,
    });
  }
  const roster = [...room.roster.values()].map((p) => ({
    id: p.id,
    displayName: p.displayName,
    isHost: p.isHost,
    premium: p.premium,
  }));
  return {
    id: room.id,
    hostId: room.hostId,
    config: room.config,
    tick: room.world.tick,
    phase: room.world.phase,
    phaseEndsAtTick: room.world.phaseEndsAtTick,
    outcome: room.world.outcome,
    seed: room.world.seed,
    rngState: room.world.rngState,
    simConfig: room.world.config,
    players,
    roster,
  };
}

function fromSnapshot(s: RoomSnapshot): Room {
  const room = new Room(s.id, s.config, s.seed, s.simConfig);
  room.hostId = s.hostId;
  room.world.tick = s.tick;
  room.world.phase = s.phase;
  room.world.phaseEndsAtTick = s.phaseEndsAtTick;
  room.world.outcome = s.outcome;
  room.world.rngState = s.rngState;
  for (const ps of s.players) {
    const p = new PlayerState(ps.id, ps.role);
    p.pos.setMut(ps.x, ps.y, ps.z);
    p.vel.setMut(ps.vx, ps.vy, ps.vz);
    p.aimX = ps.aimX;
    p.aimZ = ps.aimZ;
    p.color.setMut(ps.r, ps.g, ps.b, ps.a);
    p.frozen = ps.frozen;
    p.caught = ps.caught;
    p.colorLockedUntil = ps.colorLockedUntil;
    p.lastProcessedInput = ps.lastProcessedInput;
    room.world.players.set(p.id, p);
  }
  for (const rs of s.roster) {
    room.roster.set(rs.id, new Player(rs.id, rs.displayName, rs.isHost, rs.premium));
  }
  return room;
}

export class DoStorageRoomRepository implements IRoomRepository {
  constructor(private readonly storage: DurableObjectStorage) {}

  async load(roomId: string): Promise<Result<Room | null, RoomRepoError>> {
    try {
      const snap = await this.storage.get<RoomSnapshot>(`room:${roomId}`);
      return Ok(snap ? fromSnapshot(snap) : null);
    } catch (e) {
      return Err({ kind: 'StorageUnavailable', cause: String(e) });
    }
  }

  async save(room: Room): Promise<Result<void, RoomRepoError>> {
    try {
      await this.storage.put(`room:${room.id}`, toSnapshot(room));
      return Ok(undefined);
    } catch (e) {
      return Err({ kind: 'StorageUnavailable', cause: String(e) });
    }
  }
}

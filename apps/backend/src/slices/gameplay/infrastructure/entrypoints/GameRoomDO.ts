/**
 * GameRoomDO — Durable Object: UNA instancia = UNA sala de juego.
 *
 * Es el adaptador driving central del backend y la COMPOSITION ROOT del slice:
 * instancia los adaptadores concretos (driven) y los inyecta en los use-cases por
 * constructor (DI). Contiene el mundo autoritativo, los sockets y el bucle de tick.
 *
 * Skills: `authoritative-netcode` (Hibernation API, bucle a 30 Hz con setInterval
 * solo mientras la partida está viva, auto-respuesta a pings, estado volátil
 * persistido) + `hexagonal-vertical-slicing` (DI por constructor) +
 * `workers-memory-optimization` (constructor barato; se re-ejecuta en cada wake).
 *
 * SCAFFOLD del Paso 1 — handlers, bucle y persistencia se implementan en el Paso 3.
 */
import { DurableObject } from 'cloudflare:workers';
import type { Env } from '@/shared/env';
import { ProcessTick } from '@/slices/gameplay/use-cases/ProcessTick';
import { DoStorageRoomRepository } from '@/slices/gameplay/infrastructure/adapters/DoStorageRoomRepository';
import type { IRoomRepository } from '@/slices/gameplay/domain/ports/IRoomRepository';
import { KinematicPhysicsWorld, type IPhysicsWorld } from '@mecha/sim';

const TICK_MS = 1000 / 30; // 30 Hz autoritativo

export class GameRoomDO extends DurableObject<Env> {
  private readonly rooms: IRoomRepository;
  private readonly physics: IPhysicsWorld;
  private readonly processTick: ProcessTick;
  private loop: ReturnType<typeof setInterval> | null = null;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    // ── Composition root: construir adaptadores (driven) e inyectarlos ──
    this.rooms = new DoStorageRoomRepository(ctx.storage);
    // Físicas ligeras para el MVP (puro TS, determinista, sin WASM). Cuando haga
    // falta colisión rica contra geometría compleja se sustituye por
    // RapierPhysicsWorld (initRapier en blockConcurrencyWhile) — mismo puerto.
    const capacity = Number(env.MAX_PLAYERS_PER_ROOM) || 16;
    this.physics = new KinematicPhysicsWorld(capacity);
    this.processTick = new ProcessTick(this.rooms, this.physics);

    // Heartbeat sin despertar la sala hibernada.
    // ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair('ping', 'pong'));
  }

  override async fetch(_req: Request): Promise<Response> {
    const pair = new WebSocketPair();
    this.ctx.acceptWebSocket(pair[1]); // hibernable (NO ws.accept())
    // pair[1].serializeAttachment({ playerId, joinedTick: ... }); // sobrevive a hibernación
    this.ensureLoop();
    return new Response(null, { status: 101, webSocket: pair[0] });
  }

  override webSocketMessage(_ws: WebSocket, _data: ArrayBuffer | string): void {
    // TODO(Paso 3): decodificar UserCommand (binario) y encolarlo para el próximo tick.
  }

  override webSocketClose(_ws: WebSocket): void {
    // TODO(Paso 3): quitar jugador; si la sala queda vacía, detener el bucle.
    this.stopLoopIfEmpty();
  }

  override webSocketError(_ws: WebSocket): void {
    this.stopLoopIfEmpty();
  }

  /** Arranca el bucle de 30 Hz mientras la partida está viva (impide hibernar a propósito). */
  private ensureLoop(): void {
    if (this.loop) return;
    this.loop = setInterval(() => {
      // TODO(Paso 3): vaciar cola de inputs → processTick.execute(dt) → broadcast delta.
      void this.processTick;
      void TICK_MS;
    }, TICK_MS);
  }

  private stopLoopIfEmpty(): void {
    if (this.loop && this.ctx.getWebSockets().length === 0) {
      clearInterval(this.loop);
      this.loop = null; // la sala queda elegible para hibernar
    }
  }
}

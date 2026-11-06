/**
 * GameRoomDO — Durable Object: UNA instancia = UNA sala de juego.
 *
 * Adaptador driving central + COMPOSITION ROOT del slice. Contiene el mundo
 * autoritativo (en memoria), los sockets (Hibernation API) y el bucle de tick a 30 Hz.
 *
 * Skills:
 *  - `authoritative-netcode`: el servidor calcula todo a partir de inputs; tick fijo
 *    30 Hz; Hibernation API (`acceptWebSocket`, handlers `webSocket*`); snapshots
 *    DELTA + KEYFRAME con `lastProcessedInput` por jugador; auto-respuesta a pings.
 *  - `workers-memory-optimization`: el bucle NO hace I/O ni asigna por tick; el estado
 *    vive en memoria y se persiste de forma periódica; constructor barato (se re-ejecuta
 *    en cada wake), estado por conexión vía `serializeAttachment`.
 *  - `hexagonal-vertical-slicing`: el DO traduce protocolo y delega en use-cases y en
 *    el dominio (`step`); cero reglas de juego aquí. DI por constructor.
 */
import { DurableObject } from 'cloudflare:workers';
import type { Env } from '@/shared/env';
import { Room, DEFAULT_ROOM_CONFIG } from '@/slices/gameplay/domain/entities/Room';
import { DoStorageRoomRepository } from '@/slices/gameplay/infrastructure/adapters/DoStorageRoomRepository';
import { SingleRoomRepository } from '@/slices/gameplay/infrastructure/adapters/SingleRoomRepository';
import { PlayerJoin } from '@/slices/gameplay/use-cases/PlayerJoin';
import { StartGame } from '@/slices/gameplay/use-cases/StartGame';
import { RestartGame } from '@/slices/gameplay/use-cases/RestartGame';
import { ChangeColor } from '@/slices/gameplay/use-cases/ChangeColor';
import { KvMonetizationAdapter } from '@/slices/monetization/infrastructure/KvMonetizationAdapter';
import {
  step,
  makeRng,
  removePlayer,
  KinematicPhysicsWorld,
  DEFAULT_MAP,
  generateMap,
  type Rng,
  type IPhysicsWorld,
  type MapData,
} from '@mecha/sim';
import {
  decodeInput,
  encodeKeyframe,
  encodeDelta,
  captureBaseline,
  type Baseline,
  type UserCommand,
} from '@shared/protocol';

const TICK_HZ = 30;
const TICK_MS = 1000 / TICK_HZ;
const DT = 1 / TICK_HZ;
const KEYFRAME_EVERY = TICK_HZ; // un keyframe ~cada segundo
const PERSIST_EVERY = TICK_HZ * 2; // persistir ~cada 2 s

/**
 * V1-H rework (playtest r3) — cooldown del silbido MANUAL del Hider: el mismo
 * jugador lo dispara (tecla T) para dar al Seeker una pista posicional en el
 * mapa grande. Rate-limit del ADAPTADOR sobre un mensaje de control (anit-spam);
 * la validación de REGLA (rol/fase) también vive aquí: el silbido es una PISTA
 * de presentación, no estado de simulación.
 */
const WHISTLE_COOLDOWN_MS = 2000;

interface Attachment {
  playerId: string;
}

export class GameRoomDO extends DurableObject<Env> {
  // Borde (driven) + cache viva en memoria.
  private readonly live: SingleRoomRepository;
  private readonly persist: DoStorageRoomRepository;
  private readonly physics: IPhysicsWorld;
  private readonly rng: Rng;
  // Use-cases (cableados por constructor sobre la cache viva).
  private readonly playerJoin: PlayerJoin;
  private readonly startGame: StartGame;
  private readonly restartGame: RestartGame;
  private readonly changeColor: ChangeColor;

  // Estado del bucle (volátil; se reconstruye tras un wake).
  private loop: ReturnType<typeof setInterval> | null = null;
  private readonly inbox: UserCommand[] = []; // inputs recibidos desde el último tick
  private baseline: Baseline | null = null;
  private ticksSinceKeyframe = 0;
  private ticksSincePersist = 0;
  private ticksSinceReconcile = 0;
  private forceKeyframe = true;
  // Mapa ALEATORIO por ronda: se regenera cuando cambia `world.mapSeed` (V1: mapa
  // distinto cada ronda para que el Seeker no se lo aprenda). `generateMap` es puro y
  // determinista; el cliente genera el mismo con el mapSeed que viaja en el snapshot.
  private currentMap: MapData = DEFAULT_MAP;
  private currentMapSeed = 1;
  // ── V1-H rework: cooldown de silbido por jugador (epoch ms). Estado VOLÁTIL de
  // presentación: no se persiste ni afecta a la simulación.
  private readonly whistleNextAt = new Map<string, number>();

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.live = new SingleRoomRepository();
    this.persist = new DoStorageRoomRepository(ctx.storage);
    // La física conoce los sólidos del mapa (oclusión del rayo de captura, V1-A);
    // `ensureMap` los reemplaza cuando cambia el mapSeed de la ronda.
    this.physics = new KinematicPhysicsWorld(Number(env.MAX_PLAYERS_PER_ROOM) || 16, DEFAULT_MAP);
    this.rng = makeRng(0);
    const monet = new KvMonetizationAdapter(env.MONET_KV);
    this.playerJoin = new PlayerJoin(this.live, monet);
    this.startGame = new StartGame(this.live);
    this.restartGame = new RestartGame(this.live);
    this.changeColor = new ChangeColor(this.live);

    // Heartbeat sin despertar la sala hibernada.
    ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair('ping', 'pong'));

    // Rehidratar la sala persistida tras un wake (barato; idempotente).
    ctx.blockConcurrencyWhile(async () => {
      const rid = await ctx.storage.get<string>('roomId');
      if (!rid) return;
      const loaded = await this.persist.load(rid);
      if (loaded.ok && loaded.value) this.live.set(loaded.value);
    });
  }

  override async fetch(req: Request): Promise<Response> {
    const url = new URL(req.url);
    if (req.headers.get('Upgrade') !== 'websocket') {
      // V1-E: pre-flight del RoomForm ANTES de abrir el WS (si la ronda ya empezó,
      // el 409 del join sería un reintento infinito para el cliente).
      if (url.pathname.endsWith('/status')) return this.roomStatus(url);
      return new Response('Expected WebSocket upgrade', { status: 426 });
    }
    const parts = url.pathname.split('/');
    const roomId = parts[parts.indexOf('rooms') + 1] ?? url.searchParams.get('room') ?? '';
    if (!roomId) return new Response('Missing room id', { status: 400 });

    await this.ensureRoom(roomId);

    // Traducción de protocolo (adaptador): sanea lo que llega por query param.
    // Misma regla que createRoomSchema del lado HTTP (trim, 1..24, no vacío).
    const rawName = url.searchParams.get('name') ?? '';
    const name = rawName.trim().slice(0, 24) || 'Player';
    const playerId = this.newPlayerId();
    const join = await this.playerJoin.execute({ roomId, playerId, displayName: name });
    if (!join.ok) {
      return new Response(JSON.stringify({ error: join.error.kind }), {
        status: 409,
        headers: { 'content-type': 'application/json' },
      });
    }

    const isHost = join.value.roster.get(playerId)?.isHost ?? false;
    const pair = new WebSocketPair();
    const server = pair[1]!;
    this.ctx.acceptWebSocket(server); // hibernable (NUNCA server.accept())
    server.serializeAttachment({ playerId } satisfies Attachment);
    server.send(JSON.stringify({ type: 'welcome', playerId, roomId, isHost }));

    this.forceKeyframe = true; // el nuevo jugador necesita estado completo
    this.ensureLoop();
    this.broadcastRoster(join.value); // V1-E: nombres del lobby para todos
    return new Response(null, { status: 101, webSocket: pair[0]! });
  }

  override async webSocketMessage(ws: WebSocket, data: ArrayBuffer | string): Promise<void> {
    const playerId = (ws.deserializeAttachment() as Attachment | null)?.playerId;
    if (!playerId) return;

    // Un mensaje puede despertar el DO tras hibernar SIN pasar por fetch: el bucle es
    // estado volátil y se pierde al hibernar. Re-arráncalo aquí o el input se
    // acumularía en `inbox` sin simularse jamás (pérdida silenciosa de input).
    this.ensureLoop();

    if (typeof data === 'string') {
      await this.handleControl(ws, playerId, data); // control raro (JSON)
      return;
    }
    // Camino caliente: INPUT binario. El servidor adjunta el playerId de la conexión
    // (el cliente NO puede declararlo → anti-spoofing).
    const payload = decodeInput(data);
    this.inbox.push({ ...payload, playerId });
  }

  override webSocketClose(ws: WebSocket): void {
    this.dropConnection(ws);
  }

  override webSocketError(ws: WebSocket): void {
    this.dropConnection(ws);
  }

  // ── Internos ──

  /**
   * V1-E — estado de la sala para el pre-flight del join (READ-ONLY: NO crea la
   * sala ni toca el storage de creación). Semántica de `joinable`:
   *  - sala en lobby con cupo → true;
   *  - sala con 0 jugadores → true (renace a lobby al unirse; ver `reconcileRoster`);
   *  - ronda en curso con jugadores → false (el WS daría 409 AlreadyStarted).
   */
  private async roomStatus(url: URL): Promise<Response> {
    const parts = url.pathname.split('/');
    const roomId = parts[parts.indexOf('rooms') + 1] ?? url.searchParams.get('room') ?? '';
    if (!roomId) return new Response('Missing room id', { status: 400 });

    const live = this.live.current();
    if (live && live.id === roomId) {
      this.reconcileRoster(); // poda fantasmas antes de reportar (no persiste)
      return this.statusJson(roomId, live.world.phase, live.world.players.size, live.config.maxPlayers);
    }
    // Sala no viva: o nunca existió (nueva ⇒ lobby vacío joinable), o está
    // persistida (hibernada). Cargar del storage SIN crear nada.
    const stored = await this.ctx.storage.get<string>('roomId');
    if (stored !== roomId) {
      return this.statusJson(roomId, 'lobby', 0, DEFAULT_ROOM_CONFIG.maxPlayers);
    }
    const loaded = await this.persist.load(roomId);
    const room = loaded.ok ? loaded.value : null;
    if (!room) return this.statusJson(roomId, 'lobby', 0, DEFAULT_ROOM_CONFIG.maxPlayers);
    const players = room.world.players.size;
    return this.statusJson(roomId, room.world.phase, players, room.config.maxPlayers);
  }

  private statusJson(roomId: string, phase: string, players: number, maxPlayers: number): Response {
    const joinable = players < maxPlayers && (phase === 'lobby' || players === 0);
    return new Response(
      JSON.stringify({ roomId, phase, players, maxPlayers, joinable }),
      { status: 200, headers: { 'content-type': 'application/json' } },
    );
  }

  private async ensureRoom(roomId: string): Promise<void> {
    // Ya cargada en memoria (p. ej. rehidratada por el constructor tras un wake): aun
    // así reconcilia contra los sockets vivos ANTES de aceptar un nuevo jugador. Sin
    // esto, una sala persistida en fase != lobby con jugadores fantasma rechazaría a
    // TODO nuevo jugador con AlreadyStarted de forma PERMANENTE (sala envenenada que
    // nunca vuelve al lobby; el loop no arranca y la reconciliación periódica no corre).
    if (this.live.current()?.id === roomId) {
      this.reconcileRoster();
      return;
    }
    const loaded = await this.persist.load(roomId);
    if (loaded.ok && loaded.value) {
      this.live.set(loaded.value);
      this.reconcileRoster(); // poda jugadores persistidos que ya no están conectados
    } else {
      this.live.set(new Room(roomId));
      await this.ctx.storage.put('roomId', roomId);
    }
  }

  private newPlayerId(): string {
    // ASCII corto y sin colisiones prácticas (el wire usa ids ASCII).
    return crypto.randomUUID().replace(/-/g, '').slice(0, 8);
  }

  private async handleControl(ws: WebSocket, playerId: string, raw: string): Promise<void> {
    let msg: { type?: string; r?: number; g?: number; b?: number; a?: number };
    try {
      msg = JSON.parse(raw) as typeof msg;
    } catch {
      return; // mensaje malformado: ignorar
    }
    const room = this.live.current();
    if (!room) return;
    // Los use-cases devuelven Result; si fallan (NotHost, WrongPhase, ColorLocked,
    // StorageError…) se avisa al cliente con un frame de error (no se silencia).
    if (msg.type === 'start') {
      const res = await this.startGame.execute({ roomId: room.id, playerId });
      if (res.ok) this.forceKeyframe = true;
      else ws.send(JSON.stringify({ type: 'error', cmd: 'start', kind: res.error.kind }));
    } else if (msg.type === 'restart') {
      const res = await this.restartGame.execute({ roomId: room.id, playerId });
      if (res.ok) this.forceKeyframe = true;
      else ws.send(JSON.stringify({ type: 'error', cmd: 'restart', kind: res.error.kind }));
    } else if (msg.type === 'color') {
      const res = await this.changeColor.execute({
        roomId: room.id,
        playerId,
        r: msg.r ?? 0,
        g: msg.g ?? 0,
        b: msg.b ?? 0,
        a: msg.a ?? 255,
      });
      if (!res.ok) ws.send(JSON.stringify({ type: 'error', cmd: 'color', kind: res.error.kind }));
    } else if (msg.type === 'whistle') {
      // V1-H rework: silbido MANUAL del Hider (valida rol/fase/cooldown y difunde).
      this.handleWhistle(playerId, room);
    }
  }

  private dropConnection(ws: WebSocket): void {
    const playerId = (ws.deserializeAttachment() as Attachment | null)?.playerId;
    const room = this.live.current();
    if (playerId && room) {
      removePlayer(room.world, playerId);
      room.roster.delete(playerId);
      if (room.hostId === playerId) {
        // El host se fue: pásalo al primer jugador que quede y avísale.
        room.hostId = room.roster.keys().next().value ?? null;
        if (room.hostId) this.notifyHost(room.hostId);
      }
      this.forceKeyframe = true; // cambió el roster → el delta ya no es válido
      this.broadcastRoster(room); // V1-E: el resto ve la lista actualizada
    }
    try {
      ws.close();
    } catch {
      /* ya cerrado */
    }
    this.stopLoopIfEmpty();
  }

  /**
   * Reconcilia el roster con los sockets VIVOS (`getWebSockets`), la única verdad de
   * quién está conectado: elimina jugadores fantasma (cierres abruptos sin `close`,
   * estado persistido viejo), reasigna el host si se fue, y resetea la sala a Lobby si
   * queda vacía (evita reconectar a una partida fantasma). Devuelve true si cambió algo.
   */
  private reconcileRoster(): boolean {
    const room = this.live.current();
    if (!room) return false;
    const live = new Set<string>();
    for (const ws of this.ctx.getWebSockets()) {
      const pid = (ws.deserializeAttachment() as Attachment | null)?.playerId;
      if (pid) live.add(pid);
    }
    let changed = false;
    for (const id of [...room.world.players.keys()]) {
      if (!live.has(id)) {
        removePlayer(room.world, id);
        room.roster.delete(id);
        changed = true;
      }
    }
    if (room.hostId !== null && !live.has(room.hostId)) {
      room.hostId = room.roster.keys().next().value ?? null;
      if (room.hostId) this.notifyHost(room.hostId);
      changed = true;
    }
    // Sala sin NADIE conectado pero en fase != lobby → devuélvela a lobby para que pueda
    // renacer. NO depende de `changed`: una sala persistida con 0 jugadores y fase
    // 'ended'/'prep' (el último jugador se fue sin que se reseteara la fase) quedaría
    // ENVENENADA — rechazaría todo `PlayerJoin` con AlreadyStarted de forma permanente.
    if (room.world.players.size === 0 && room.world.phase !== 'lobby') {
      room.world.phase = 'lobby';
      room.world.phaseEndsAtTick = 0;
      room.world.outcome = 'none';
      room.hostId = null;
      changed = true;
    }
    return changed;
  }

  /** Avisa al nuevo host para que su cliente habilite "Empezar". */
  private notifyHost(playerId: string): void {
    for (const ws of this.ctx.getWebSockets()) {
      if ((ws.deserializeAttachment() as Attachment | null)?.playerId === playerId) {
        try {
          ws.send(JSON.stringify({ type: 'host', isHost: true }));
        } catch {
          /* socket cerrándose */
        }
        return;
      }
    }
  }

  /**
   * V1-E — difunde la lista de jugadores (id + nombre + host) a TODOS los sockets.
   * Camino FRÍO (una vez por join/leave/reconcile con cambio; nunca por tick):
   * el JSON de control está permitido aquí por `authoritative-netcode` (mensajes
   * raros de control ≠ snapshots). Los nombres viven en `roster` (server-only);
   * el keyframe binario no los lleva ⇒ el lobby necesita este evento.
   */
  private broadcastRoster(room: Room): void {
    const sockets = this.ctx.getWebSockets();
    if (sockets.length === 0) return;
    const players: { id: string; name: string; isHost: boolean }[] = [];
    for (const [id, player] of room.roster) {
      players.push({ id, name: player.displayName, isHost: id === room.hostId });
    }
    const msg = JSON.stringify({ type: 'roster', hostId: room.hostId, players });
    for (let i = 0; i < sockets.length; i++) {
      try {
        sockets[i]!.send(msg);
      } catch {
        /* socket cerrándose: lo limpiará webSocketClose */
      }
    }
  }

  /**
   * Arranca el bucle de 30 Hz mientras la partida está viva (impide hibernar a
   * propósito). Idempotente. Suposición de runtime MONOHILO: `setInterval` y los
   * handlers de WebSocket se ejecutan secuencialmente sin reentrada; no añadir
   * `async/await` dentro de `tick()` sin sincronizar el estado del bucle.
   */
  private ensureLoop(): void {
    if (this.loop) return;
    this.loop = setInterval(() => this.tick(), TICK_MS);
  }

  /** Regenera el mapa de la ronda y actualiza la física si cambió el `mapSeed`. */
  private ensureMap(mapSeed: number): void {
    const seed = (mapSeed >>> 0) || 1;
    if (seed === this.currentMapSeed) return;
    this.currentMapSeed = seed;
    this.currentMap = generateMap(seed);
    this.physics.setMap(this.currentMap);
  }

  private stopLoopIfEmpty(): void {
    if (this.ctx.getWebSockets().length > 0) return;
    if (this.loop) {
      clearInterval(this.loop);
      this.loop = null;
    }
    // Persistir el estado final antes de quedar elegible para hibernar.
    const room = this.live.current();
    if (room) void this.persist.save(room);
  }

  /** Un tick autoritativo: drena inputs → simula (sync) → transmite → persiste a veces. */
  private tick(): void {
    if (!this.loop) return; // defensivo: no simular si el bucle ya fue detenido
    const room = this.live.current();
    if (!room) return;

    // 0) Reconciliar el roster con los sockets vivos (~1 s): limpia fantasmas de
    //    cierres abruptos que no dispararon webSocketClose.
    if (++this.ticksSinceReconcile >= KEYFRAME_EVERY) {
      this.ticksSinceReconcile = 0;
      if (this.reconcileRoster()) {
        this.forceKeyframe = true;
        this.broadcastRoster(room); // V1-E: fantasmas fuera del roster difundido
      }
    }

    // 1) Simulación determinista (sin I/O, sin asignar). RNG enhebrado vía world.rngState.
    //    Antes: si la ronda cambió de mapa (nuevo mapSeed), regenéralo y actualiza la
    //    física (oclusión del rayo) — no es camino caliente (una vez por ronda).
    this.ensureMap(room.world.mapSeed);
    this.rng.setState(room.world.rngState);
    step(room.world, this.inbox, DT, this.rng, this.physics, this.currentMap);
    room.world.rngState = this.rng.getState();
    this.inbox.length = 0; // reutiliza el array (sin reasignar)

    // 2) Transmitir: KEYFRAME (recién unidos / roster cambiado / periódico) o DELTA.
    this.broadcast(room);

    // 3) Persistencia periódica (fuera del camino crítico del tick).
    if (++this.ticksSincePersist >= PERSIST_EVERY) {
      this.ticksSincePersist = 0;
      void this.persist.save(room);
    }
  }

  private broadcast(room: Room): void {
    const sockets = this.ctx.getWebSockets();
    if (sockets.length === 0) return;

    // KEYFRAME si el roster cambió (forceKeyframe / tamaño distinto a la base),
    // periódicamente, o si no hay base. DELTA en el resto.
    const rosterChanged = this.baseline === null || this.baseline.size !== room.world.players.size;
    const sendKeyframe = this.forceKeyframe || rosterChanged || ++this.ticksSinceKeyframe >= KEYFRAME_EVERY;
    // Una sola codificación para TODOS (cada jugador lee su propio lastProcessedInput).
    // .slice() copia fuera del buffer pooleado: seguro para enviar a varios sockets y
    // para que el próximo tick reescriba el buffer sin corromper envíos en vuelo.
    const buf = (sendKeyframe ? encodeKeyframe(room.world) : encodeDelta(this.baseline!, room.world)).slice();
    if (sendKeyframe) {
      this.forceKeyframe = false;
      this.ticksSinceKeyframe = 0;
    }
    for (let i = 0; i < sockets.length; i++) {
      try {
        sockets[i]!.send(buf);
      } catch {
        /* socket cerrándose: lo limpiará webSocketClose */
      }
    }
    this.baseline = captureBaseline(room.world);
  }

  /**
   * V1-H rework (playtest r3) — silbido MANUAL: el Hider lo dispara (tecla T del
   * cliente ⇒ control JSON). Reglas (autoritativas): solo en HUNT, solo Hiders
   * vivos, con cooldown anti-spam. Difunde a TODOS (el silbador se oye a sí
   * mismo: confirma que la pista salió). Presentación pura: no toca la sim.
   */
  private handleWhistle(playerId: string, room: Room): void {
    if (room.world.phase !== 'hunt') return; // en lobby/prep no hay pistas que dar
    const p = room.world.players.get(playerId);
    if (!p || p.role !== 'hider' || p.caught) return; // solo Hiders vivos
    const now = Date.now();
    if (now < (this.whistleNextAt.get(playerId) ?? 0)) return; // cooldown
    this.whistleNextAt.set(playerId, now + WHISTLE_COOLDOWN_MS);
    this.sendControl(
      JSON.stringify({ type: 'whistle', playerId, x: p.pos.x, y: p.pos.y, z: p.pos.z }),
    );
  }

  /** Envía un mensaje de control JSON a todos los sockets vivos (camino frío). */
  private sendControl(msg: string): void {
    const sockets = this.ctx.getWebSockets();
    for (let i = 0; i < sockets.length; i++) {
      try {
        sockets[i]!.send(msg);
      } catch {
        /* socket cerrándose: lo limpiará webSocketClose */
      }
    }
  }
}

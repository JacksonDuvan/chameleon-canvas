/**
 * Tests de integración del Durable Object en el runtime real (workerd) vía
 * `@cloudflare/vitest-pool-workers`. Enfocados a las COSTURAS que solo el runtime
 * ejerce: upgrade de WebSocket, handshake de join, y persistencia/rehidratación de
 * storage. La lógica de juego (sim, use-cases, wire) ya está cubierta por tests puros.
 *
 * WebSockets en DO requieren storage compartido: correr con
 * `--no-isolate --poolOptions.workers.singleWorker` (script `test:do`).
 * Skill `tdd-testing`.
 */
import { env, runInDurableObject } from 'cloudflare:test';
import { describe, it, expect } from 'vitest';
import { decodeSnapshot, encodeInput, ActionKind } from '@mecha/shared';

/** Mensaje roster difundido por el DO (camino frío, JSON de control). */
interface RosterMsg {
  type: 'roster';
  hostId: string | null;
  players: { id: string; name: string; isHost: boolean }[];
}

/**
 * Coleccionista de mensajes JSON de control (welcome/roster/error). Buffera
 * todo lo que llega y permite esperar (poll) hasta que aparezca uno que cumpla
 * un predicado — tolera el orden variable welcome→roster y las ráfagas.
 */
class JsonCollector {
  private readonly seen: unknown[] = [];
  private waiters: Array<() => void> = [];

  constructor(ws: WebSocket) {
    ws.addEventListener('message', (e) => {
      if (typeof e.data !== 'string') return;
      try {
        this.seen.push(JSON.parse(e.data));
      } catch {
        /* control malformado: ignorar */
      }
      // Intercambia ANTES de invocar: un waiter puede re-registrarse y mutar
      // `waiters` (iterar el array vivo sería un bucle infinito).
      const pending = this.waiters;
      this.waiters = [];
      for (const w of pending) w();
    });
  }

  /** Resuelve con el primer mensaje (nuevo o ya visto) que cumpla `pred`. */
  until(pred: (m: unknown) => boolean, timeoutMs = 5000): Promise<unknown> {
    const found = this.seen.find(pred);
    if (found) return Promise.resolve(found);
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new Error(`timeout esperando mensaje de control (vistos: ${this.seen.length})`));
      }, timeoutMs);
      const poll = (): void => {
        const f = this.seen.find(pred);
        if (f !== undefined) {
          clearTimeout(timer);
          resolve(f);
        } else {
          this.waiters.push(poll);
        }
      };
      this.waiters.push(poll);
    });
  }
}

function stubFor(name: string) {
  const id = env.GAME_ROOM.idFromName(name);
  return env.GAME_ROOM.get(id);
}

function connect(stub: DurableObjectStub, roomId: string, name = 'Player') {
  return stub.fetch(`https://do/api/rooms/${roomId}/ws?name=${name}`, {
    headers: { Upgrade: 'websocket' },
  });
}

describe('GameRoomDO (integración, workerd)', () => {
  it('rechaza peticiones que no son upgrade de WebSocket (426)', async () => {
    const res = await stubFor('r-426').fetch('https://do/api/rooms/r-426/ws');
    expect(res.status).toBe(426);
  });

  it('acepta el upgrade, hace join y responde 101 con webSocket', async () => {
    const res = await connect(stubFor('r-101'), 'r-101', 'Ana');
    expect(res.status).toBe(101);
    expect(res.webSocket).toBeTruthy();
    res.webSocket!.accept();
    res.webSocket!.close();
  });

  it('el WELCOME trae el playerId asignado por el servidor', async () => {
    const res = await connect(stubFor('r-welcome'), 'r-welcome', 'Cara');
    const ws = res.webSocket!;
    const msg = await new Promise<string>((resolve) => {
      ws.addEventListener('message', (e) => resolve(e.data as string), { once: true });
      ws.accept();
    });
    const welcome = JSON.parse(msg) as { type: string; playerId: string };
    expect(welcome.type).toBe('welcome');
    expect(typeof welcome.playerId).toBe('string');
    expect(welcome.playerId.length).toBeGreaterThan(0);
    ws.close();
  });

  it('el bucle 30 Hz transmite snapshots binarios por el socket tras unirse', async () => {
    const res = await connect(stubFor('r-snap'), 'r-snap', 'Dia');
    const ws = res.webSocket!;
    ws.binaryType = 'arraybuffer'; // recibir frames binarios como ArrayBuffer
    const snapBuf = await new Promise<ArrayBuffer>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('no llegó snapshot binario')), 3000);
      ws.addEventListener('message', (e) => {
        if (typeof e.data !== 'string') {
          clearTimeout(timer);
          resolve(e.data as ArrayBuffer);
        }
      });
      ws.accept();
    });
    const snap = decodeSnapshot(snapBuf);
    expect(['keyframe', 'delta']).toContain(snap.type);
    expect(snap.tick).toBeGreaterThanOrEqual(1);
    expect(snap.players.length).toBeGreaterThanOrEqual(1); // el jugador que se unió
    ws.close();
  });

  it('persiste el roomId (costura de storage / rehidratación)', async () => {
    const stub = stubFor('r-persist');
    const res = await connect(stub, 'r-persist', 'Bob');
    res.webSocket!.accept();
    await runInDurableObject(stub, async (_instance, state) => {
      expect(await state.storage.get('roomId')).toBe('r-persist');
    });
    res.webSocket!.close();
  });

  it('una sala vacía en fase != lobby RENACE en lobby al reconectar (no queda envenenada)', async () => {
    // Regresión: al irse el último jugador tras una ronda, la sala quedaba persistida
    // con 0 jugadores y fase 'ended'/'prep'. PlayerJoin rechazaba a TODO nuevo jugador
    // con AlreadyStarted (409) de forma permanente → "no vuelve a iniciar".
    const stub = stubFor('r-reborn');
    const first = await connect(stub, 'r-reborn', 'Uno');
    first.webSocket!.accept();

    type PoisonRoom = {
      world: { players: Map<string, unknown>; phase: string; outcome: string };
      roster: Map<string, unknown>;
      hostId: string | null;
    };
    const current = (instance: unknown): PoisonRoom | null =>
      (instance as { live: { current(): PoisonRoom | null } }).live.current();

    await runInDurableObject(stub, async (instance) => {
      const room = current(instance);
      if (!room) throw new Error('sala no cargada');
      room.world.players.clear();
      room.roster.clear();
      room.hostId = null;
      room.world.phase = 'ended';
      room.world.outcome = 'seekers';
    });
    first.webSocket!.close();

    const res = await connect(stub, 'r-reborn', 'Dos');
    expect(res.status).toBe(101); // antes: 409 AlreadyStarted permanente
    res.webSocket!.accept();
    await runInDurableObject(stub, async (instance) => {
      expect(current(instance)?.world.phase).toBe('lobby'); // renació
    });
    res.webSocket!.close();
  });

  // ── ROSTER en vivo (V1-E): lista de jugadores con nombres para el lobby ──

  it('difunde el ROSTER con nombres al unirse cada jugador', async () => {
    const stub = stubFor('r-roster');
    const a = await connect(stub, 'r-roster', 'Ana');
    const wsA = a.webSocket!;
    const colA = new JsonCollector(wsA);
    wsA.accept();

    const solo = (await colA.until(
      (m) => (m as RosterMsg).type === 'roster' && (m as RosterMsg).players?.length === 1,
    )) as RosterMsg;
    expect(solo.players[0]!.name).toBe('Ana');
    expect(solo.players[0]!.isHost).toBe(true); // la primera en llegar es host

    const b = await connect(stub, 'r-roster', 'Bob');
    const wsB = b.webSocket!;
    const colB = new JsonCollector(wsB);
    wsB.accept();

    const duo = (await colA.until(
      (m) => (m as RosterMsg).type === 'roster' && (m as RosterMsg).players?.length === 2,
    )) as RosterMsg;
    const names = duo.players.map((p) => p.name).sort();
    expect(names).toEqual(['Ana', 'Bob']);
    expect(duo.players.filter((p) => p.isHost)).toHaveLength(1);

    // El recién llegado también recibe el roster (se ve a sí mismo + a Ana).
    await colB.until(
      (m) => (m as RosterMsg).type === 'roster' && (m as RosterMsg).players?.length === 2,
    );

    wsA.close();
    wsB.close();
  });

  it('difunde el roster actualizado cuando un jugador se va', async () => {
    const stub = stubFor('r-roster-leave');
    const a = await connect(stub, 'r-roster-leave', 'Ana');
    const b = await connect(stub, 'r-roster-leave', 'Bob');
    const wsA = a.webSocket!;
    const wsB = b.webSocket!;
    const colA = new JsonCollector(wsA);
    wsA.accept();
    wsB.accept();
    await colA.until(
      (m) => (m as RosterMsg).type === 'roster' && (m as RosterMsg).players?.length === 2,
    );

    wsB.close(); // Bob se va
    const after = (await colA.until(
      (m) => (m as RosterMsg).type === 'roster' && (m as RosterMsg).players?.length === 1,
    )) as RosterMsg;
    expect(after.players[0]!.name).toBe('Ana');
    wsA.close();
  });

  it('reasigna el host al irse el actual y lo refleja en el roster', async () => {
    const stub = stubFor('r-roster-host');
    const a = await connect(stub, 'r-roster-host', 'Ana'); // host
    const b = await connect(stub, 'r-roster-host', 'Bob');
    const wsA = a.webSocket!;
    const wsB = b.webSocket!;
    const colB = new JsonCollector(wsB);
    wsA.accept();
    wsB.accept();
    // Roster con ambos: ahí está el playerId de Bob (asignado por el servidor).
    const duo = (await colB.until(
      (m) => (m as RosterMsg).type === 'roster' && (m as RosterMsg).players?.length === 2,
    )) as RosterMsg;
    const bobId = duo.players.find((p) => p.name === 'Bob')!.id;
    expect(duo.hostId).not.toBe(bobId); // Ana sigue siendo host

    wsA.close(); // el host se va ⇒ Bob debe heredar el host
    const inherited = (await colB.until(
      (m) => (m as RosterMsg).type === 'roster' && (m as RosterMsg).hostId === bobId,
    )) as RosterMsg;
    const bob = inherited.players.find((p) => p.name === 'Bob');
    expect(bob!.isHost).toBe(true);
    wsB.close();
  });

  it('sanea el nombre: recorta espacios, vacío y >24 chars (traducción de protocolo)', async () => {
    const stub = stubFor('r-roster-name');
    const a = await connect(stub, 'r-roster-name', '   '); // vacío tras trim
    const b = await connect(stub, 'r-roster-name', 'X'.repeat(40)); // demasiado largo
    const wsA = a.webSocket!;
    const wsB = b.webSocket!;
    const colB = new JsonCollector(wsB);
    wsA.accept();
    wsB.accept();
    const roster = (await colB.until(
      (m) => (m as RosterMsg).type === 'roster' && (m as RosterMsg).players?.length === 2,
    )) as RosterMsg;
    const names = roster.players.map((p) => p.name);
    expect(names).toContain('Player'); // el vacío cae al default
    expect(names).toContain('X'.repeat(24)); // recortado a 24
    wsA.close();
    wsB.close();
  });

  it('ESTRÉS: 12 jugadores entran en ráfaga y el roster converge a 12', async () => {
    const stub = stubFor('r-stress-join');
    const sockets: WebSocket[] = [];
    for (let i = 0; i < 12; i++) {
      const res = await connect(stub, 'r-stress-join', `P${i}`);
      sockets.push(res.webSocket!);
    }
    const last = sockets[11]!;
    const col = new JsonCollector(last);
    last.accept();
    for (let i = 0; i < 11; i++) sockets[i]!.accept();

    const full = (await col.until(
      (m) => (m as RosterMsg).type === 'roster' && (m as RosterMsg).players?.length === 12,
      8000,
    )) as RosterMsg;
    expect(new Set(full.players.map((p) => p.name)).size).toBe(12); // sin duplicados

    // La mitad se va en ráfaga ⇒ el roster converge a 6.
    for (let i = 0; i < 6; i++) sockets[i]!.close();
    await col.until(
      (m) => (m as RosterMsg).type === 'roster' && (m as RosterMsg).players?.length === 6,
      8000,
    );

    for (const ws of sockets) {
      try {
        ws.close();
      } catch {
        /* ya cerrado */
      }
    }
  });

  it('ESTRÉS: flood de 300 inputs binarios en ráfaga no mata el bucle (siguen llegando snapshots)', async () => {
    const stub = stubFor('r-stress-flood');
    const res = await connect(stub, 'r-stress-flood', 'Flooder');
    const ws = res.webSocket!;
    ws.binaryType = 'arraybuffer';
    ws.accept();

    // 300 inputs válidos de golpe (el inbox del DO debe drenarlos por tick).
    for (let seq = 1; seq <= 300; seq++) {
      ws.send(
        encodeInput({
          seq,
          moveX: 1,
          moveZ: 0,
          aimX: 0,
          aimY: 0,
          aimZ: 1,
          pose: 0,
          action: ActionKind.NONE,
        }),
      );
    }

    // El bucle sigue vivo: llega un snapshot binario con tick avanzado.
    const snapBuf = await new Promise<ArrayBuffer>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('no llegó snapshot tras el flood')), 8000);
      ws.addEventListener('message', (e) => {
        if (typeof e.data !== 'string') {
          clearTimeout(timer);
          resolve(e.data as ArrayBuffer);
        }
      });
    });
    const snap = decodeSnapshot(snapBuf);
    expect(snap.tick).toBeGreaterThan(0);
    expect(snap.players.length).toBe(1);
    ws.close();
  });
});

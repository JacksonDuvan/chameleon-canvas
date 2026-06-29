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
import { decodeSnapshot } from '@mecha/shared';

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
});

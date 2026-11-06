/**
 * Tests del use-case CreateRoom (TDD, skill `tdd-testing`): fakes en memoria,
 * aserciones sobre Result (nunca throws), camino Ok + cada Err.
 */
import { describe, it, expect } from 'vitest';
import { CreateRoom } from './CreateRoom';
import { FakeRoomRegistry } from '../../../../test/fakes/FakeRoomRegistry';
import { FakeRandomSource } from '../../../../test/fakes/FakeRandomSource';
import { expectOk, expectErr } from '../../../../test/helpers/result';
import { isValidRoomCode, roomCodeFromBytes, ROOM_CODE_LENGTH } from '@shared/room';

const BYTES_A = new Uint8Array([1, 2, 3, 4, 5]); // código A
const BYTES_B = new Uint8Array([6, 7, 8, 9, 10]); // código B (≠ A)

describe('CreateRoom', () => {
  it('registra la sala y devuelve un código válido (Ok)', async () => {
    const registry = new FakeRoomRegistry();
    const create = new CreateRoom(registry, new FakeRandomSource());
    const res = expectOk(await create.execute({ hostName: 'Ana' }));
    expect(isValidRoomCode(res.roomId)).toBe(true);
    const list = expectOk(await registry.list());
    expect(list.some((r) => r.roomId === res.roomId && r.hostName === 'Ana')).toBe(true);
  });

  it('el código NO depende del nombre del host (no se hashea el host)', async () => {
    const a = expectOk(
      await new CreateRoom(new FakeRoomRegistry(), new FakeRandomSource()).execute({ hostName: 'A' }),
    );
    const b = expectOk(
      await new CreateRoom(new FakeRoomRegistry(), new FakeRandomSource()).execute({ hostName: 'Otro' }),
    );
    expect(a.roomId).toBe(b.roomId); // mismos bytes random ⇒ mismo código
  });

  it('si el código choca con una sala existente, reintenta con otro (Ok con el 2º)', async () => {
    const registry = new FakeRoomRegistry();
    // El código de BYTES_A está ocupado por una sala "fantasma" (no listada).
    registry.take(roomCodeFromBytes(BYTES_A));
    // La 1ª generación choca (BYTES_A) → la 2ª (BYTES_B) debe usarse para la sala nueva.
    const create = new CreateRoom(registry, new FakeRandomSource([BYTES_A, BYTES_B]));
    const res = expectOk(await create.execute({ hostName: 'Bob' }));
    expect(res.roomId).toBe(roomCodeFromBytes(BYTES_B));
    expect(isValidRoomCode(res.roomId)).toBe(true);
  });

  it('Err CodeCollision si TODOS los reintentos chocan (códigos ocupados)', async () => {
    const registry = new FakeRoomRegistry();
    // Ocupa EXACTAMENTE el código que generará la fuente (siempre los mismos bytes).
    registry.take(roomCodeFromBytes(BYTES_A));
    const create = new CreateRoom(registry, FakeRandomSource.always(BYTES_A));
    expectErr(await create.execute({ hostName: 'Ana' }), 'CodeCollision');
  });

  it('Err RegistryError si el registro falla al comprobar existencia', async () => {
    const registry = new FakeRoomRegistry();
    registry.failNextCalls = 1;
    const create = new CreateRoom(registry, new FakeRandomSource());
    expectErr(await create.execute({ hostName: 'Ana' }), 'RegistryError');
  });

  it('Err RegistryError si el registro falla al guardar', async () => {
    const registry = new FakeRoomRegistry();
    registry.failNextCalls = 2; // exists OK (1ª) → register falla (2ª)
    const create = new CreateRoom(registry, new FakeRandomSource());
    expectErr(await create.execute({ hostName: 'Ana' }), 'RegistryError');
  });

  it('ESTRÉS: 1000 salas seguidas producen 1000 códigos válidos y únicos', async () => {
    const registry = new FakeRoomRegistry();
    const create = new CreateRoom(registry, new FakeRandomSource());
    const seen = new Set<string>();
    for (let i = 0; i < 1000; i++) {
      const res = expectOk(await create.execute({ hostName: `h${i}` }));
      expect(res.roomId.length).toBe(ROOM_CODE_LENGTH);
      expect(isValidRoomCode(res.roomId)).toBe(true);
      seen.add(res.roomId);
    }
    expect(seen.size).toBe(1000); // sin colisiones con el contador determinista
  });
});

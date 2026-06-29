import { describe, it, expect } from 'vitest';
import { SingleRoomRepository } from './SingleRoomRepository';
import { Room } from '@/slices/gameplay/domain/entities/Room';
import { expectOk } from '../../../../../test/helpers/result';

describe('SingleRoomRepository', () => {
  it('load devuelve la sala viva cuando el id coincide', async () => {
    const room = new Room('r1');
    const repo = new SingleRoomRepository(room);
    expect(expectOk(await repo.load('r1'))).toBe(room);
  });

  it('load devuelve null si el id no coincide o no hay sala', async () => {
    const repo = new SingleRoomRepository(new Room('r1'));
    expect(expectOk(await repo.load('otra'))).toBeNull();
    expect(expectOk(await new SingleRoomRepository().load('r1'))).toBeNull();
  });

  it('save actualiza la sala viva y current() la refleja', async () => {
    const repo = new SingleRoomRepository();
    const room = new Room('r1');
    expectOk(await repo.save(room));
    expect(repo.current()).toBe(room);
  });
});

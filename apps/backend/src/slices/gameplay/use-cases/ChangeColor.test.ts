import { describe, it, expect } from 'vitest';
import { ChangeColor } from './ChangeColor';
import { Room } from '../domain/entities/Room';
import { spawnPlayer } from '@mecha/sim';
import { InMemoryRoomRepository } from '../../../../test/fakes/InMemoryRoomRepository';
import { expectOk, expectErr } from '../../../../test/helpers/result';

function prepRoomWithPlayer(): Room {
  const room = new Room('r1');
  spawnPlayer(room.world, 'p0');
  room.world.phase = 'prep';
  return room;
}

function setup(room: Room) {
  const repo = new InMemoryRoomRepository();
  repo.seed(room);
  return { repo, changeColor: new ChangeColor(repo) };
}

const RED = { r: 200, g: 30, b: 30, a: 255 };

describe('ChangeColor', () => {
  it('en Prep aplica el color y fija el bloqueo anti-spam', async () => {
    const room = prepRoomWithPlayer();
    const { changeColor } = setup(room);
    expectOk(await changeColor.execute({ roomId: 'r1', playerId: 'p0', ...RED }));
    const p = room.world.players.get('p0')!;
    expect([p.color.r, p.color.g, p.color.b]).toEqual([200, 30, 30]);
    expect(p.colorLockedUntil).toBe(room.world.tick + room.world.config.colorLockTicks);
  });

  it('Err WrongPhase fuera de la Prep Phase', async () => {
    const room = prepRoomWithPlayer();
    room.world.phase = 'hunt';
    const { changeColor } = setup(room);
    expectErr(
      await changeColor.execute({ roomId: 'r1', playerId: 'p0', ...RED }),
      'WrongPhase',
    );
  });

  it('Err ColorLocked si el color está bloqueado en este tick', async () => {
    const room = prepRoomWithPlayer();
    room.world.players.get('p0')!.colorLockedUntil = room.world.tick + 10;
    const { changeColor } = setup(room);
    expectErr(
      await changeColor.execute({ roomId: 'r1', playerId: 'p0', ...RED }),
      'ColorLocked',
    );
  });

  it('Err PlayerNotFound si el jugador no está en la sala', async () => {
    const { changeColor } = setup(prepRoomWithPlayer());
    expectErr(
      await changeColor.execute({ roomId: 'r1', playerId: 'ghost', ...RED }),
      'PlayerNotFound',
    );
  });
});

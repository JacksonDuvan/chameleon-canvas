import { describe, it, expect } from 'vitest';
import { ProcessTick } from './ProcessTick';
import { Room } from '../domain/entities/Room';
import { spawnPlayer, KinematicPhysicsWorld } from '@mecha/sim';
import { ActionKind, type UserCommand } from '@shared/protocol';
import { InMemoryRoomRepository } from '../../../../test/fakes/InMemoryRoomRepository';
import { expectOk, expectErr } from '../../../../test/helpers/result';

const DT = 1 / 30;

function setup(room?: Room) {
  const repo = new InMemoryRoomRepository();
  if (room) repo.seed(room);
  return { repo, tick: new ProcessTick(repo, new KinematicPhysicsWorld()) };
}

function cmd(playerId: string, over: Partial<UserCommand> = {}): UserCommand {
  return {
    seq: 1,
    playerId,
    moveX: 0,
    moveZ: 0,
    aimX: 0,
    aimZ: 1,
    action: ActionKind.NONE,
    ...over,
  };
}

describe('ProcessTick', () => {
  it('Err RoomNotFound si la sala no existe', async () => {
    const { tick } = setup();
    expectErr(await tick.execute({ roomId: 'x', commands: [], dt: DT }), 'RoomNotFound');
  });

  it('avanza el tick y persiste el estado', async () => {
    const room = new Room('r1');
    spawnPlayer(room.world, 'h');
    room.world.players.get('h')!.pos.setMut(0, 0, 0); // mover desde un punto conocido (el spawn es una rejilla)
    room.world.phase = 'prep';
    const { repo, tick } = setup(room);

    expectOk(await tick.execute({ roomId: 'r1', commands: [cmd('h', { moveX: 1 })], dt: DT }));

    const reloaded = expectOk(await repo.load('r1'));
    expect(reloaded!.world.tick).toBe(1);
    expect(reloaded!.world.players.get('h')!.pos.x).toBeCloseTo(room.world.config.maxSpeed * DT, 9);
  });

  it('orquesta la captura por fijación: en Hunt el Seeker sostiene la mira y atrapa a un Hider', async () => {
    const room = new Room('r1');
    spawnPlayer(room.world, 's');
    spawnPlayer(room.world, 'h');
    room.world.phase = 'hunt';
    const s = room.world.players.get('s')!;
    const h = room.world.players.get('h')!;
    s.role = 'seeker';
    s.pos.setMut(0, 0, 0);
    h.role = 'hider';
    h.frozen = true;
    h.pos.setMut(2, 0, 0);
    const { tick } = setup(room);

    // La captura ya no es instantánea (P0.3): el Seeker mantiene el gatillo. Sostener la
    // mira más que la fijación máxima garantiza el tag sea cual sea el camuflaje del objetivo.
    for (let i = 0; i < room.world.config.fixationMaxTicks + 5; i++) {
      expectOk(
        await tick.execute({
          roomId: 'r1',
          commands: [cmd('s', { seq: i + 1, aimX: 1, aimZ: 0, action: ActionKind.CATCH })],
          dt: DT,
        }),
      );
    }

    expect(h.caught).toBe(true);
    expect(h.role).toBe('seeker');
  });
});

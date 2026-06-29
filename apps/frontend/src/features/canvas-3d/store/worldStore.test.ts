import { describe, it, expect, beforeEach } from 'vitest';
import { worldStore } from './worldStore';
import { PlayerState } from '@mecha/sim';

describe('worldStore (Zustand vanilla)', () => {
  beforeEach(() => {
    worldStore.setState({
      local: new PlayerState('local'),
      remotes: new Map(),
      localPlayerId: null,
      serverTick: 0,
      phase: 'lobby',
      outcome: 'none',
      connected: false,
      isHost: false,
      localRole: 'hider',
      lastError: null,
    });
  });

  it('estado inicial coherente', () => {
    const s = worldStore.getState();
    expect(s.phase).toBe('lobby');
    expect(s.connected).toBe(false);
    expect(s.remotes.size).toBe(0);
    expect(s.local).toBeInstanceOf(PlayerState);
  });

  it('el estado LENTO se actualiza con setState (para selectores reactivos del HUD)', () => {
    worldStore.setState({ phase: 'hunt', outcome: 'hiders', connected: true });
    const s = worldStore.getState();
    expect(s.phase).toBe('hunt');
    expect(s.outcome).toBe('hiders');
    expect(s.connected).toBe(true);
  });

  it('el estado RÁPIDO se MUTA in situ (sin setState) y es visible vía getState', () => {
    // Así lo muta la red/predicción; useFrame lo lee con getState (cero re-renders).
    worldStore.getState().local.pos.setMut(3, 0, 4);
    worldStore.getState().serverTick = 42;
    expect(worldStore.getState().local.pos.x).toBe(3);
    expect(worldStore.getState().serverTick).toBe(42);
  });
});

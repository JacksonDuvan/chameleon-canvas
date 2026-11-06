/**
 * PlayerList — jugadores de la sala en el lobby (V1-E). Lee SOLO estado LENTO
 * (`lobbyRoster`: cambia una vez por join/leave) con selector reactivo ⇒ seguro
 * para React (skill `r3f-rendering`, regla 4). Biblia UX: "lista de jugadores
 * con roles/estado".
 */
import { useStore } from 'zustand';
import { worldStore } from '@/features/canvas-3d/store/worldStore';

export function PlayerList() {
  const roster = useStore(worldStore, (s) => s.lobbyRoster);
  if (roster.length === 0) return null;
  return (
    <div className="lobby-players" aria-label="Jugadores en la sala">
      {roster.map((p) => (
        <span
          key={p.id}
          className={`lobby-player${p.isHost ? ' lobby-player--host' : ''}`}
          title={p.isHost ? 'Host de la sala' : undefined}
        >
          {p.isHost ? '👑' : '🦎'} {p.name}
        </span>
      ))}
    </div>
  );
}

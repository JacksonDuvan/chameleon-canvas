/**
 * useAudio — conecta el ESTADO LENTO del worldStore con el motor de audio
 * (V1-H). Presentación pura (skill `r3f-rendering`): nada de audio por frame;
 * todo son transiciones raras (fase, captura, rol).
 *
 *  - Autoplay: el navegador exige un gesto ⇒ `unlock()` en el primer
 *    pointerdown/keydown (el click de pointer lock ya es el gesto).
 *  - Fases: prep ⇒ "a esconderse" + ambiente; ended ⇒ fanfarria/derrota;
 *    lobby ⇒ ambiente fuera.
 *  - hitPulse (servidor confirmó captura) ⇒ hit marker sonoro.
 *  - caught del local (estado RÁPIDO) ⇒ poll con bail-out (patrón del HUD),
 *    nunca por frame ni selector reactivo.
 */
import { useEffect } from 'react';
import { worldStore } from '@/features/canvas-3d/store/worldStore';
import { audio } from './engine';

const CAUGHT_POLL_MS = 150;

export function useAudio(): void {
  // 1) Desbloqueo del AudioContext en el primer gesto (política de autoplay).
  useEffect(() => {
    const unlock = (): void => audio.unlock();
    window.addEventListener('pointerdown', unlock, { once: true, passive: true });
    window.addEventListener('keydown', unlock, { once: true });
    return () => {
      window.removeEventListener('pointerdown', unlock);
      window.removeEventListener('keydown', unlock);
    };
  }, []);

  // 2) Transiciones LENTAS por suscripción (bail-out implícito: solo en cambio).
  useEffect(() => {
    const unsub = worldStore.subscribe((s, prev) => {
      if (s.phase !== prev.phase) {
        if (s.phase === 'prep') {
          audio.playRoundStart();
          audio.startAmbience();
        } else if (s.phase === 'hunt') {
          audio.startAmbience(); // idempotente (ya sonaba desde prep)
        } else if (s.phase === 'ended') {
          const win =
            s.outcome === 'none'
              ? false
              : s.outcome === 'seekers'
                ? s.localRole === 'seeker'
                : s.localRole === 'hider' && !s.local.caught;
          audio.playRoundEnd(win);
          audio.stopAmbience();
        } else if (s.phase === 'lobby') {
          audio.stopAmbience();
        }
      }
      if (s.hitPulse > prev.hitPulse) audio.playHit(); // el servidor confirmó captura
    });
    return unsub;
  }, []);

  // 3) "Me atraparon": estado RÁPIDO (PlayerState) ⇒ poll con bail-out, no por frame.
  useEffect(() => {
    let wasCaught = worldStore.getState().local.caught;
    const id = setInterval(() => {
      const caught = worldStore.getState().local.caught;
      if (caught && !wasCaught) audio.playCaught();
      wasCaught = caught;
    }, CAUGHT_POLL_MS);
    return () => clearInterval(id);
  }, []);

  // 4) Al desmontar (salir de la sala), el ambiente no debe quedar sonando.
  useEffect(() => () => audio.stopAmbience(), []);
}

/**
 * reveal — lógica PURA del "answer-check" (V1-F, biblia `mecha-chameleon-gamedesign`
 * §RESULTS): al terminar la ronda se REVELAN los escondites y trabajos de pintura de
 * todos los Hiders — el momento más divertido del original y su herramienta de
 * aprendizaje ("¡¿estaba AHÍ?!").
 *
 * Este módulo no toca three/React (testeable en node): construye la lista de
 * escondites a partir del estado final y resuelve QUÉ escondite toca según el tiempo.
 * La cámara (CameraRig) y la tarjeta del HUD consumen estos datos.
 *
 * Nota de roles: con la infección del modo base, un Hider ATRAPADO termina la ronda
 * con role 'seeker' y caught=true — sigue teniendo escondite que revelar. Un Seeker
 * DE ORIGEN termina con caught=false y role 'seeker' — no se revela.
 */

/** Segundos que la cámara dedica a cada escondite del tour. */
export const REVEAL_SECONDS = 3;

/** Estado final de un jugador al terminar la ronda (datos que ya están en el cliente). */
export interface RevealSubject {
  readonly id: string;
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly role: 'hider' | 'seeker';
  readonly caught: boolean;
  readonly colorPacked: number; // 0xRRGGBBAA (la pintura con la que terminó)
  readonly camoScore: number; // 0..1
  readonly pose: number; // 0..3
}

/** Entrada del tour de revelado (inmutable; se congela al entrar en `ended`). */
export interface RevealEntry {
  readonly id: string;
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly caught: boolean;
  readonly colorPacked: number;
  readonly camoScore: number;
  readonly pose: number;
}

/**
 * Lista de escondites a revelar: todos los que JUGARON de Hider — vivos (role
 * 'hider') o atrapados (caught=true, aunque la infección los volviera 'seeker').
 * Orden: atrapados primero, supervivientes al FINAL (el clímax del answer-check).
 */
export function buildRevealList(subjects: readonly RevealSubject[]): RevealEntry[] {
  const caught: RevealEntry[] = [];
  const survivors: RevealEntry[] = [];
  for (const s of subjects) {
    const wasHider = s.caught || s.role === 'hider';
    if (!wasHider) continue;
    const entry: RevealEntry = {
      id: s.id,
      x: s.x,
      y: s.y,
      z: s.z,
      caught: s.caught,
      colorPacked: s.colorPacked,
      camoScore: s.camoScore,
      pose: s.pose,
    };
    (s.caught ? caught : survivors).push(entry);
  }
  return [...caught, ...survivors];
}

/**
 * Índice del escondite que toca a los `elapsedS` segundos de tour, o -1 si el tour
 * terminó (o no hay nada que revelar) — entonces el HUD muestra el panel final.
 */
export function revealIndexAt(elapsedS: number, listLength: number): number {
  if (listLength <= 0) return -1;
  const i = Math.floor(Math.max(0, elapsedS) / REVEAL_SECONDS);
  return i >= listLength ? -1 : i;
}

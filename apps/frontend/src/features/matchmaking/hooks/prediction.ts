/**
 * Predicción y RECONCILIACIÓN del jugador local (lógica PURA, fuera de React).
 *
 * Skill `authoritative-netcode`:
 *  - Predicción: aplica el input local de inmediato usando EXACTAMENTE las mismas
 *    funciones deterministas que el servidor (`@mecha/sim`).
 *  - Reconciliación: ante un snapshot autoritativo, descarta los inputs ya
 *    confirmados (`seq <= lastProcessedInput`), resetea al estado autoritativo y
 *    RE-APLICA los pendientes encima. NUNCA hace snap (eso causa rubber-banding).
 *
 * Se extrae a funciones puras (no a `useFrame`/React) para poder testearlas —
 * skill `tdd-testing` (el test de reconciliación es de los más valiosos).
 */
import {
  applyAim,
  applyMovement,
  canMove,
  clampPose,
  type PlayerState,
  type SimConfig,
} from '@mecha/sim';
import type { GamePhase, UserCommand } from '@mecha/shared';

export interface PendingInput {
  readonly seq: number;
  readonly cmd: UserCommand;
  readonly dt: number;
}

/** Snapshot autoritativo del jugador local (subconjunto de DecodedPlayer). */
export interface AuthoritativeLocal {
  readonly lastProcessedInput: number;
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly aimX: number;
  readonly aimY: number;
  readonly aimZ: number;
  readonly role: PlayerState['role'];
  readonly frozen: boolean;
  readonly caught: boolean;
  readonly pose: number;
}

/** Predice un input sobre el jugador local (mismas funciones que el servidor). */
export function predict(
  local: PlayerState,
  input: PendingInput,
  phase: GamePhase,
  cfg: SimConfig,
): void {
  applyAim(local, input.cmd);
  if (canMove(phase, local)) applyMovement(local, input.cmd, cfg, input.dt);
  // Pose: MISMA regla de validación que el servidor (step.ts) para converger.
  if (local.role === 'hider' && !local.frozen && phase === 'prep') {
    local.pose = clampPose(input.cmd.pose);
  }
}

/**
 * Reconcilia el jugador local con el snapshot autoritativo. Muta `local` y `pending`
 * in situ. Tras esto, `local` = estado autoritativo + re-aplicación de los inputs aún
 * no confirmados (no la posición cruda del servidor).
 */
export function reconcile(
  local: PlayerState,
  pending: PendingInput[],
  auth: AuthoritativeLocal,
  phase: GamePhase,
  cfg: SimConfig,
): void {
  // 0) Defensa: si el servidor RETROCEDE lastProcessedInput (rollback/desync/bug),
  // la cola de pendientes ya no es fiable → límpiala y confía solo en el autoritativo
  // (en el camino normal nunca ocurre). Evita un desfase silencioso permanente.
  if (auth.lastProcessedInput < local.lastProcessedInput) pending.length = 0;

  // 1) Confía en el servidor: resetea el estado local al autoritativo.
  local.pos.setMut(auth.x, auth.y, auth.z);
  local.aimX = auth.aimX;
  local.aimY = auth.aimY;
  local.aimZ = auth.aimZ;
  local.role = auth.role;
  local.frozen = auth.frozen;
  local.caught = auth.caught;
  local.pose = auth.pose;
  local.lastProcessedInput = auth.lastProcessedInput;

  // 2) Descarta los inputs que el servidor ya contabilizó.
  let confirmed = 0;
  while (confirmed < pending.length && pending[confirmed]!.seq <= auth.lastProcessedInput) {
    confirmed++;
  }
  if (confirmed > 0) pending.splice(0, confirmed);

  // 3) Re-aplica los pendientes encima del estado autoritativo (re-predicción).
  for (let i = 0; i < pending.length; i++) predict(local, pending[i]!, phase, cfg);
}

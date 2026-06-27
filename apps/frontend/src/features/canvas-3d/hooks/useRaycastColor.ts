/**
 * useRaycastColor — el "cuentagotas". Al pulsar 'E', lanza un Raycaster desde la
 * cámara/avatar al entorno, lee el color/textura exacto del punto impactado y lo
 * aplica al material del avatar (camuflaje). Envía además la intención al servidor
 * (autoritativo valida fase Prep + lock de color).
 *
 * Skill `r3f-rendering`: reutiliza el Raycaster y vectores scratch (no asignar por
 * uso); no dispara setState por frame. Es lógica de input, no de render loop.
 *
 * SCAFFOLD del Paso 1 — Paso 4.
 */
export function useRaycastColor(): void {
  // TODO(Paso 4): Raycaster reutilizable; sampleo del color; dispatch CHANGE_COLOR.
}

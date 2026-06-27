/**
 * MechaMesh — el avatar 3D del jugador (camaleón). Su canvas/textura interno se
 * pinta dinámicamente con el color/textura absorbido del entorno (cuentagotas).
 *
 * Skill `r3f-rendering`: geometría/material memoizados y compartidos; la posición
 * se muta sobre el ref en useFrame (interpolada para remotos), nunca por setState.
 *
 * SCAFFOLD del Paso 1 — Paso 4. El modelo final será un .glb (Draco/Meshopt) vía
 * gltfjsx, optimizado como componente R3F.
 */
export function MechaMesh(_props: { playerId: string }) {
  // TODO(Paso 4): useRef<Mesh>; useFrame(() => lerp render pos); material con la
  // textura absorbida; pose seleccionable.
  return null;
}

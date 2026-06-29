/**
 * Player — metadatos de SESIÓN del jugador en el backend (server-only): nombre,
 * si es host, y entitlement de monetización resuelto al unirse. Complementa al
 * `PlayerState` cinemático de `@mecha/sim` (posición/rol/color que se predicen).
 */
export class Player {
  readonly id: string;
  displayName: string;
  isHost: boolean;
  /** Premium Club: salta anuncios (resuelto por IMonetizationService al unirse). */
  premium: boolean;

  constructor(id: string, displayName: string, isHost = false, premium = false) {
    this.id = id;
    this.displayName = displayName;
    this.isHost = isHost;
    this.premium = premium;
  }
}

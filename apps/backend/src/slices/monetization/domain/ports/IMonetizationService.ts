/**
 * Puerto de dominio del slice monetization (lo pide explícitamente el prompt).
 * Interfaz PEQUEÑA y enfocada (ISP): el gameplay solo necesita esta vista mínima
 * para decidir, p. ej., si saltar anuncios o permitir un cosmético premium.
 *
 * Los adaptadores (KV para entitlements/suscripción, R2 para texturas premium)
 * la implementan en `infrastructure/`. Skill `hexagonal-vertical-slicing` (DIP/ISP).
 *
 * SCAFFOLD del Paso 1 — interfaces listas (hooks de monetización), sin SDK real.
 */
import { type Result } from '@shared/result';

export interface MonetError {
  readonly kind: 'MonetizationUnavailable';
  readonly cause: string;
}

export interface Entitlement {
  readonly premiumClub: boolean; // suscripción "Premium Club" (salta anuncios)
  readonly ownedCosmetics: readonly string[];
}

export interface IMonetizationService {
  /** Entitlements del jugador (suscripción + cosméticos poseídos). */
  getEntitlement(playerId: string): Promise<Result<Entitlement, MonetError>>;
  /** ¿Debe saltarse los anuncios? (Premium Club). */
  shouldSkipAds(playerId: string): Promise<Result<boolean, MonetError>>;
}

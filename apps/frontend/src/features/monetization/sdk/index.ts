/**
 * SDK de monetización — INTERFACES + MOCK (placeholders listos, sin SDK real).
 *
 * El prompt pide dejar preparado el soporte futuro para:
 *   - AdSense for Games / CrazyGames SDK: anuncios Rewarded e Interstitial
 *     (antes/después de rondas).
 *   - Tienda de cosméticos: texturas premium custom (servidas desde R2/KV).
 *   - Verificación de suscripción "Premium Club" (saltarse anuncios).
 *
 * La UI consume SOLO estas interfaces; el adaptador real (CrazyGames SDK, etc.) se
 * inyecta después sin tocar los componentes (DIP). El backend tiene su propio
 * puerto `IMonetizationService` para la verificación autoritativa (KV/R2).
 *
 * SCAFFOLD del Paso 1.
 */

export interface AdsSdk {
  /** Anuncio recompensado; resuelve si el jugador completó el anuncio. */
  showRewarded(placement: string): Promise<{ rewarded: boolean }>;
  /** Anuncio intersticial (entre rondas). */
  showInterstitial(placement: string): Promise<void>;
}

export interface CosmeticsSdk {
  /** Cosméticos poseídos por el jugador (textura keys en R2). */
  listOwned(): Promise<readonly string[]>;
  /** Inicia compra de un cosmético (flujo externo). */
  purchase(cosmeticId: string): Promise<{ ok: boolean }>;
}

export interface MonetizationSdk {
  readonly ads: AdsSdk;
  readonly cosmetics: CosmeticsSdk;
  /** Suscripción "Premium Club": true ⇒ se saltan los anuncios. */
  isPremium(): Promise<boolean>;
}

/** MOCK no-op para desarrollo. Reemplazar por el adaptador del SDK real. */
export const mockMonetizationSdk: MonetizationSdk = {
  ads: {
    async showRewarded() {
      console.warn('[monetization mock] showRewarded — sin SDK real');
      return { rewarded: true };
    },
    async showInterstitial() {
      console.warn('[monetization mock] showInterstitial — sin SDK real');
    },
  },
  cosmetics: {
    async listOwned() {
      return [];
    },
    async purchase() {
      return { ok: false };
    },
  },
  async isPremium() {
    return false;
  },
};

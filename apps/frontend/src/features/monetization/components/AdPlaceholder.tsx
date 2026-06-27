/**
 * AdPlaceholder — hueco de anuncio (interstitial/rewarded) mostrado antes/después
 * de una ronda. Si el jugador es Premium Club, no se muestra. Consume el SDK mock
 * vía interfaz (sin acoplar al SDK real).
 *
 * SCAFFOLD del Paso 1.
 */
export function AdPlaceholder(_props: { placement: 'pre-round' | 'post-round' }) {
  // TODO: if (await sdk.isPremium()) return null; else sdk.ads.showInterstitial(...)
  return null;
}

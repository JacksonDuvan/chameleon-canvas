/**
 * Puerto de salida: entropía para generar códigos de sala.
 *
 * El dominio es determinista (sin `Math.random`); la aleatoriedad del CÓDIGO de
 * sala se inyecta por este puerto (skill `hexagonal-vertical-slicing`: sin
 * reloj/azar dentro del hexágono; skill `authoritative-netcode`: el código no es
 * estado de simulación, así que no afecta al determinismo del juego).
 */
export interface IRandomSource {
  /** n bytes criptográficamente aleatorios (adaptador: crypto.getRandomValues). */
  bytes(n: number): Uint8Array;
}

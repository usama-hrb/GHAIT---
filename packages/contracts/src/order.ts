/** A record as a device or the server holds it: with its server_seq once the server has it. */
export interface Sequenced {
  id: string;
  createdAt: string;
  /** null or absent: not on the server yet. */
  serverSeq?: number | null;
}

/**
 * The order of a history (a roll's moves, a sale's payments), the same on every device and the
 * server and immune to device clocks (BUILD_PROMPTS 3.6): what the server has, in the order it
 * received it (server_seq); then what is only on this device, in the order it was made there.
 */
export function syncOrder(a: Sequenced, b: Sequenced): number {
  const seqA = a.serverSeq ?? Number.POSITIVE_INFINITY;
  const seqB = b.serverSeq ?? Number.POSITIVE_INFINITY;
  if (seqA !== seqB) return seqA < seqB ? -1 : 1;
  return a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id);
}

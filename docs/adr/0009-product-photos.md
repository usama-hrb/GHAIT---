# ADR 0009: Photos of colours

- Status: Accepted
- Date: 2026-10-31

## Context

The owner asked for a photo on each product, uploaded from the app, so the till shows tiles with pictures (the POS redesign for a touch tablet). Constraints:

- Offline-first (ADR 0002): a photo is taken or chosen on a device that may be offline, shown at once, and reaches the other devices later. The sync engine carries records and an outbox of ops; there is no second channel.
- A camera shot is several MB (the sample, `apps/web/public/brand/product_1.jpeg`, is 2048 × 2048 and 2.2 MB). A tile is about 200 px wide.
- A cashier's device must show the photos but never change them (SPEC §11). Everything the server sends a device is kept on it.
- Records are never hard-deleted (CLAUDE.md); changes and voids are audited.

## Decision

**A photo belongs to a colour (a variant).** A tile at the till is a colour: each colour of a fabric looks different, so a picture of the fabric alone would not help to pick one. No fabric-level photo is built.

**`photo` is a synced entity** (`merge: 'mutable'`, but only its void ever changes): `variantId`, `contentType` (`image/jpeg`), `width`, `height`, `byteLength` and `data`, the JPEG in base64. A photo is never edited (the server refuses an upsert that differs, `PHOTO_ISSUES.fixed`); giving a colour another picture creates a new photo and voids the earlier ones with the reason `replaced`, taking it away voids them with `removed`. The colour shows its **newest live photo** (`currentPhotoOf`, ties broken by id, the same on every device): derived, never a pointer stored on the colour, so a rename and a photo made on two devices cannot overwrite each other.

**The bytes travel inside the record.** The device makes the picked file small before saving it (`compressImage`: longest side 480 px, JPEG, quality lowered until it is at most 120 KB, on white). A typical result is 30–60 KB. The server accepts up to 250 KB. `photoSchema` checks the base64, that the size says what the bytes are, and the JPEG signature, so the device, the API and an import all apply the same rules. This keeps one path for everything else: saved on the device with its op in one transaction (offline works), pushed and pulled by the existing engine, `CASHIER_ACCESS` (`photo`: the till sees it, cannot push it), export and import, `make backup`.

**Requests are sized as well as counted.** A photo is ~100 KB where every other record is a few hundred bytes, so:

- a push batch stops before the op that takes it over `SYNC_BATCH_MAX_BYTES` (1 MB; `takeBatch` on the device), and the API accepts JSON bodies up to 4 MB (the default 100 KB would refuse one photo);
- a pull page is cut the same way (`syncWeightOf`, in `SyncService.pull`). A handler of heavy records returns only up to the record that takes the page over the budget, so nothing after it is skipped: `PhotoRepository.pull` reads the sizes first and the images only for the photos it keeps.

**The audit and conflict logs keep a placeholder, not the image** (`SyncHandler.auditView`: `[JPEG 52113 bytes]`), or every photo would add ~100 KB to `audit_log` twice.

**Screens.** `ProductPhoto` shows a picture from its `data:` URL, or a quiet placeholder. The owner sets it in the colour's dialog (`PhotoField`: choose a file; take a photo on a touch device), saved with the colour. It shows on the POS tiles, the bill's lines and the line dialog, the colours' list on the fabric page, and the stock screens. The CSV export of tables leaves photos out (the JSON export keeps them).

## Alternatives

A separate binary channel (`PUT`/`GET /photos/:id/content`, a blob cache on each device, an upload step after the record is acknowledged) keeps sync records small, but adds states the till must handle offline (record known, image not yet downloaded or uploaded), retries and cache eviction. With a few hundred colours at ~50 KB each (10–20 MB in all) it is not worth that machinery now. If the shop reaches thousands of photos, thumbnails or a blob channel can replace the field behind the same `photo` record.

## Consequences

- A new device downloads every live and voided photo on its first sync (~50 KB each) and keeps them in IndexedDB; the database, exports and backups grow by that much per photo.
- Replaced and removed photos stay, voided (no hard delete); each replacement adds one more photo. A cleanup would be an explicit decision, not an accident.
- A photo of a colour whose record the server does not have yet is refused by the foreign key and shown on the sync-issues screen like any other refused op; the device sends the colour's op first (the outbox is in order).
- Tests: `photos.test.ts` (contracts), `photos.test.ts` (device repository and push batching), `photos.e2e-spec.ts` (API: push, pull, audit, roles, byte-cut pages) and `e2e/photos.spec.ts` (the sample image through the dialog, offline, a second device, replace, remove).

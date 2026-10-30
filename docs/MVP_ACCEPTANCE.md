# MVP acceptance: one full shop day

The MVP is accepted when the shop runs a whole day on it, with the old paper book kept in parallel, and the figures match (BUILD_PROMPTS, end of phase 1). Use the main till and the phone, signed in as the owner, on the production server ([runbooks/deploy.md](runbooks/deploy.md)). Tick each line; write down anything that differs, with the numbers.

Prices are typed in rial (the default display unit). The test's expected figures are in brackets.

## Before opening

- [ ] Both devices are signed in, and the header says "متصل" with nothing waiting.
- [ ] `make backup STACK=prod` works, and last night's dump is in `backups/`.
- [ ] Settings → "مشاكل المزامنة" shows nothing refused and no roll to review.

## 1. Receive an assortment (purchases)

- [ ] Add the fabric (Inventory → "قماش جديد") with its reference and minimum price, and its colours.
- [ ] Record a purchase by the metre for several colours at once, e.g. 10 colours × 50 m at 320 rial/m. (10 rolls of 16,000 rial each, T1.)
- [ ] Record a ready piece, e.g. 2.3 m for 2,000 rial. (869.6 rial/m, T2.)
- [ ] Record a purchase by weight, e.g. 20 kg for 8,000 rial at 4 m/kg. (An estimated 80 m roll, T4.)
- [ ] Write each roll's code (R-A0001…) on its label.
- [ ] Inventory shows each colour with its metres and roll count; the phone shows the same after a few seconds.

## 2. Sell with negotiation (POS)

- [ ] Sell 3.5 m at the reference price, paid in cash. The app proposes the oldest roll; the total is price × length.
- [ ] Sell at a negotiated price above the minimum: no warning. Below the minimum: a warning, the sale still saves.
- [ ] Try a price under cost: the sale needs the explicit confirmation, and the loss shows to the owner.
- [ ] Sell more than one roll holds: the line is split across rolls, oldest first.
- [ ] Share an invoice on WhatsApp: shop name, date, lines, total, paid, remaining.
- [ ] Void one sale with a reason: the cloth is back on the roll, the payment refunded, the invoice marked "ملغاة".

## 3. Sell on credit, take a partial payment

- [ ] Sell to a new customer (added at the POS with name and phone), "دين أو دفعة جزئية", paying part now.
- [ ] Customers → "من عليه دين" lists them with the rest due and the age of the debt.
- [ ] Record a partial payment on the customer page. On the invoice, the owner sees each payment's capital and profit (T8: 200 dh costing 160, paid 100 then 100 → 100/0, then 60/40).
- [ ] Share the customer's statement on WhatsApp.

## 4. A loss and a stock count

- [ ] Record a loss on a roll with its reason, e.g. 30 cm stained. (Its cost shows: 480 cents on a 16 dh/m roll, T12.)
- [ ] Measure the kg roll and enter what is on it (e.g. 76 m): it is no longer "تقديري", and its cost per metre changes (T4).
- [ ] Count a roll (stocktake) and enter the length found: the difference is recorded with its reason.
- [ ] The remaining metres match the paper book for every roll you touched.

## 5. Offline, both devices

- [ ] Turn the phone's data off. Make a sale on it. The header shows it waiting; the POS and the stock still work.
- [ ] Turn data back on: it syncs by itself, and the till sees the sale.
- [ ] (Optional) Both devices offline, both sell from the same small roll beyond its length, then reconnect: both sales are kept, and the roll appears under "رولات تحتاج مراجعة" until you measure or count it.

## End of day

- [ ] Count the cash in the drawer; compare with the day's cash sales and payments on paper.
- [ ] Settings → "تنزيل نسخة كاملة (JSON)" on the till; keep the file.
- [ ] Settings → "مشاكل المزامنة" is empty, or every item has been looked at.
- [ ] The day's totals (sales, credit, payments, losses) match the paper book.

**Accepted** when every line is ticked and the totals match. If not, note what differed (with the numbers) and keep the paper book until it is fixed.

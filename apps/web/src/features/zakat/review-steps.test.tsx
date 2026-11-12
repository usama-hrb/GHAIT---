import type { ZakatReviewItem } from '@fabric/contracts';
import { describe, expect, it } from 'vitest';
import { messages, setLanguage } from '@/i18n';
import { formatDate, moneyUnitLabel } from '@/shared/format';
import {
  BaseStep,
  BlockedNotice,
  ConfirmStep,
  HawlStep,
  InventoryStep,
  NisabStep,
  ResultStep,
  SettingsStep,
} from './review-steps';
import {
  BELOW_NISAB_FIELDS,
  estimateOf,
  FIELDS,
  GOLD,
  LATEST,
  markup,
  occurrences,
  OPTIONS,
  REVIEWS,
  reviewOf,
  SETTINGS,
  textOf,
} from './test-support';

const t = () => messages.zakat;
const DH = moneyUnitLabel('dirham');
const html = (node: Parameters<typeof markup>[0]) => markup(node, 'dirham');

describe('step 1, the settings', () => {
  it('shows each setting with what it means, grouped as in the methodology settings', () => {
    setLanguage('en', { persist: false });
    const text = textOf(
      html(<SettingsStep options={OPTIONS} items={[]} canChange={false} online />),
    );
    for (const group of ['hawl', 'methodology', 'prices'] as const) {
      expect(text).toContain(t().settings.groups[group].title);
    }
    expect(text).toContain(t().settingsStep.reminder(7));
    expect(text).toContain(t().metals.gold);
    expect(text).toContain(t().valuations.market);
    expect(text).toContain(t().settingsStep.notCounted);
    // Gold at 700 dirham a gram on 10 November 2026; no silver price yet.
    expect(text).toContain(`700 ${DH} ${t().perGram}`);
    expect(text).toContain(formatDate(GOLD.date));
    expect(text).toContain(t().settingsStep.notSet);
    expect(text).toContain(t().hints.hawlStart);
  });

  it('shows what is not set as not set, and the items that sit in this step', () => {
    setLanguage('en', { persist: false });
    const items: ZakatReviewItem[] = [{ key: 'hawl_start_missing', severity: 'blocking' }];
    const text = textOf(
      html(
        <SettingsStep
          options={{ ...OPTIONS, hawlStart: null, goldPrice: null }}
          items={items}
          canChange
          online
        />,
      ),
    );
    expect(text).toContain(t().items.hawl_start_missing.title);
    expect(occurrences(text, t().settingsStep.notSet)).toBeGreaterThanOrEqual(3);
  });

  it('links the owner to the methodology settings, and says changing needs a connection offline', () => {
    setLanguage('en', { persist: false });
    const online = html(<SettingsStep options={OPTIONS} items={[]} canChange online />);
    expect(online).toContain('href="/zakat/settings"');
    expect(online).toContain(t().settingsStep.change);
    expect(online).not.toContain(t().settingsStep.changeOffline);
    const offline = html(<SettingsStep options={OPTIONS} items={[]} canChange online={false} />);
    expect(offline).toContain(t().settingsStep.changeOffline);
  });

  it('offers a partner nothing to change', () => {
    setLanguage('en', { persist: false });
    const partner = html(
      <SettingsStep options={OPTIONS} items={[]} canChange={false} online={false} />,
    );
    expect(partner).not.toContain('/zakat/settings');
    expect(partner).not.toContain(t().settingsStep.change);
    expect(partner).not.toContain(t().settingsStep.changeOffline);
  });
});

describe('a step that cannot be worked out', () => {
  it('says so and lists only what blocks, instead of showing figures from missing information', () => {
    setLanguage('en', { persist: false });
    const review = REVIEWS.review_required;
    const extra: ZakatReviewItem[] = [
      ...review.items,
      { key: 'money_negative', severity: 'review', cents: -10_000 },
    ];
    const notice = textOf(html(<BlockedNotice items={extra} />));
    expect(notice).toContain(t().review.blockedTitle);
    expect(notice).toContain(t().review.blockedDescription);
    expect(notice).toContain(t().items.price_missing.title);
    expect(notice).not.toContain(t().items.money_negative.title);
    for (const Step of [BaseStep, InventoryStep, NisabStep, ResultStep]) {
      const text = textOf(html(<Step review={review} />));
      expect(text).toContain(t().review.blockedTitle);
      expect(text).toContain(t().items.price_missing.title);
      expect(text).not.toContain(t().resultStep.rows.due);
    }
  });
});

describe('step 2, the zakat base', () => {
  it('shows each part of the base with what it does to the total, its source and its figure', () => {
    setLanguage('en', { persist: false });
    const text = textOf(html(<BaseStep review={REVIEWS.zakat_due} />));
    expect(text).toContain(t().baseStep.formula);
    for (const key of [
      'money',
      'inventory',
      'receivables',
      'doubtful_receivables',
      'customer_credits',
      'supplier_debts',
      'unpaid_bills',
      'other_assets',
    ] as const) {
      expect(text).toContain(t().baseStep.categories[key].title);
      expect(text).toContain(t().baseStep.categories[key].source);
    }
    for (const effect of ['added', 'deducted', 'excluded', 'not_tracked'] as const) {
      expect(text).toContain(t().baseStep.effects[effect]);
    }
    // 70,000 money, 2,000 inventory, 3,000 expected, 1,000 doubtful, 500 credits, 1,500 suppliers.
    for (const figure of ['70,000', '2,000', '3,000', '1,000', '500', '1,500']) {
      expect(text).toContain(figure);
    }
    expect(text).toContain(t().baseStep.total);
    expect(text).toContain('73,000');
  });

  it('says why doubtful debts are counted or left out, by the setting', () => {
    setLanguage('en', { persist: false });
    expect(textOf(html(<BaseStep review={REVIEWS.zakat_due} />))).toContain(
      t().baseStep.notes.doubtfulLeftOut,
    );
    const counted = reviewOf({
      estimate: estimateOf({
        ...FIELDS,
        settings: { ...SETTINGS, includeDoubtfulDebts: true },
      }),
    });
    expect(textOf(html(<BaseStep review={counted} />))).toContain(
      t().baseStep.notes.doubtfulCounted,
    );
  });

  it('shows the items that sit in this step, with the records they are about', () => {
    setLanguage('en', { persist: false });
    const review = reviewOf({
      items: [
        { key: 'doubtful_debts', severity: 'info', count: 1 },
        { key: 'unpaid_expenses', severity: 'info', cents: 20_000 },
      ],
      unpaidExpensesCents: 20_000,
      estimate: estimateOf(undefined, 20_000),
    });
    const text = textOf(html(<BaseStep review={review} />));
    expect(text).toContain(t().items.doubtful_debts.title);
    expect(text).toContain(t().items.unpaid_expenses.title);
    expect(text).toContain(t().baseStep.notes.unpaidBills);
    expect(text).toContain('200');
  });
});

describe('step 3, the inventory valuation', () => {
  it('shows the valuation used and every batch with how it was valued', () => {
    setLanguage('en', { persist: false });
    const text = textOf(html(<InventoryStep review={REVIEWS.zakat_due} />));
    expect(text).toContain(`${t().inventoryStep.valuation}: ${t().valuations.market}`);
    expect(text).toContain('B-A0012 · Rosa');
    // 50 m at 40 dirham a metre = 2,000 dirham, against a cost of 1,200.
    expect(text).toContain('2,000');
    expect(text).toContain('1,200');
    expect(text).toContain(t().inventoryStep.bases.length);
  });

  it('shows the items about stock where they matter', () => {
    setLanguage('en', { persist: false });
    const review = reviewOf({
      items: [{ key: 'goods_without_price', severity: 'review', count: 2 }],
    });
    const text = textOf(html(<InventoryStep review={review} />));
    expect(text).toContain(t().items.goods_without_price.title);
    expect(text).toContain(t().counts.batches(2));
  });
});

describe('step 4, the nisab', () => {
  it('shows the metal, its weight and price, the threshold, the base and the gap in words', () => {
    setLanguage('en', { persist: false });
    const text = textOf(html(<NisabStep review={REVIEWS.zakat_due} />));
    expect(text).toContain(`${t().nisabStep.rows.metal} ${t().metals.gold}`);
    expect(text).toContain(t().nisabStep.grams(85));
    expect(text).toContain(`${t().nisabStep.rows.priceDate} ${formatDate(GOLD.date)}`);
    // The nisab is 85 g at 700 dirham = 59,500; the base 73,000 is 13,500 above it.
    expect(text).toContain(`${t().nisabStep.rows.threshold} 59,500`);
    expect(text).toContain(`${t().nisabStep.rows.base} 73,000`);
    expect(text).toContain(`${t().nisabStep.rows.difference} 13,500 ${DH} ${t().nisabStep.above}`);
    expect(text).toContain(t().nisabStep.reached);
    expect(text).toContain(t().nisabStep.checkedOnce);
  });

  it('says in words that the base is below the nisab', () => {
    setLanguage('en', { persist: false });
    const text = textOf(html(<NisabStep review={REVIEWS.nisab_not_reached} />));
    // 50,000 against 59,500 is 9,500 below.
    expect(text).toContain(`${t().nisabStep.rows.difference} 9,500 ${DH} ${t().nisabStep.below}`);
    expect(text).toContain(t().nisabStep.notReached);
    expect(text).not.toContain(t().nisabStep.reached);
  });

  it('shows a price dated before the hawl as an item to review', () => {
    setLanguage('en', { persist: false });
    const review = reviewOf({
      items: [{ key: 'price_before_hawl', severity: 'review', date: '2026-01-05' }],
    });
    const text = textOf(html(<NisabStep review={review} />));
    expect(text).toContain(t().items.price_before_hawl.title);
    expect(text).toContain(formatDate('2026-01-05'));
  });
});

describe('step 5, the hawl', () => {
  it('shows where the hawl began, the one this is for, today and the next', () => {
    setLanguage('en', { persist: false });
    const text = textOf(html(<HawlStep review={REVIEWS.zakat_due} />));
    expect(text).toContain(t().hawlStep.rows.start);
    expect(text).toContain(formatDate('2025-03-01'));
    expect(text).toContain(formatDate('2026-02-18'));
    expect(text).toContain(formatDate('2026-11-12'));
    expect(text).toContain(formatDate('2027-02-08'));
    expect(text).toContain(`${t().hawlStep.rows.completed} ${t().hawlStep.yes}`);
    expect(text).toContain(t().hawlStep.completedNote);
    expect(text).toContain(t().hawlStep.calendarNote);
  });

  it('says the hawl has not come, and that no report can be saved yet', () => {
    setLanguage('en', { persist: false });
    const text = textOf(html(<HawlStep review={REVIEWS.hawl_in_progress} />));
    expect(text).toContain(`${t().hawlStep.rows.hawl} ${t().hawlStep.none}`);
    expect(text).toContain(`${t().hawlStep.rows.completed} ${t().hawlStep.no}`);
    expect(text).toContain(t().hawlStep.notCompletedNote);
  });

  it('says that no hawl is set instead of showing a date', () => {
    setLanguage('en', { persist: false });
    const text = textOf(html(<HawlStep review={REVIEWS.not_configured} />));
    expect(text).toContain(`${t().hawlStep.rows.start} ${t().hawlStep.none}`);
    expect(text).toContain(t().items.hawl_start_missing.title);
  });
});

describe('step 6, the result', () => {
  it('shows the base, the nisab, the rate and the zakat once the hawl has come', () => {
    setLanguage('en', { persist: false });
    const text = textOf(html(<ResultStep review={REVIEWS.zakat_due} />));
    expect(text).toContain(`${t().resultStep.rows.base} 73,000`);
    expect(text).toContain(`${t().resultStep.rows.nisab} 59,500`);
    expect(text).toContain(`${t().resultStep.rows.rate} 2.5%`);
    expect(text).toContain(`${t().resultStep.rows.due} 1,825`);
    expect(text).toContain(t().resultStep.outcomes.due);
    expect(text).toContain(t().resultStep.estimate);
  });

  it('shows no zakat figure before the first hawl, however large the base is', () => {
    setLanguage('en', { persist: false });
    const text = textOf(html(<ResultStep review={REVIEWS.hawl_in_progress} />));
    expect(text).toContain(t().resultStep.outcomes.hawlNotCompleted);
    expect(text).not.toContain(t().resultStep.rows.due);
    expect(text).not.toContain('1,825');
    expect(text).not.toContain(t().resultStep.estimate);
  });

  it('says that nothing is due when the base is below the nisab', () => {
    setLanguage('en', { persist: false });
    const text = textOf(html(<ResultStep review={REVIEWS.nisab_not_reached} />));
    expect(text).toContain(t().resultStep.outcomes.belowNisab);
    expect(text).toContain(`${t().resultStep.rows.due} 0`);
    expect(BELOW_NISAB_FIELDS.zakatDueCents).toBe(0);
  });
});

function confirm(
  review: Parameters<typeof ConfirmStep>[0]['review'],
  more: { isOwner?: boolean; saving?: boolean } = {},
) {
  return html(
    <ConfirmStep
      review={review}
      isOwner={more.isOwner ?? true}
      saving={more.saving ?? false}
      onSave={() => undefined}
    />,
  );
}

describe('step 7, review and confirm', () => {
  it('shows what will be saved and that nothing is recorded until the owner confirms', () => {
    setLanguage('en', { persist: false });
    const out = confirm(REVIEWS.zakat_due);
    const text = textOf(out);
    expect(text).toContain(t().confirm.intro);
    expect(text).toContain(`${t().confirm.rows.base} 73,000`);
    expect(text).toContain(`${t().confirm.rows.nisab} 59,500`);
    expect(text).toContain(`${t().confirm.rows.due} 1,825`);
    expect(text).toContain(t().confirm.nothingRecorded);
  });

  it('gives the owner one gold Save button, off until the figures are acknowledged', () => {
    setLanguage('en', { persist: false });
    const out = confirm(REVIEWS.zakat_due);
    expect(occurrences(out, 'data-variant="accent"')).toBe(1);
    expect(out).toMatch(
      /<button[^>]*data-variant="accent"[^>]*disabled=""[^>]*>Save the report<\/button>/,
    );
    expect(out).toContain(t().confirm.acknowledgeFigures);
    // No items to look at: one acknowledgement only.
    expect(occurrences(out, 'role="checkbox"')).toBe(1);
  });

  it('asks for a second acknowledgement when items are marked for review, and lists them', () => {
    setLanguage('en', { persist: false });
    const review = reviewOf({
      items: [
        { key: 'goods_without_price', severity: 'review', count: 1 },
        { key: 'money_negative', severity: 'review', cents: -100 },
        { key: 'doubtful_debts', severity: 'info', count: 1 },
      ],
    });
    const out = confirm(review);
    expect(occurrences(out, 'role="checkbox"')).toBe(2);
    expect(textOf(out)).toContain(t().confirm.acknowledgeItems(2));
    expect(textOf(out)).toContain(t().items.goods_without_price.title);
    expect(textOf(out)).toContain(t().items.money_negative.title);
    // The note that is only good to know is not something to acknowledge here.
    expect(textOf(out)).not.toContain(t().items.doubtful_debts.title);
  });

  it('shows no Save button to a partner, and says only the owner saves', () => {
    setLanguage('en', { persist: false });
    const out = confirm(REVIEWS.zakat_due, { isOwner: false });
    expect(out).not.toContain(t().confirm.save);
    expect(out).not.toContain('data-variant="accent"');
    expect(out).not.toContain('role="checkbox"');
    expect(textOf(out)).toContain(t().confirm.blockedTitle);
    expect(textOf(out)).toContain(t().confirm.blocks.not_owner);
  });

  it('blocks saving before the hawl has come and shows no zakat figure', () => {
    setLanguage('en', { persist: false });
    const out = confirm(REVIEWS.hawl_in_progress);
    const text = textOf(out);
    expect(text).toContain(t().confirm.blocks.hawl_not_completed);
    expect(out).not.toContain(t().confirm.save);
    expect(text).not.toContain(t().confirm.rows.due);
    expect(text).not.toContain('1,825');
  });

  it('blocks saving while an item blocks the calculation, with nothing worked out', () => {
    setLanguage('en', { persist: false });
    const out = confirm(REVIEWS.review_required);
    const text = textOf(out);
    expect(text).toContain(t().confirm.blocks.blocking_items);
    expect(out).not.toContain(t().confirm.save);
    expect(text).not.toContain(t().confirm.rows.base);
  });

  it('blocks saving a second report for the same hawl and points to the saved one', () => {
    setLanguage('en', { persist: false });
    const out = confirm(REVIEWS.calculation_completed);
    expect(textOf(out)).toContain(t().confirm.blocks.already_saved);
    expect(out).toContain(`href="/zakat/view?id=${LATEST.id}"`);
    expect(textOf(out)).toContain(t().confirm.viewSaved);
    expect(out).not.toContain(t().confirm.save);
  });

  it('says that no zakat is due when the base is below the nisab, and still lets the owner save', () => {
    setLanguage('en', { persist: false });
    const review = reviewOf({
      estimate: estimateOf(BELOW_NISAB_FIELDS),
      status: 'nisab_not_reached',
    });
    const out = confirm(review);
    expect(textOf(out)).toContain(t().confirm.noneDueNote);
    expect(out).toContain(t().confirm.save);
  });

  it('shows the saving state on the one button', () => {
    setLanguage('en', { persist: false });
    const out = confirm(REVIEWS.zakat_due, { saving: true });
    expect(out).toContain(messages.forms.saving);
    expect(out).not.toContain(t().confirm.save);
  });
});

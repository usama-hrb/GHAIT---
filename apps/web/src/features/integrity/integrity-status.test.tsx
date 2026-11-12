import { describe, expect, it } from 'vitest';
import { messages, setLanguage } from '@/i18n';
import { formatDate } from '@/shared/format';
import { type IntegrityStatus, statusOf } from './integrity-model';
import { IntegrityVerdict, LATEST_CHANGES_ID } from './integrity-status';
import {
  BALANCED,
  CALCULATED_AT,
  HELD_LESS_BY_TEN_DIRHAM,
  HELD_MORE_BY_ONE_CENT,
  markup,
  occurrences,
  RECEIVED_AT,
  textOf,
} from './test-support';

const NOT_RECEIVED: IntegrityStatus = { kind: 'unable', reason: 'notReceived' };
const INCOMPLETE: IntegrityStatus = { kind: 'unable', reason: 'incomplete' };

function verdict(
  report: Parameters<typeof statusOf>[0],
  receivedAt: string | null = RECEIVED_AT,
  more: Partial<Parameters<typeof IntegrityVerdict>[0]> = {},
  unit: 'rial' | 'dirham' = 'rial',
) {
  return markup(
    <IntegrityVerdict
      status={statusOf(report, receivedAt)}
      report={report}
      receivedAt={receivedAt}
      calculatedAt={CALCULATED_AT}
      {...more}
    />,
    unit,
  );
}

describe('the verdict: balanced', () => {
  it('says Balanced in words, announced as a status, with nothing to act on', () => {
    setLanguage('en', { persist: false });
    const html = verdict(BALANCED);
    expect(html).toContain('role="status"');
    expect(html).toMatch(/<h2[^>]*>Balanced<\/h2>/);
    expect(textOf(html)).toContain(messages.integrity.status.balancedDescription);
    expect(html).not.toContain(messages.integrity.status.difference);
    expect(html).not.toContain(messages.integrity.status.unable);
    expect(html).not.toContain(messages.integrity.status.reviewChanges);
    expect(html).not.toContain(messages.integrity.status.checkAgain);
  });

  it('says it with exactly one element reading “متطابق” in Arabic', () => {
    // The browser tests find the verdict by this exact text, so nothing else may carry it.
    setLanguage('ar', { persist: false });
    const html = verdict(BALANCED);
    expect(html).toMatch(/<h2[^>]*>متطابق<\/h2>/);
    expect(occurrences(html, '>متطابق<')).toBe(1);
  });

  it('shows both totals and a difference of nothing', () => {
    setLanguage('en', { persist: false });
    const text = textOf(verdict(BALANCED));
    expect(text).toContain(`${messages.integrity.holdingsTotal} 3,000 rial`);
    expect(text).toContain(`${messages.integrity.claimsTotal} 3,000 rial`);
    expect(text).toContain(`${messages.integrity.status.gap} 0 rial`);
  });

  it('shows the same totals in dirham when that is the display unit', () => {
    setLanguage('en', { persist: false });
    const text = textOf(verdict(BALANCED, RECEIVED_AT, {}, 'dirham'));
    expect(text).toContain(`${messages.integrity.holdingsTotal} 150 dh`);
    expect(text).toContain(`${messages.integrity.claimsTotal} 150 dh`);
    expect(text).toContain(`${messages.integrity.status.gap} 0 dh`);
  });
});

describe('the verdict: a difference', () => {
  it('says Difference detected, and that the shop holds more than the records explain', () => {
    setLanguage('en', { persist: false });
    const html = verdict(HELD_MORE_BY_ONE_CENT);
    const text = textOf(html);
    expect(html).toContain('role="status"');
    expect(html).toMatch(/<h2[^>]*>Difference detected<\/h2>/);
    expect(text).toContain(messages.integrity.status.heldMore);
    expect(text).not.toContain(messages.integrity.status.heldLess);
    expect(text).toContain(messages.integrity.status.differenceHelp);
    expect(text).not.toContain(messages.integrity.status.balanced);
  });

  it('shows the exact difference: one cent is 0.2 rial or 0.01 dirham', () => {
    setLanguage('en', { persist: false });
    expect(textOf(verdict(HELD_MORE_BY_ONE_CENT))).toContain(
      `${messages.integrity.status.gap} 0.2 rial`,
    );
    expect(textOf(verdict(HELD_MORE_BY_ONE_CENT, RECEIVED_AT, {}, 'dirham'))).toContain(
      `${messages.integrity.status.gap} 0.01 dh`,
    );
  });

  it('says it the other way round when the records explain more than the shop holds', () => {
    setLanguage('en', { persist: false });
    const text = textOf(verdict(HELD_LESS_BY_TEN_DIRHAM));
    expect(text).toContain(messages.integrity.status.heldLess);
    expect(text).not.toContain(messages.integrity.status.heldMore);
    // The size of the difference, never a negative one: the sentence says which way it goes.
    expect(text).toContain(`${messages.integrity.status.gap} 200 rial`);
    expect(textOf(verdict(HELD_LESS_BY_TEN_DIRHAM, RECEIVED_AT, {}, 'dirham'))).toContain(
      `${messages.integrity.status.gap} 10 dh`,
    );
    expect(text).not.toContain(`${messages.integrity.status.gap} -`);
  });

  it('shows both totals, which differ by exactly that amount', () => {
    setLanguage('en', { persist: false });
    const text = textOf(verdict(HELD_MORE_BY_ONE_CENT));
    expect(text).toContain(`${messages.integrity.holdingsTotal} 3,000.2 rial`);
    expect(text).toContain(`${messages.integrity.claimsTotal} 3,000 rial`);
  });

  it('points to the latest changes, which carry the id the link goes to', () => {
    setLanguage('en', { persist: false });
    const html = verdict(HELD_MORE_BY_ONE_CENT);
    expect(html).toContain(`href="#${LATEST_CHANGES_ID}"`);
    expect(textOf(html)).toContain(messages.integrity.status.reviewChanges);
    expect(LATEST_CHANGES_ID).toBe('integrity-latest-changes');
  });
});

describe('the verdict: unable to verify', () => {
  it('says so, and never calls the shop balanced, on a device without the shop’s records', () => {
    setLanguage('en', { persist: false });
    // Even when the records it holds happen to add up.
    const html = verdict(BALANCED, null);
    const text = textOf(html);
    expect(html).toContain('role="status"');
    expect(html).toMatch(/<h2[^>]*>Unable to verify<\/h2>/);
    expect(text).toContain(messages.integrity.status.unableNotReceived);
    expect(text).not.toContain(messages.integrity.status.balanced);
    expect(text).not.toContain(messages.integrity.status.balancedDescription);
  });

  it('shows no totals and no difference it cannot stand behind', () => {
    setLanguage('en', { persist: false });
    for (const status of [NOT_RECEIVED, INCOMPLETE]) {
      const text = textOf(
        markup(
          <IntegrityVerdict
            status={status}
            report={BALANCED}
            receivedAt={RECEIVED_AT}
            calculatedAt={CALCULATED_AT}
          />,
        ),
      );
      expect(text).not.toContain(messages.integrity.holdingsTotal);
      expect(text).not.toContain(messages.integrity.claimsTotal);
      expect(text).not.toContain(messages.integrity.status.basis);
    }
  });

  it('says the check could not be completed when the records are incomplete', () => {
    setLanguage('en', { persist: false });
    const text = textOf(verdict(null));
    expect(text).toContain(messages.integrity.status.unable);
    expect(text).toContain(messages.integrity.status.unableIncomplete);
    expect(text).not.toContain(messages.integrity.status.unableNotReceived);
    expect(text).not.toContain(messages.integrity.holdingsTotal);
  });

  it('offers to check again only where it can, and only when unable', () => {
    setLanguage('en', { persist: false });
    const retry = () => undefined;
    expect(verdict(null, RECEIVED_AT, { onRetry: retry })).toContain(
      `>${messages.integrity.status.checkAgain}</button>`,
    );
    expect(verdict(null, RECEIVED_AT)).not.toContain(messages.integrity.status.checkAgain);
    expect(verdict(BALANCED, RECEIVED_AT, { onRetry: retry })).not.toContain(
      messages.integrity.status.checkAgain,
    );
    expect(verdict(HELD_MORE_BY_ONE_CENT, RECEIVED_AT, { onRetry: retry })).not.toContain(
      messages.integrity.status.checkAgain,
    );
  });
});

describe('what the verdict says about itself', () => {
  it('says when it was worked out and when the shop’s records were last received', () => {
    setLanguage('en', { persist: false });
    const text = textOf(verdict(BALANCED));
    expect(text).toContain(
      `${messages.integrity.status.calculated} ${formatDate(CALCULATED_AT, 'dateTime')}`,
    );
    expect(text).toContain(
      `${messages.integrity.status.received} ${formatDate(RECEIVED_AT, 'dateTime')}`,
    );
    expect(text).toContain(messages.integrity.status.basis);
  });

  it('does not claim the shop’s records were received when they never were', () => {
    setLanguage('en', { persist: false });
    const text = textOf(verdict(null, null));
    expect(text).toContain(messages.integrity.status.calculated);
    expect(text).not.toContain(messages.integrity.status.received);
  });

  it('says how many changes on this device are still to be sent, when there are some', () => {
    setLanguage('en', { persist: false });
    expect(textOf(verdict(BALANCED, RECEIVED_AT, { pendingCount: 3 }))).toContain(
      messages.shell.pendingOps(3),
    );
    expect(textOf(verdict(BALANCED, RECEIVED_AT, { pendingCount: 0 }))).not.toContain(
      messages.shell.pendingOps(0),
    );
  });

  it('tells the three answers apart by words and icons, not by colour', () => {
    setLanguage('en', { persist: false });
    const answers = [BALANCED, HELD_MORE_BY_ONE_CENT, null].map((report) => verdict(report));
    const titles = answers.map((html) => /<h2[^>]*>([^<]*)<\/h2>/.exec(html)?.[1]);
    expect(new Set(titles).size).toBe(3);
    for (const html of answers) {
      // Every answer carries an icon that is hidden from assistive technology: the words say it.
      expect(html).toMatch(/<svg[^>]*aria-hidden="true"/);
    }
  });
});

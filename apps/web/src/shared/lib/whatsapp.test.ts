import { describe, expect, it } from 'vitest';
import { whatsAppLink, whatsAppNumber } from './whatsapp';

describe('whatsApp', () => {
  it('turns Moroccan numbers into international ones', () => {
    expect(whatsAppNumber('06 12 34 56 78')).toBe('212612345678');
    expect(whatsAppNumber('+212 7-12-34-56-78')).toBe('212712345678');
    expect(whatsAppNumber('0033612345678')).toBe('33612345678');
    expect(whatsAppNumber('12')).toBeNull();
    expect(whatsAppNumber(null)).toBeNull();
  });

  it('links to the customer, or lets the user pick a chat', () => {
    expect(whatsAppLink('سلام', '0612345678')).toBe(
      'https://wa.me/212612345678?text=%D8%B3%D9%84%D8%A7%D9%85',
    );
    expect(whatsAppLink('a b', null)).toBe('https://wa.me/?text=a%20b');
  });
});

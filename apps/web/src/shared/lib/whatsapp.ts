/**
 * A phone number as wa.me wants it (international, digits only): Moroccan 06…/07… numbers get
 * the 212 prefix. Null when it does not look like a phone number.
 */
export function whatsAppNumber(phone: string | null): string | null {
  if (!phone) return null;
  let digits = phone.replace(/[^\d+]/g, '');
  if (digits.startsWith('+')) digits = digits.slice(1);
  else if (digits.startsWith('00')) digits = digits.slice(2);
  else if (/^0[5-7]\d{8}$/.test(digits)) digits = `212${digits.slice(1)}`;
  return /^\d{8,15}$/.test(digits) ? digits : null;
}

/** https://wa.me/ with the text, to the customer's number when there is one. */
export function whatsAppLink(text: string, phone: string | null): string {
  const number = whatsAppNumber(phone);
  return `https://wa.me/${number ?? ''}?text=${encodeURIComponent(text)}`;
}

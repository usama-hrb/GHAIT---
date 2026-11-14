import * as controlSchema from './control/schema.js';

/**
 * The operator's mistake or a conflict, in words for the operator: a command prints it as it is
 * and exits with 1. Nothing was written when one is thrown before the first write of a command.
 */
export class ShopRefused extends Error {
  override readonly name: string = 'ShopRefused';
}

type Refuse = (message: string) => Error;
const refusal: Refuse = (message) => new ShopRefused(message);

/**
 * An address as `req.hostname` gives it: lower case, no port, no scheme, no final dot. The
 * operator types what devices type, so a stray `https://` or `:443` is refused with a reason
 * instead of being stored as an address nothing will ever match.
 */
export function checkedHost(host: string, refuse: Refuse = refusal): string {
  const normalized = host.trim().toLowerCase();
  if (/[/:@?#\s]/.test(normalized)) {
    throw refuse(
      `"${host}" is not an address: give the host name or IP only, like shop.example.com or 203.0.113.7 (no http://, no port, no path).`,
    );
  }
  if (!controlSchema.SHOP_HOST_PATTERN.test(normalized)) {
    throw refuse(`"${host}" is not a usable address: letters, digits, dots and hyphens only.`);
  }
  return normalized;
}

/** A shop's short name: the pattern of the control database, and none of the names kept back. */
export function checkedSlug(slug: string, refuse: Refuse = refusal): string {
  if ((controlSchema.RESERVED_SHOP_SLUGS as readonly string[]).includes(slug)) {
    throw refuse(`"${slug}" is reserved: pick another name for the shop.`);
  }
  if (!controlSchema.SHOP_SLUG_PATTERN.test(slug)) {
    throw refuse(
      `"${slug}" is not a usable shop name: 3 to 31 characters, lower-case letters, digits and _, starting with a letter.`,
    );
  }
  return slug;
}

/** The database of a shop that `make shop-new` makes. */
export function databaseNameForSlug(slug: string): string {
  return `shop_${slug}`;
}

/**
 * Issue codes of an error's `issues[].code` for the shop a request is addressed to (ADR 0029). They
 * exist only when one server serves many shops (`MULTI_SHOP`); the web shows i18n text for each.
 */
export const SHOP_ISSUES = {
  /**
   * The shop's address is known but the operator has switched the shop off: 403 on every route
   * except `/health`. Nothing is deleted. A till that is already open keeps working offline and
   * syncs after the shop is resumed.
   */
  suspended: 'shop_suspended',
} as const;

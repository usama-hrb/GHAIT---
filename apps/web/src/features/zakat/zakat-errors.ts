import { messages } from '@/i18n';
import {
  ApiError,
  isPeriodLocked,
  NeedsServerError,
  NetworkError,
  ReadOnlyError,
  ValidationError,
} from '@/local-db';

/**
 * What to tell a person whose zakat change was refused: that the period is locked, the rule the
 * change broke (the same text for the device's answer and the server's), or the general message.
 */
export function zakatErrorText(error: unknown): string {
  if (isPeriodLocked(error)) return messages.forms.periodLocked;
  const message = error instanceof ValidationError ? error.issues[0]?.message : undefined;
  const text = message === undefined ? undefined : messages.zakat.issues[message];
  return text ?? messages.forms.invalid;
}

/**
 * Why the zakat settings were not saved. They are kept on the server, so it is mostly a missing
 * connection; a refusal for the role is said as it is, and anything else is said generally. The
 * settings are written one at a time, so a failure part-way may leave some of them changed.
 */
export function zakatSettingsErrorText(error: unknown): string {
  const t = messages.zakat.settings;
  if (error instanceof NetworkError || error instanceof NeedsServerError) return t.offline;
  if (
    error instanceof ReadOnlyError ||
    (error instanceof ApiError && (error.status === 401 || error.status === 403))
  ) {
    return t.readOnly;
  }
  return t.failed;
}

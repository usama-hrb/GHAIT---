/** What the logo picker accepts before the picture is made small (ADR 0017). */
export const LOGO_FILE_TYPES = ['image/png', 'image/jpeg', 'image/webp'] as const;
/** A larger file is refused before it is decoded: a phone shot can be tens of megabytes. */
export const LOGO_FILE_MAX_BYTES = 5 * 1024 * 1024;

export type LogoFileProblem = 'not_image' | 'too_big';

/** Whether a picked file may become the logo, from its type and size alone. */
export function checkLogoFile(file: { type: string; size: number }): LogoFileProblem | null {
  if (!(LOGO_FILE_TYPES as readonly string[]).includes(file.type)) return 'not_image';
  if (file.size > LOGO_FILE_MAX_BYTES) return 'too_big';
  return null;
}

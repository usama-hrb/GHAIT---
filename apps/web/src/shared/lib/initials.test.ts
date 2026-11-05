import { describe, expect, it } from 'vitest';
import { initialsOf } from './initials';

describe('initialsOf', () => {
  it('takes the first letter of the first two words', () => {
    expect(initialsOf('خديجة بنعلي')).toBe('خب');
    expect(initialsOf('  ahmed   el idrissi ')).toBe('AE');
    expect(initialsOf('سعاد')).toBe('س');
    expect(initialsOf('   ')).toBe('');
  });

  it('goes past a leading Arabic article, so names that share a first word differ', () => {
    expect(initialsOf('مورد الحرير')).toBe('مح');
    expect(initialsOf('مورد القطن')).toBe('مق');
    expect(initialsOf('السوق')).toBe('س');
    // "ال" alone is a name, not an article.
    expect(initialsOf('ال')).toBe('ا');
  });
});

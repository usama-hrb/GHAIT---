import { describe, expect, it } from 'vitest';
import { toCsv } from './csv';

describe('toCsv', () => {
  it('writes a header, quotes what needs it, and keeps Arabic readable in Excel', () => {
    expect(
      toCsv([
        { id: 'a', name: 'روزا, أحمر', tags: ['x'], notes: null },
        { id: 'b', name: 'قال "نعم"', price: 400 },
      ]),
    ).toBe(
      '\uFEFFid,name,tags,notes,price\r\na,"روزا, أحمر","[""x""]",,\r\nb,"قال ""نعم""",,,400\r\n',
    );
    expect(toCsv([])).toBe('\uFEFF\r\n');
  });
});

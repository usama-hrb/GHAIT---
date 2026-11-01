import { describe, expect, it } from 'vitest';
import { LENGTH_PAD, moneyPad, type PadKey, pressKey } from './keypad';

const type = (keys: readonly PadKey[], rules = LENGTH_PAD, from = '') =>
  keys.reduce((text, key) => pressKey(text, key, rules), from);

describe('pressKey', () => {
  it('builds a number digit by digit', () => {
    expect(type(['2', '.', '7', '5'])).toBe('2.75');
  });

  it('starts a lone decimal point as 0.', () => {
    expect(type(['.', '5'])).toBe('0.5');
  });

  it('takes one decimal point only', () => {
    expect(type(['1', '.', '5', '.', '2'])).toBe('1.52');
  });

  it('drops a leading zero', () => {
    expect(type(['0', '5'])).toBe('5');
    expect(type(['0', '0', '0'])).toBe('0');
    expect(type(['0', '.', '0', '5'])).toBe('0.05');
  });

  it('stops at the decimals the unit has', () => {
    expect(type(['2', '.', '7', '5', '9'])).toBe('2.75');
    expect(type(['8', '6', '9', '.', '6', '5'], moneyPad('rial'))).toBe('869.6');
    expect(type(['4', '3', '.', '4', '8', '7'], moneyPad('dirham'))).toBe('43.48');
  });

  it('takes no decimal point when only whole numbers are allowed', () => {
    expect(type(['1', '.', '5'], { maxDecimals: 0 })).toBe('15');
  });

  it('stops at the length of a number', () => {
    expect(type(['1', '2', '3', '4', '5'], { maxDecimals: 2, maxLength: 4 })).toBe('1234');
  });

  it('deletes the last character, down to an empty text', () => {
    expect(type(['backspace'], LENGTH_PAD, '2.75')).toBe('2.7');
    expect(type(['backspace', 'backspace'], LENGTH_PAD, '2')).toBe('');
  });

  it('counts a decimal separator typed on a keyboard (comma, Arabic comma)', () => {
    expect(pressKey('2,5', '.', LENGTH_PAD)).toBe('2,5');
    expect(pressKey('2٫75', '1', LENGTH_PAD)).toBe('2٫75');
  });
});

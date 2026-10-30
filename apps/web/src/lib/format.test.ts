import { describe, expect, it } from 'vitest';
import { dateTime, money, shortDate } from './format.js';

describe('format helpers', () => {
  it('formats BRL values using Brazilian decimal and thousands separators', () => {
    expect(money(1200)).toContain('1.200,00');
    expect(money(0)).toContain('0,00');
  });

  it('formats full and compact dates in Brazilian Portuguese', () => {
    expect(dateTime('2026-10-28T13:40:00.000Z')).toContain('2026');
    expect(shortDate('2026-10-28T13:40:00.000Z')).toContain('28');
  });
});
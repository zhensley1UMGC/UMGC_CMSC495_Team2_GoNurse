import { describe, expect, it } from 'vitest';
import { split } from './formUtils';

describe('split', () => {
  it('trims comma-separated values and removes empty entries', () => {
    expect(split(' mentoring, , leadership , weekday_morning, ')).toEqual([
      'mentoring',
      'leadership',
      'weekday_morning',
    ]);
  });

  it('returns an empty array for empty or whitespace-only input', () => {
    expect(split('')).toEqual([]);
    expect(split('  ,  ')).toEqual([]);
  });

  it('preserves case, order, and duplicates', () => {
    expect(split('CPR, cpr, CPR')).toEqual(['CPR', 'cpr', 'CPR']);
  });
});

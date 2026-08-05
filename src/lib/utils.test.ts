import { describe, it, expect } from 'vitest';
import { formatPlaytime } from './utils';

describe('formatPlaytime', () => {
  it('formats zero as 0 min', () => {
    expect(formatPlaytime(0)).toBe('0 min');
  });

  it('treats negative values as zero', () => {
    expect(formatPlaytime(-5)).toBe('0 min');
  });

  it('rounds sub-minute values up to 1 min', () => {
    expect(formatPlaytime(59)).toBe('1 min');
  });

  it('formats exact minutes under an hour', () => {
    expect(formatPlaytime(60)).toBe('1 min');
  });

  it('rounds to the nearest minute just under an hour', () => {
    expect(formatPlaytime(3599)).toBe('60 min');
  });

  it('switches to hours at 3600 seconds', () => {
    expect(formatPlaytime(3600)).toBe('1 h');
  });

  it('keeps one decimal for fractional hours', () => {
    expect(formatPlaytime(45000)).toBe('12.5 h');
  });

  it('strips trailing .0 for large whole hours', () => {
    expect(formatPlaytime(36000)).toBe('10 h');
    expect(formatPlaytime(360000)).toBe('100 h');
  });
});

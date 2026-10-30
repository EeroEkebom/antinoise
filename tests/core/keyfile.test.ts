import { describe, expect, test } from 'vitest';
import { extractKey } from '../../src/core/keyfile.js';

describe('extractKey (from an RTF-pasted key file, robust to formatting noise)', () => {
  test('recovers the key from an RTF with font tables and control words', () => {
    const rtf = '{\\rtf1\\ansi{\\fonttbl{\\f0 Helvetica; ;; *;;}}\n\\f0\\fs24 b10_gKziCUQW.v3ncy6rpnuJ7tIMRjcwK6vOQWJAGLUvv}';
    expect(extractKey(rtf, 'b10_')).toBe('b10_gKziCUQW.v3ncy6rpnuJ7tIMRjcwK6vOQWJAGLUvv');
  });

  test('plain text passes through untouched', () => {
    expect(extractKey('b10_abcdefghij0123456789.abcdefghij012345', 'b10_')).toBe('b10_abcdefghij0123456789.abcdefghij012345');
  });

  test('no prefix in file → error', () => {
    expect(() => extractKey('there is no key here', 'b10_')).toThrow(/not found/i);
  });
});
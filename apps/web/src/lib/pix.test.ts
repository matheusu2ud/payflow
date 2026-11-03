import { describe, expect, it } from 'vitest';
import { normalizePixCopyPaste } from './pix';

describe('normalizePixCopyPaste', () => {
  it.each(['http://', 'https://', 'HTTPS://http://'])('removes a leading %s prefix and surrounding whitespace', (prefix) => {
    expect(normalizePixCopyPaste(` \n${prefix}000201pix-code \r\n`)).toBe('000201pix-code');
  });

  it('preserves whitespace inside the Pix payload', () => {
    expect(normalizePixCopyPaste('0002015905SAO PAULO6304ABCD')).toBe('0002015905SAO PAULO6304ABCD');
  });
});

import { encodeBlock, decodeBlock, extractBlock, escapeCell } from './wiki-format';

describe('wiki-format', () => {
  describe('encodeBlock / decodeBlock', () => {
    it('round-trips a plain object', () => {
      const data = { a: 1, b: ['x', 'y'], c: { nested: true } };
      expect(decodeBlock(encodeBlock(data))).toEqual(data);
    });

    it('round-trips UTF-8 / accented characters', () => {
      const data = { issueTitle: 'Correção de acentuação: ç, ã, é, ü, 中文, emoji 🚀' };
      expect(decodeBlock(encodeBlock(data))).toEqual(data);
    });
  });

  describe('extractBlock', () => {
    const V2 = 'nexus-git:test:v2';
    const V1 = 'nexus-git:test:v1';

    it('decodes a v2 (Base64) marker', () => {
      const data = { links: [{ issueIid: 1 }] };
      const content = `<!-- ${V2} ${encodeBlock(data)} -->\n# Title`;
      expect(extractBlock(content, V2, V1)).toEqual(data);
    });

    it('falls back to a v1 (raw JSON) marker when v2 is absent', () => {
      const data = { links: [{ issueIid: 2 }] };
      const content = `<!-- ${V1} ${JSON.stringify(data)} -->\n# Title`;
      expect(extractBlock(content, V2, V1)).toEqual(data);
    });

    it('returns null when neither marker is present', () => {
      const content = '# Just a regular wiki page\n\nNo embedded data here.';
      expect(extractBlock(content, V2, V1)).toBeNull();
    });

    it('does not throw on a malformed v2 marker and falls back or returns null', () => {
      const content = `<!-- ${V2} not-valid-base64!! -->\n# Title`;
      expect(() => extractBlock(content, V2, V1)).not.toThrow();
      expect(extractBlock(content, V2, V1)).toBeNull();
    });
  });

  describe('escapeCell', () => {
    it('escapes pipe characters', () => {
      expect(escapeCell('a | b')).toBe('a \\| b');
    });

    it('converts newlines to <br>', () => {
      expect(escapeCell('line1\nline2')).toBe('line1<br>line2');
      expect(escapeCell('line1\r\nline2')).toBe('line1<br>line2');
    });
  });
});

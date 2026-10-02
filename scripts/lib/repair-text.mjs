/**
 * Repair UTF-8 that was read as Windows-1252 and written back.
 *
 * Two characters in index.html render as mojibake: U+E2 U+20AC U+A6 and
 * U+E2 U+20AC U+201C. Each triple is what a UTF-8 em dash or ellipsis becomes
 * when its bytes are decoded as cp1252 and then re-encoded as UTF-8 - the second
 * byte 0x80 becomes a euro sign, the third lands in Latin-1. Left alone it is
 * visible garbage in the page.
 *
 * Mapping each codepoint back to the byte it came from and decoding the result
 * as UTF-8 restores the original character and touches nothing else.
 */
const REPAIRS = new Map([
  [0xe2, 0xe2], // leading byte of a 3-byte sequence, passes through
  [0x20ac, 0x80], // euro sign <- byte 0x80
  [0xa6, 0xa6], // broken bar <- byte 0xA6 (third byte of …)
  [0x201c, 0x93], // left double quote <- byte 0x93 (third byte of —)
  [0x201d, 0x94], // right double quote <- byte 0x94 (third byte of ")
]);

export function repairMojibake(text) {
  // Only rewrite lines that actually contain a repaired codepoint, so a file
  // with no damage comes back byte-identical.
  return text
    .split('\n')
    .map((line) => {
      if (![...line].some((c) => REPAIRS.has(c.codePointAt(0)))) return line;
      const bytes = [...line].map((c) => REPAIRS.get(c.codePointAt(0)) ?? c.codePointAt(0));
      return Buffer.from(bytes).toString('utf8');
    })
    .join('\n');
}

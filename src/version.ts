/** Compare two dotted numeric versions ("1.0.2" vs "1.0.10"). Missing or
 * non-numeric segments count as 0. */
export function compareVersions(a: string, b: string): -1 | 0 | 1 {
  const aParts = a.split(".");
  const bParts = b.split(".");
  const length = Math.max(aParts.length, bParts.length);

  for (let i = 0; i < length; i++) {
    const aNum = _segment(aParts[i]);
    const bNum = _segment(bParts[i]);

    if (aNum < bNum) return -1;
    if (aNum > bNum) return 1;
  }

  return 0;
}

function _segment(part: string | undefined): number {
  const parsed = Number.parseInt(part ?? "", 10);
  return Number.isNaN(parsed) ? 0 : parsed;
}

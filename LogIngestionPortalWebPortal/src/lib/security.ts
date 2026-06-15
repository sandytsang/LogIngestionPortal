import rules from '../../catalog/security-rules.json';

interface Rule {
  pattern: string;
  why: string;
}

const compiled = (rules as Rule[]).map((r) => ({ re: new RegExp(r.pattern, 'i'), why: r.why }));

/**
 * Returns the reasons a collector/expression is rejected by the read-only
 * security gate. Empty array means it passed. Mirrors scripts/validate-catalog.mjs
 * (both read catalog/security-rules.json).
 */
export function scanForbidden(code: string): string[] {
  const hits: string[] = [];
  for (const { re, why } of compiled) {
    if (re.test(code) && !hits.includes(why)) hits.push(why);
  }
  return hits;
}

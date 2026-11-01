export type SaasBrandTheme = 'gold' | 'rose' | 'sage';
export function brandTheme(value: unknown): SaasBrandTheme { return value === 'rose' || value === 'sage' ? value : 'gold'; }
export function brandMark(value: unknown, bakeryName = ''): string {
 if (typeof value === 'string' && /^[A-Z0-9]{1,4}$/i.test(value.trim())) return value.trim().toUpperCase();
 return bakeryName.trim().split(/\s+/).filter(Boolean).slice(0, 2).map(word => Array.from(word)[0]).join('').toLocaleUpperCase() || 'B';
}

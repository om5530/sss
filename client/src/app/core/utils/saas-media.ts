import { environment } from '../../../environments/environment';
export function publicImageUrl(path: unknown, slug: string): string | null {
 const prefix = `/saas/storefront/${encodeURIComponent(slug)}/media/`;
 if (typeof path !== 'string' || !path.startsWith(prefix) || !/^[a-f0-9]{24}\/[1-9][0-9]{0,15}-[a-f0-9]{64}\.webp$/.test(path.slice(prefix.length))) return null;
 return `${environment.apiUrl}${path}`;
}
export function privateImageUrl(value: unknown): string | null { return typeof value === 'string' && /^data:image\/webp;base64,[A-Za-z0-9+/]+=*$/.test(value) ? value : null; }

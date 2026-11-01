export const localMenuPath = (slug: string) => `/b/${slug}`;
export function localMenuPreview(path: string, production: boolean) { return !production && /^\/(?:b|saas-menu)\//.test(path); }
export function validLocalMenuLink(value: unknown, slug: string): string | null {
 if(typeof value!=='string'||value.length>256||typeof slug!=='string'||slug.length<3||slug.length>60||!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug))return null;
 try{const url=new URL(value);if(!['http:','https:'].includes(url.protocol)||!['localhost','127.0.0.1','[::1]'].includes(url.hostname)||url.port==='0'||url.username||url.password||url.search||url.hash||url.pathname!==localMenuPath(slug))return null;return url.href;}catch{return null;}
}

export function validStagingMenuLink(value: unknown, slug: string, origin: string): string | null {
 if(typeof value !== 'string' || typeof slug !== 'string' || slug.length < 3 || slug.length > 60 || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)) return null;
 try { const url = new URL(value), base = new URL(origin);
  if(base.protocol !== 'https:' || !/^golden-batch-saas-test(?:-[a-z0-9-]+)?\.vercel\.app$/.test(base.hostname) || url.origin !== base.origin || url.username || url.password || url.search || url.hash || url.pathname !== localMenuPath(slug)) return null;
  return url.href;
 } catch { return null; }
}

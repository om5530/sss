export type AdminRequestKind = 'loading' | 'saving' | 'calculating';

/** Keep background polling quiet; show feedback for foreground admin requests. */
export function adminRequestKind(url: string, method: string): AdminRequestKind | null {
  const path = url.split('?')[0];
  if (!/\/api\/admin(?:\/|$)/.test(path) || /\/messages\/unread-count$/.test(path)) return null;
  if (/\/(?:preview|simulate(?:\/draft)?|quote|recalculate|purchase-requirements)$/.test(path)) return 'calculating';
  return method === 'GET' || method === 'HEAD' ? 'loading' : 'saving';
}

export class AdminRequestState {
  private nextId = 0;
  private requests = new Map<number, AdminRequestKind>();
  begin(kind: AdminRequestKind): number {
    const id = ++this.nextId;
    this.requests.set(id, kind);
    return id;
  }
  end(id: number): void { this.requests.delete(id); }
  get count(): number { return this.requests.size; }
  get kind(): AdminRequestKind | null {
    const kinds = [...this.requests.values()];
    return kinds.includes('saving') ? 'saving' : kinds.includes('calculating') ? 'calculating' : kinds.length ? 'loading' : null;
  }
}

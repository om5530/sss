import '@angular/compiler';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DestroyRef, Injector, runInInjectionContext } from '@angular/core';
import { HttpErrorResponse } from '@angular/common/http';
import { of, Subject, throwError } from 'rxjs';
import { SaasService } from '../src/app/core/services/saas.service';
import { SaasTeam } from '../src/app/pages/saas-lab/saas-team';
import { SaasLab } from '../src/app/pages/saas-lab/saas-lab';
const tick = () => new Promise<void>(resolve => setImmediate(resolve));
const member = { _id: 'member-1', userId: 'user-1', name: 'Staff', accountActive: true, role: 'staff', active: true, version: 1 };
const invitation = { _id: 'invite-1', expiresAt: '2026-10-30T22:00:00Z', accepted: false, revoked: false, expired: false, version: 1, createdAt: '2026-10-30T21:30:00Z' };
async function setup(overrides: Record<string, unknown> = {}) {
  const calls: any[] = [];
  const api = { members: () => of({ members: [member], nextCursor: null }), invitations: () => of({ invitations: [invitation], nextCursor: null }),
    createInvitation: (...args: any[]) => { calls.push(['create', ...args]); return of({ invitation, token: 'a'.repeat(64) }); },
    revokeMember: (...args: any[]) => { calls.push(['member', ...args]); return of({ member: { ...member, active: false, version: 2 } }); },
    revokeInvitation: (...args: any[]) => { calls.push(['invite', ...args]); return of({ invitation: { ...invitation, revoked: true, version: 2 } }); }, ...overrides };
  const injector = Injector.create({ providers: [{ provide: SaasService, useValue: api }] });
  const page = runInInjectionContext(injector, () => new SaasTeam()) as any; page.bakeryId = 'a'; await page.load();
  return { page, calls, cleanup: () => { page.ngOnDestroy(); injector.destroy(); } };
}

test('creating an invite shows the one-time code, while revocation sends only the reviewed record and version', async () => {
  const { page, calls, cleanup } = await setup(); await page.create();
  assert.equal(page.code(), 'a'.repeat(64)); assert.deepEqual(calls[0], ['create', 'a', 30]);
  page.confirmation.set({ kind: 'invite', row: invitation }); await page.revoke();
  assert.deepEqual(calls[1], ['invite', 'a', invitation._id, 1]); assert.equal(page.code(), '');
  page.confirmation.set({ kind: 'member', row: member }); await page.revoke();
  assert.deepEqual(calls[2], ['member', 'a', member._id, 1]); assert.equal(page.members()[0].active, false);
  cleanup();
});

test('a stale team change retains confirmation and cannot update the displayed membership', async () => {
  const { page, cleanup } = await setup({ revokeMember: () => throwError(() => new HttpErrorResponse({ status: 409, error: { message: 'Membership changed' } })) });
  page.confirmation.set({ kind: 'member', row: member }); await page.revoke();
  assert.ok(page.confirmation()); assert.equal(page.members()[0].active, true); assert.match(page.error(), /changed/); cleanup();
});

test('switching bakery clears a generated code and ignores old team responses', async () => {
  const slow = new Subject<any>(); let count = 0;
  const { page, cleanup } = await setup({ members: () => ++count === 2 ? slow : of({ members: [member], nextCursor: null }) });
  await page.create(); const old = page.load(); page.bakeryId = 'b'; await page.load();
  slow.next({ members: [{ ...member, name: 'A private staff name' }], nextCursor: null }); await old;
  assert.equal(page.code(), ''); assert.equal(page.members()[0].name, 'Staff'); cleanup();
});

test('visibility changes hide raw invitation codes and leaving the component cannot restore them', async () => {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'document');
  const document = Object.assign(new EventTarget(), { hidden: false }); Object.defineProperty(globalThis, 'document', { value: document, configurable: true });
  const { page, cleanup } = await setup(); await page.create(); document.hidden = true; document.dispatchEvent(new Event('visibilitychange'));
  assert.equal(page.code(), ''); cleanup();
  if (descriptor) Object.defineProperty(globalThis, 'document', descriptor); else delete (globalThis as any).document;
});

test('joining requires review and uses the reviewed code, then refreshes authoritative staff context', async () => {
  const calls: any[] = [], cleanups: (() => void)[] = [];
  const bakery = { _id: 'joined', name: 'Joined bakery', slug: 'joined', currency: 'inr', timezone: 'Asia/Kolkata', version: 1 };
  const api = { bakeries: () => of([]), inspectInvitation: (token: string) => { calls.push(['inspect', token]); return of({ bakery, role: 'staff', alreadyMember: false }); },
    acceptInvitation: (token: string) => { calls.push(['accept', token]); return of({ bakery, role: 'staff', alreadyMember: false }); },
    bakeryContext: () => of({ ...bakery, role: 'staff' }), products: () => of({ products: [], nextCursor: null }) };
  const injector = Injector.create({ providers: [{ provide: SaasService, useValue: api }, { provide: DestroyRef, useValue: { onDestroy: (fn: () => void) => { cleanups.push(fn); return () => {}; } } }] });
  const page = runInInjectionContext(injector, () => new SaasLab()) as any; await tick();
  page.inviteToken = 'a'.repeat(64); await page.inspectInvite(); assert.equal(calls.length, 1); assert.ok(page.invitePreview());
  page.inviteToken = 'b'.repeat(64); await page.acceptInvite();
  assert.deepEqual(calls[1], ['accept', 'a'.repeat(64)]); assert.equal(page.selected().role, 'staff'); assert.equal(page.owner(), false);
  assert.equal(page.inviteToken, ''); assert.equal(page.invitePreview(), null);
  cleanups.forEach(fn => fn()); injector.destroy();
});

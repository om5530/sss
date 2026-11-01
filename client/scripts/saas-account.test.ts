import '@angular/compiler';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DestroyRef, Injector, runInInjectionContext } from '@angular/core';
import { HttpClient, HttpHeaders, HttpRequest, HttpResponse, HttpErrorResponse } from '@angular/common/http';
import { Router } from '@angular/router';
import { of, Subject, firstValueFrom, throwError } from 'rxjs';
import { SaasAccount } from '../src/app/pages/saas-lab/saas-account';
import { SaasAccountService } from '../src/app/core/services/saas-account.service';
import { SaasAccountState } from '../src/app/core/services/saas-account-state.service';
import { saasAccountInterceptor } from '../src/app/core/interceptors/saas-account.interceptor';
import { saasAccountGuard } from '../src/app/core/guards/saas-account.guard';
import { SaasService } from '../src/app/core/services/saas.service';
import { SaasLab } from '../src/app/pages/saas-lab/saas-lab';
const alice = { id: '100000000000000000000001', displayName: 'Alice', email: 'alice@example.test', emailVerified: false };
const bob = { ...alice, id: '200000000000000000000001' };
const tick = () => new Promise<void>(r => setImmediate(r));
async function setup(t: any, overrides: any = {}) {
 const state = new SaasAccountState(), calls: any[] = [], navigation: string[] = [];
 const api = { state, restore: async () => null, authenticate: async (...args: any[]) => { calls.push(args); return alice; }, changePassword: async (...args: any[]) => { calls.push(args); }, logout: async () => {}, ...overrides };
 const injector = Injector.create({ providers: [{ provide: SaasAccountService, useValue: api }, { provide: Router, useValue: { navigateByUrl: async (url: string) => navigation.push(url) } }] });
 const page = runInInjectionContext(injector, () => new SaasAccount()) as any; await tick();
 t.after(() => { page.ngOnDestroy(); injector.destroy(); }); return { page, api, state, calls, navigation };
}
test('account signup requires review, clears form secrets before response, and navigates only after success', async t => {
 let resolve!: (value: any) => void; const result = new Promise(r => resolve = r); const { page, calls, navigation } = await setup(t, { authenticate: (...args: any[]) => { calls.push(args); return result; } });
 page.mode = 'register'; page.form = { email: alice.email, displayName: 'Alice', password: 'valid-password-123', repeat: 'valid-password-123' };
 await page.authenticate(); assert.equal(calls.length, 0); page.prepare(); assert.equal(page.review(), 'register'); const pending = page.authenticate(); assert.equal(page.form.password, ''); assert.equal(page.form.repeat, ''); assert.equal(navigation.length, 0); assert.equal(calls[0][0].password, 'valid-password-123'); resolve(alice); await pending; assert.deepEqual(navigation, ['/saas-lab']); assert.equal(calls[0][0].password, '');
});
test('password review revokes through the service only after confirmation and clears secrets immediately', async t => {
 let resolve!: () => void; const pending = new Promise<void>(r => resolve = r); const { page, state, calls } = await setup(t, { changePassword: (...args: any[]) => { calls.push(args); return pending; } }); state.account.set(alice);
 page.passwordForm = { current: 'old-password-123', next: 'new-password-456', repeat: 'new-password-456' }; await page.changePassword(); assert.equal(calls.length, 0); page.reviewPassword(); const sent = page.changePassword(); assert.deepEqual(page.passwordForm, { current: '', next: '', repeat: '' }); assert.equal(calls.length, 1); resolve(); await sent; assert.match(page.notice(), /all workspace sessions/);
});
test('failed logout retains account and late signup responses do not navigate a destroyed page', async t => {
 const { page, state } = await setup(t, { logout: async () => { throw new Error('lost response'); } }); state.account.set(alice); await page.logout(); assert.equal(state.account()?.id, alice.id); assert.match(page.error(), /not confirmed/);
 let resolve!: (v: any) => void; const delayed = await setup(t, { authenticate: () => new Promise(r => resolve = r) }); delayed.page.form.password = 'valid-password-123'; const sent = delayed.page.authenticate(); delayed.page.ngOnDestroy(); resolve(alice); await sent; assert.deepEqual(delayed.navigation, []);
});
test('workspace interceptor scopes headers and never clears a newly switched account from an old error', async t => {
 const state = new SaasAccountState(); state.account.set(alice); const injector = Injector.create({ providers: [{ provide: SaasAccountState, useValue: state }] }); t.after(() => injector.destroy());
 const run = (url: string, next: any) => runInInjectionContext(injector, () => saasAccountInterceptor(new HttpRequest('GET', url, { headers: new HttpHeaders({ Authorization: 'Bearer legacy' }) }), next));
 let sent: any; await firstValueFrom(run('/api/saas/bakeries', (req: any) => { sent = req; return of(new HttpResponse()); })); assert.equal(sent.headers.has('Authorization'), false); assert.equal(sent.headers.get('X-Saas-Account-Id'), alice.id); assert.equal(sent.headers.get('X-Saas-Workspace'), '1');
 await firstValueFrom(run('/api/saas/storefront/test/customer/me', (req: any) => { sent = req; return of(new HttpResponse()); })); assert.equal(sent.headers.has('X-Saas-Account-Id'), false);
 const response = new Subject<any>(); const request = firstValueFrom(run('/api/saas/invitations/inspect', () => response)); state.account.set(bob); response.error(new HttpErrorResponse({ status: 401 })); await assert.rejects(request); assert.equal(state.account()?.id, bob.id);
 await assert.rejects(firstValueFrom(run('/api/saas/bakeries', () => throwError(() => new HttpErrorResponse({ status: 409, error: { details: { code: 'SAAS_ACCOUNT_CHANGED' } } }))))); assert.equal(state.account(), null);
});
test('account service ignores stale restore and retains state on uncertain logout', async t => {
 const restore = new Subject<any>(), signIn = new Subject<any>(), state = new SaasAccountState(); const injector = Injector.create({ providers: [{ provide: SaasAccountState, useValue: state }, { provide: HttpClient, useValue: { get: () => restore, post: (url: string) => url.endsWith('/logout') ? throwError(() => new Error('network')) : signIn } }] }); t.after(() => injector.destroy());
 const api = runInInjectionContext(injector, () => new SaasAccountService()); const old = api.restore(); const login = api.authenticate({ email: alice.email, password: 'valid-password-123' }, false); signIn.next({ account: bob }); await login; restore.next({ account: alice }); assert.equal(await old, null); assert.equal(state.account()?.id, bob.id); await assert.rejects(api.logout()); assert.equal(state.account()?.id, bob.id);
});
test('workspace guard restores cookie identity and redirects expired sessions to dedicated sign-in', async t => {
 let active = true; const injector = Injector.create({ providers: [{ provide: SaasAccountService, useValue: { restore: async () => { if (!active) throw new Error('expired'); return alice; } } }, { provide: Router, useValue: { createUrlTree: (path: any) => path } }] }); t.after(() => injector.destroy());
 assert.equal(await runInInjectionContext(injector, () => saasAccountGuard({} as any, {} as any)), true); active = false; assert.deepEqual(await runInInjectionContext(injector, () => saasAccountGuard({} as any, {} as any)), ['/saas-account']);
});
test('bakery creation requires review and sends the frozen name and slug', async t => {
 const calls: any[] = []; const injector = Injector.create({ providers: [{ provide: DestroyRef, useValue: { onDestroy: () => {} } }, { provide: SaasService, useValue: { bakeries: () => of([]), createBakery: (input: any) => { calls.push(input); return throwError(() => new Error('offline')); } } }] }); t.after(() => injector.destroy());
 const page = runInInjectionContext(injector, () => new SaasLab()) as any; await tick(); page.bakeryForm = { name: 'First bakery', slug: 'first-bakery' }; await page.createBakery(); assert.equal(calls.length, 0); page.reviewBakery(); page.bakeryForm.name = 'Changed'; await page.createBakery(); assert.deepEqual(calls[0], { name: 'First bakery', slug: 'first-bakery' }); assert.deepEqual(page.bakeryReview(), calls[0]);
});

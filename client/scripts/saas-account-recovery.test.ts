import '@angular/compiler';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Injector, runInInjectionContext, SimpleChange } from '@angular/core';
import { HttpErrorResponse } from '@angular/common/http';
import { of, Subject, throwError } from 'rxjs';
import { SaasAccountRecovery } from '../src/app/pages/saas-lab/saas-account-recovery';
import { SaasAccountService } from '../src/app/core/services/saas-account.service';
const token = 'a'.repeat(64);
function setup(t: any, overrides: any = {}) {
 const calls: any[] = [], events: boolean[] = []; let restored = 0;
 const api = { requestReset: (email: string) => { calls.push(['request', email]); return of({ message: 'If eligible, a preview was queued. No email was sent' }); }, requestVerification: () => { calls.push(['verify']); return of({ message: 'No email was sent' }); }, confirmAction: (...args: any[]) => { calls.push(args); return of({ message: 'Completed. Email ownership remains unverified' }); }, restore: async () => { restored++; return null; }, ...overrides };
 const injector = Injector.create({ providers: [{ provide: SaasAccountService, useValue: api }] }); const page = runInInjectionContext(injector, () => new SaasAccountRecovery()) as any;
 page.busyChange.subscribe((value: boolean) => events.push(value)); t.after(() => { page.ngOnDestroy(); injector.destroy(); }); return { page, calls, events, restored: () => restored };
}
test('owner token actions require review and clear form secrets before a slow confirmation', async t => {
 const slow = new Subject<any>(), { page, calls, restored, events } = setup(t, { confirmAction: (...args: any[]) => { calls.push(args); return slow; } });
 page.form = { token, password: 'New workspace password', repeat: 'New workspace password' }; await page.confirm(); assert.equal(calls.length, 0); page.prepare(); page.purpose = 'email_verify'; const sent = page.confirm(); assert.deepEqual(calls[0], ['password_reset', token, 'New workspace password']); assert.deepEqual(page.form, { token: '', password: '', repeat: '' }); assert.equal(page.busy(), true); slow.next({ message: 'Reset completed' }); await sent; assert.equal(restored(), 1); assert.deepEqual(events, [true, false]);
});
test('verification sends no password and cancellation, account changes and destruction discard proof secrets', async t => {
 const { page, calls } = setup(t); page.purpose = 'email_verify'; page.form = { token, password: 'unused password', repeat: 'unused password' }; page.prepare(); await page.confirm(); assert.deepEqual(calls[0], ['email_verify', token, undefined]); assert.match(page.notice(), /unverified/);
 page.form.token = token; page.prepare(); page.cancel(); assert.equal(page.form.token, ''); page.form.token = token; page.ngOnChanges({ accountId: new SimpleChange('alice', 'bob', false) }); assert.equal(page.form.token, ''); page.form.token = token; page.ngOnDestroy(); assert.equal(page.form.token, '');
});
test('late recovery responses cannot update a switched account or restore a destroyed screen', async t => {
 const slow = new Subject<any>(), { page, restored } = setup(t, { confirmAction: () => slow }); page.form = { token, password: 'New workspace password', repeat: 'New workspace password' }; page.prepare(); const pending = page.confirm(); page.ngOnChanges({ accountId: new SimpleChange('alice', 'bob', false) }); slow.next({ message: 'A sensitive old account result' }); await pending; assert.equal(page.notice(), ''); assert.equal(restored(), 0);
});
test('uncertain resets preserve no token or password and do not retry automatically', async t => {
 const { page, calls } = setup(t, { confirmAction: (...args: any[]) => { calls.push(args); return throwError(() => new HttpErrorResponse({ status: 0 })); } }); page.form = { token, password: 'New workspace password', repeat: 'New workspace password' }; page.prepare(); await page.confirm(); assert.equal(calls.length, 1); assert.equal(page.form.token, ''); assert.equal(page.form.password, ''); assert.match(page.error(), /Try signing in/); await page.confirm(); assert.equal(calls.length, 1);
});
test('recovery and other account mutations block each other while unrelated input changes retain drafts', async t => {
 const slow = new Subject<any>(), { page, calls } = setup(t, { requestReset: (email: string) => { calls.push(['request', email]); return slow; } }); page.accountBusy = true; page.email = 'owner@example.test'; await page.request(); assert.equal(calls.length, 0); page.accountBusy = false; page.form.token = token; page.ngOnChanges({ accountBusy: new SimpleChange(true, false, false) }); assert.equal(page.form.token, token);
 const pending = page.request(); assert.equal(page.busy(), true); await page.request(true); assert.equal(calls.length, 1); slow.next({ message: 'Generic queued response' }); await pending; page.accountId = ''; await page.request(true); assert.equal(calls.length, 1);
});

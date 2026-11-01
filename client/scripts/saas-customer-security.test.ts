import '@angular/compiler';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Injector, runInInjectionContext } from '@angular/core';
import { HttpErrorResponse } from '@angular/common/http';
import { of, Subject, throwError } from 'rxjs';
import { SaasCustomerService } from '../src/app/core/services/saas-customer.service';
import { SaasCustomerSecurity } from '../src/app/pages/saas-lab/saas-customer-security';
const customer = { id: '100000000000000000000001', email: 'alice@example.test', displayName: 'Alice', emailVerified: false };
const password = 'Initial password!42', newPassword = 'A different password!43';
function setup(t: any, overrides: Record<string, unknown> = {}) {
 const calls: any[] = []; const api = { changePassword: (...args: any[]) => { calls.push(args); return of({ message: 'Password changed. Sign in again' }); }, requestReset: () => of({ message: 'If eligible, a local preview was queued. No email was sent' }), resetPassword: () => of({ message: 'Reset. Sign in again' }), requestVerification: () => of({ message: 'Local preview queued' }), confirmVerification: () => of({ message: 'Preview complete; real ownership unverified' }), ...overrides };
 const injector = Injector.create({ providers: [{ provide: SaasCustomerService, useValue: api }] }); const page = runInInjectionContext(injector, () => new SaasCustomerSecurity()) as any; page.slug = 'bakery-a'; page.customer = customer; page.ngOnChanges(); t.after(() => { page.ngOnDestroy(); injector.destroy(); }); return { page, calls };
}
test('password changes require review, match both new entries and clear secrets before sending', async t => {
 const response = new Subject<any>(), sent: any[] = []; const { page } = setup(t, { changePassword: (...args: any[]) => { sent.push(args); return response; } });
 page.open('change'); page.form = { email: '', token: '', currentPassword: password, newPassword, repeatPassword: newPassword }; await page.submit(); assert.equal(sent.length, 0);
 page.reviewPassword(); assert.equal(page.changeReview(), true); const changing = page.submit(); assert.equal(sent[0][0], 'bakery-a'); assert.equal(sent[0][1], customer.id); assert.equal(sent[0][2], password); assert.equal(page.form.currentPassword, ''); assert.equal(page.form.newPassword, '');
 const updates: string[] = []; page.accountChanged.subscribe((message: string) => updates.push(message)); response.next({ message: 'Changed; sign in again' }); await changing; assert.deepEqual(updates, ['Changed; sign in again']); assert.equal(page.mode(), null); assert.equal(page.busy(), false);
});
test('mismatched passwords and disabled account forms send no request', async t => {
 const { page, calls } = setup(t); page.open('change'); page.form.currentPassword = password; page.form.newPassword = newPassword; page.form.repeatPassword = password; page.reviewPassword(); await page.submit(); assert.equal(calls.length, 0);
 page.form.repeatPassword = newPassword; page.reviewPassword(); page.disabled = true; await page.submit(); assert.equal(calls.length, 0);
});
test('uncertain reset responses clear token/password fields and advise checking sign-in', async t => {
 const { page } = setup(t, { resetPassword: () => throwError(() => new HttpErrorResponse({ status: 0 })) }); page.open('reset'); page.form.token = 'a'.repeat(64); page.form.newPassword = newPassword; page.form.repeatPassword = newPassword; await page.submit(); assert.equal(page.form.token, ''); assert.equal(page.form.newPassword, ''); assert.match(page.error(), /try signing in/); assert.equal(page.busy(), false);
});
test('late account actions cannot replace a new bakery identity or leave it busy', async t => {
 const response = new Subject<any>(); const { page } = setup(t, { confirmVerification: () => response }); const updates: any[] = []; page.accountChanged.subscribe((value: any) => updates.push(value));
 page.open('verify'); page.form.token = 'a'.repeat(64); const verifying = page.submit(); page.slug = 'bakery-b'; page.customer = null; page.ngOnChanges(); response.next({ message: 'Old preview complete' }); await verifying; assert.equal(page.notice(), ''); assert.equal(page.busy(), false); assert.equal(page.mode(), null); assert.deepEqual(updates, []);
});
test('expired sessions request an account refresh without preserving form secrets', async t => {
 const { page } = setup(t, { requestVerification: () => throwError(() => new HttpErrorResponse({ status: 409, error: { details: { code: 'CUSTOMER_SESSION_CHANGED' } } })) }); const updates: any[] = []; page.accountChanged.subscribe((value: any) => updates.push(value)); page.open('request-verify'); await page.submit(); assert.equal(updates.length, 1); assert.match(updates[0], /Pending pickup order recovery was retained/);
});

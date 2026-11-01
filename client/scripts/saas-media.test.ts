import '@angular/compiler';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Injector, runInInjectionContext } from '@angular/core';
import { HttpErrorResponse } from '@angular/common/http';
import { of, Subject, throwError } from 'rxjs';
import { SaasService } from '../src/app/core/services/saas.service';
import { SaasMedia } from '../src/app/pages/saas-lab/saas-media';
import { publicImageUrl, privateImageUrl } from '../src/app/core/utils/saas-media';
const saved = { version: 1, image: { dataUrl: 'data:image/webp;base64,YWJj', width: 50, height: 50, byteLength: 100 } };
async function setup(t: any, overrides: any = {}) {
 const calls: any[] = [], api = { mediaSlot: () => of({ version: 0, image: null }), saveMedia: (...args: any[]) => { calls.push(args); return of(saved); }, ...overrides };
 const injector = Injector.create({ providers: [{ provide: SaasService, useValue: api }] }); const page = runInInjectionContext(injector, () => new SaasMedia()) as any; page.bakeryId = 'a'; page.targetId = 'p'; page.kind = 'product'; await page.load(); t.after(() => { page.ngOnDestroy(); injector.destroy(); }); return { page, calls };
}
test('image replacement requires review and freezes the image, target version and scope', async t => {
 const { page, calls } = await setup(t); page.draft.set({ base64: 'old-bytes', preview: 'data:image/png;base64,YQ==' }); await page.confirm(); assert.equal(calls.length, 0); page.prepare(); page.draft.set({ base64: 'unreviewed', preview: 'x' }); page.slot.set({ version: 99, image: null }); await page.confirm(); assert.deepEqual(calls[0], ['a','product','p','old-bytes',0]); assert.equal(page.slot().version,1); assert.equal(page.draft(),null);
});
test('removal requires an existing image and failed confirmations retain the reviewed version for recovery', async t => {
 const { page, calls } = await setup(t, { saveMedia: (...args: any[]) => { calls.push(args); return throwError(() => new HttpErrorResponse({ status: 409, error: { message: 'Image changed. Reload before saving' } })); } }); page.prepare(true); assert.equal(page.review(),null); page.slot.set(saved); page.prepare(true); await page.confirm(); assert.deepEqual(calls[0], ['a','product','p',null,1]); assert.equal(page.review().version,1); assert.equal(page.slot().image.dataUrl,saved.image.dataUrl); assert.match(page.error(),/Reload/);
});
test('switching image scope clears saved and selected pictures and ignores a late upload response', async t => {
 const slow = new Subject<any>(); const { page } = await setup(t, { saveMedia: () => slow }); page.draft.set({ base64: 'bytes', preview: 'preview' }); page.prepare(); const pending = page.confirm(); page.bakeryId = 'b'; page.targetId = 'q'; await page.load(); slow.next(saved); await pending; assert.equal(page.slot().image,null); assert.equal(page.draft(),null); assert.equal(page.review(),null); assert.equal(page.notice(),'');
});
test('file reads are bounded and late reads cannot restore a replaced draft or another bakery', async t => {
 const descriptor = Object.getOwnPropertyDescriptor(globalThis,'FileReader'), readers: any[] = [];
 class Reader { result: any = ''; onload?: () => void; onerror?: () => void; aborted = false; constructor(){readers.push(this);} abort(){this.aborted=true;} readAsDataURL(){} }
 Object.defineProperty(globalThis,'FileReader',{configurable:true,value:Reader}); t.after(()=>{if(descriptor)Object.defineProperty(globalThis,'FileReader',descriptor);else delete (globalThis as any).FileReader;});
 const { page } = await setup(t); const choose = (size=10,type='image/png') => page.choose({ target: { files: [{size,type}],value:'x' } }); choose(512*1024+1); assert.equal(readers.length,0); choose(10,'image/svg+xml'); assert.equal(readers.length,0); choose(); choose(); readers[0].result='data:image/png;base64,YQ=='; readers[0].onload(); assert.equal(page.draft(),null); readers[1].result='data:image/png;base64,Yg=='; readers[1].onload(); assert.equal(page.draft().base64,'Yg=='); page.bakeryId='b'; await page.load(); readers[1].onload(); assert.equal(page.draft(),null); assert.equal(readers[1].aborted,true);
});
test('menu image URLs accept only versioned images of the resolved bakery and private previews only WebP data', () => {
 const suffix = `${'a'.repeat(24)}/2-${'b'.repeat(64)}.webp`, path = `/saas/storefront/bakery-a/media/${suffix}`;
 assert.ok(publicImageUrl(path,'bakery-a')?.endsWith(path));
 for(const bad of [path.replace('bakery-a','bakery-b'),`https://external.test${path}`,`//external.test${path}`,path+'?next=x',path.replace('/2-','/0-'),path.replace('.webp','.svg')]) assert.equal(publicImageUrl(bad,'bakery-a'),null);
 assert.equal(privateImageUrl('data:image/svg+xml;base64,YQ=='),null); assert.equal(privateImageUrl('javascript:alert(1)'),null); assert.equal(privateImageUrl(saved.image.dataUrl),saved.image.dataUrl);
});

test('revoked image access clears previously displayed private pixels and pending reviews', async t => {
 const { page } = await setup(t, { saveMedia: () => throwError(() => new HttpErrorResponse({status:403})) }); page.slot.set(saved); page.prepare(true); await page.confirm(); assert.equal(page.slot(),null); assert.equal(page.review(),null); assert.equal(page.draft(),null);
});

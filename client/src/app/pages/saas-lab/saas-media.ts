import { Component, Input, OnChanges, OnDestroy, inject, signal } from '@angular/core';
import { HttpErrorResponse } from '@angular/common/http';
import { firstValueFrom, timeout } from 'rxjs';
import { SaasService } from '../../core/services/saas.service';
import { SaasMediaSlot } from '../../core/models/saas-media.model';
import { privateImageUrl } from '../../core/utils/saas-media';
@Component({ selector: 'app-saas-media', templateUrl: './saas-media.html', styleUrls: ['./saas-lab.scss', './saas-media.scss'] })
export class SaasMedia implements OnChanges, OnDestroy {
 @Input({ required: true }) bakeryId!: string; @Input({ required: true }) targetId!: string; @Input() kind: 'logo' | 'product' = 'product'; @Input() name = '';
 private readonly api = inject(SaasService); private generation = 0; private reader?: FileReader;
 protected readonly slot = signal<SaasMediaSlot | null>(null); protected readonly busy = signal(false); protected readonly loading = signal(false); protected readonly error = signal(''); protected readonly notice = signal('');
 protected readonly draft = signal<{ base64: string; preview: string } | null>(null); protected readonly review = signal<{ base64: string | null; preview: string | null; version: number } | null>(null);
 protected readonly imageUrl = privateImageUrl;
 ngOnChanges() { void this.load(); }
 ngOnDestroy() { this.generation++; this.reader?.abort(); this.draft.set(null); this.review.set(null); this.slot.set(null); }
 protected async load() {
  const generation = ++this.generation; this.reader?.abort(); this.slot.set(null); this.draft.set(null); this.review.set(null); this.error.set(''); this.notice.set(''); this.loading.set(true); this.busy.set(false);
  try { const slot = await firstValueFrom(this.api.mediaSlot(this.bakeryId, this.kind, this.targetId).pipe(timeout(15000))); if (generation === this.generation) this.slot.set(slot); }
  catch (error) { if (generation === this.generation) this.failure(error); } finally { if (generation === this.generation) this.loading.set(false); }
 }
 protected choose(event: Event) {
  const input = event.target as HTMLInputElement, file = input.files?.[0]; input.value = '';
  if (!file || this.busy() || this.loading() || this.review() || !this.slot()) return;
  this.reader?.abort(); this.draft.set(null); this.error.set(''); this.notice.set('');
  if (file.size > 512 * 1024 || file.size === 0 || !['image/png', 'image/jpeg', 'image/webp'].includes(file.type)) { this.error.set('Choose a JPEG, PNG or WebP image up to 512 KiB.'); return; }
  const generation = this.generation, reader = this.reader = new FileReader();
  reader.onload = () => { if (generation !== this.generation || reader !== this.reader) return; const value = reader.result; if (typeof value !== 'string' || !value.startsWith(`data:${file.type};base64,`)) { this.error.set('Could not read this image.'); return; } this.draft.set({ preview: value, base64: value.slice(value.indexOf(',') + 1) }); };
  reader.onerror = () => { if (generation === this.generation && reader === this.reader) this.error.set('Could not read this image.'); };
  reader.readAsDataURL(file);
 }
 protected prepare(remove = false) { const slot = this.slot(), draft = this.draft(); if (!slot || this.busy() || this.loading() || (remove ? !slot.image : !draft)) return; this.reader?.abort(); this.reader = undefined; this.review.set({ base64: remove ? null : draft!.base64, preview: remove ? null : draft!.preview, version: slot.version }); }
 protected cancel() { if (!this.busy()) this.review.set(null); }
 protected async confirm() {
  const review = this.review(); if (!review || this.busy()) return;
  const generation = this.generation; this.busy.set(true); this.error.set(''); this.notice.set('');
  try { const slot = await firstValueFrom(this.api.saveMedia(this.bakeryId, this.kind, this.targetId, review.base64, review.version).pipe(timeout(20000))); if (generation !== this.generation) return; this.slot.set(slot); this.draft.set(null); this.review.set(null); this.notice.set(slot.image ? 'Image saved locally. A published menu can show it.' : 'Image removed.'); }
  catch (error) { if (generation === this.generation) this.failure(error); } finally { if (generation === this.generation) this.busy.set(false); }
 }
 private failure(error: unknown) { if (error instanceof HttpErrorResponse && ([401,403,404].includes(error.status) || error.error?.details?.code === 'SAAS_ACCOUNT_CHANGED')) { this.slot.set(null); this.draft.set(null); this.review.set(null); } this.error.set(error instanceof HttpErrorResponse && typeof error.error?.message === 'string' ? error.error.message : 'Image change was not confirmed. Reload the saved image before retrying.'); }
}

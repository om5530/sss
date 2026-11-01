import { AfterViewChecked, Component, ElementRef, Input, OnChanges, OnDestroy, ViewChild, inject, signal } from '@angular/core';
import { DatePipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { HttpErrorResponse } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { SaasService } from '../../core/services/saas.service';
import { SaasInvitation, SaasMember } from '../../core/models/saas-team.model';

@Component({ selector: 'app-saas-team', imports: [FormsModule, DatePipe], templateUrl: './saas-team.html', styleUrl: './saas-lab.scss' })
export class SaasTeam implements OnChanges, OnDestroy, AfterViewChecked {
  @Input({ required: true }) bakeryId!: string;
  @ViewChild('teamDialog') private dialog?: ElementRef<HTMLDialogElement>;
  private readonly api = inject(SaasService);
  private generation = 0;
  private readonly visibility = () => { if (document.hidden) this.code.set(''); };
  protected readonly members = signal<SaasMember[]>([]);
  protected readonly invitations = signal<SaasInvitation[]>([]);
  protected readonly memberCursor = signal<string | null>(null);
  protected readonly inviteCursor = signal<string | null>(null);
  protected readonly code = signal('');
  protected readonly generated = signal<SaasInvitation | null>(null);
  protected readonly confirmation = signal<{ kind: 'member'; row: SaasMember } | { kind: 'invite'; row: SaasInvitation } | null>(null);
  protected readonly busy = signal(false);
  protected readonly loading = signal(false);
  protected readonly error = signal('');
  protected readonly notice = signal('');
  protected expires = 30;
  constructor() { if (typeof document !== 'undefined') document.addEventListener('visibilitychange', this.visibility); }
  ngOnChanges() { void this.load(); }
  ngOnDestroy() { this.generation++; this.code.set(''); this.dialog?.nativeElement.close(); if (typeof document !== 'undefined') document.removeEventListener('visibilitychange', this.visibility); }
  ngAfterViewChecked() { const dialog = this.dialog?.nativeElement; if (dialog && !dialog.open) dialog.showModal(); }
  protected cancel(event?: Event) { event?.preventDefault(); if (!this.busy()) this.confirmation.set(null); }
  private failure(error: unknown) { this.error.set(error instanceof HttpErrorResponse && typeof error.error?.message === 'string' ? error.error.message : 'Could not change team access. Refresh and retry.'); }
  protected async load() {
    const generation = ++this.generation; this.code.set(''); this.generated.set(null); this.confirmation.set(null);
    this.members.set([]); this.invitations.set([]); this.memberCursor.set(null); this.inviteCursor.set(null);
    this.error.set(''); this.notice.set(''); this.loading.set(true); this.busy.set(false);
    try {
      const [members, invitations] = await Promise.all([firstValueFrom(this.api.members(this.bakeryId)), firstValueFrom(this.api.invitations(this.bakeryId))]);
      if (generation !== this.generation) return;
      this.members.set(members.members); this.invitations.set(invitations.invitations); this.memberCursor.set(members.nextCursor); this.inviteCursor.set(invitations.nextCursor);
    } catch (error) { if (generation === this.generation) this.failure(error); }
    finally { if (generation === this.generation) this.loading.set(false); }
  }
  protected async more(kind: 'members' | 'invites') {
    if (this.busy() || this.loading()) return;
    const cursor = kind === 'members' ? this.memberCursor() : this.inviteCursor(); if (!cursor) return;
    const generation = this.generation; this.loading.set(true);
    try {
      if (kind === 'members') { const page = await firstValueFrom(this.api.members(this.bakeryId, cursor)); if (generation !== this.generation) return; this.members.update(rows => [...rows, ...page.members]); this.memberCursor.set(page.nextCursor); }
      else { const page = await firstValueFrom(this.api.invitations(this.bakeryId, cursor)); if (generation !== this.generation) return; this.invitations.update(rows => [...rows, ...page.invitations]); this.inviteCursor.set(page.nextCursor); }
    } catch (error) { if (generation === this.generation) this.failure(error); }
    finally { if (generation === this.generation) this.loading.set(false); }
  }
  protected async create() {
    if (this.busy() || this.loading()) return;
    const generation = this.generation; this.busy.set(true); this.error.set('');
    try {
      const result = await firstValueFrom(this.api.createInvitation(this.bakeryId, this.expires));
      if (generation !== this.generation) return;
      this.code.set(result.token); this.generated.set(result.invitation); this.invitations.update(rows => [result.invitation, ...rows]);
      this.notice.set('Invite created. Share this code only with the staff member you want to add.');
    } catch (error) { if (generation === this.generation) this.failure(error); }
    finally { if (generation === this.generation) this.busy.set(false); }
  }
  protected async copy() {
    const code = this.code(); if (!code) return;
    const generation = this.generation;
    try { await navigator.clipboard.writeText(code); if (generation === this.generation) this.notice.set('Invite code copied.'); }
    catch { if (generation === this.generation) this.error.set('Copy is unavailable. Select and copy the code manually.'); }
  }
  protected async revoke() {
    const target = this.confirmation(); if (!target || this.busy()) return;
    const generation = this.generation; this.busy.set(true); this.error.set('');
    try {
      if (target.kind === 'member') { const result = await firstValueFrom(this.api.revokeMember(this.bakeryId, target.row._id, target.row.version)); if (generation !== this.generation) return; this.members.update(rows => rows.map(row => row._id === result.member._id ? { ...row, ...result.member } : row)); }
      else { const result = await firstValueFrom(this.api.revokeInvitation(this.bakeryId, target.row._id, target.row.version)); if (generation !== this.generation) return; this.invitations.update(rows => rows.map(row => row._id === result.invitation._id ? result.invitation : row)); if (this.generated()?._id === target.row._id) this.code.set(''); }
      this.confirmation.set(null); this.notice.set(target.kind === 'member' ? 'Staff access removed from this bakery.' : 'Invite code revoked. Existing staff access is unchanged.');
    } catch (error) { if (generation === this.generation) this.failure(error); }
    finally { if (generation === this.generation) this.busy.set(false); }
  }
}

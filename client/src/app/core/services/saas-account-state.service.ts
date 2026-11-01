import { Injectable, signal } from '@angular/core';
export interface SaasAccountProfile { id: string; displayName: string; email: string; emailVerified: boolean; }
@Injectable({ providedIn: 'root' })
export class SaasAccountState { readonly account = signal<SaasAccountProfile | null>(null); }

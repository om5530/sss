import { Bakery, BakeryRole } from './saas.model';
export interface SaasMember { _id: string; userId: string; name: string; accountActive: boolean; role: BakeryRole; active: boolean; version: number; }
export interface SaasInvitation { _id: string; expiresAt: string; accepted: boolean; revoked: boolean; expired: boolean; version: number; createdAt: string; }
export interface SaasInvitePreview { bakery: Bakery; role: BakeryRole; alreadyMember: boolean; }

export interface SaasSubscription {
  planId: 'starter' | 'growth'; status: 'trialing' | 'active' | 'past_due' | 'cancelled'; version: number;
  trialEndsAt: string | null; currentPeriodEndsAt: string | null; graceEndsAt: string | null; cancelAtPeriodEnd: boolean;
}
export interface SaasSubscriptionReport {
  subscription: SaasSubscription | null; policy: 'development' | 'subscription-preview'; planName: string;
  access: 'development' | 'trial' | 'active' | 'grace' | 'restricted'; writable: boolean; billingConnected: false;
}
export interface SaasSubscriptionChange { _id: string; before: SaasSubscription | null; after: SaasSubscription; reason: string; createdAt: string; }

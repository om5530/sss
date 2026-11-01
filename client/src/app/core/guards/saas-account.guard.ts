import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { SaasAccountService } from '../services/saas-account.service';
export const saasAccountGuard: CanActivateFn = async () => { const service = inject(SaasAccountService), router = inject(Router); try { return await service.restore() ? true : router.createUrlTree(['/saas-account']); } catch { return router.createUrlTree(['/saas-account']); } };

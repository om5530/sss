import { firstValueFrom, timeout, type Observable } from 'rxjs';

/** A failed connection must neither hold startup forever nor erase a saved login. */
export async function loadSavedSession<T>(request: Observable<T>, timeoutMs = 10_000): Promise<T | null> {
  try {
    return await firstValueFrom(request.pipe(timeout({ first: timeoutMs })));
  } catch (error) {
    const status = (error as { status?: number } | null)?.status;
    if (status === 401 || status === 403) return null;
    throw error;
  }
}

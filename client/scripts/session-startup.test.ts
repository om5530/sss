import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Observable, of, throwError } from 'rxjs';
import { loadSavedSession } from '../src/app/core/utils/session-startup.ts';

test('a valid saved login is restored', async () => {
  const session = { user: { role: 'admin' } };
  assert.equal(await loadSavedSession(of(session)), session);
});

test('only an explicitly rejected login is cleared', async () => {
  for (const status of [401, 403]) {
    assert.equal(await loadSavedSession(throwError(() => ({ status }))), null);
  }
});

test('offline and server failures remain retryable instead of clearing the saved login', async () => {
  for (const status of [0, 500, 503]) {
    const failure = { status };
    await assert.rejects(loadSavedSession(throwError(() => failure)), (error) => error === failure);
  }
});

test('a stalled session check times out and cancels the request', async () => {
  let cancelled = false;
  const stalled = new Observable(() => () => { cancelled = true; });
  await assert.rejects(loadSavedSession(stalled, 20), { name: 'TimeoutError' });
  assert.equal(cancelled, true);
});

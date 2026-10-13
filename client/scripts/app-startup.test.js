const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const vm = require('node:vm');

const html = readFileSync(require.resolve('../src/index.html'), 'utf8');
const script = html.match(/<script id="app-startup-watchdog">([\s\S]*?)<\/script>/)[1];

function openingApp({ online = true, url = 'https://shop.example/admin/events?event=sargam#stock' } = {}) {
  const screen = { isConnected: true, remove() { this.isConnected = false; } };
  const message = { textContent: 'Opening Golden Batch…' };
  const retry = { hidden: true, href: '' };
  const elements = { 'app-startup': screen, 'startup-message': message, 'startup-retry': retry };
  const events = new Map();
  let expired;
  let cleared = false;
  let replacedUrl;
  const window = {
    location: { href: url },
    history: { state: { navigationId: 1 }, replaceState(state, title, nextUrl) { replacedUrl = nextUrl; } },
    addEventListener(name, listener) { events.set(name, listener); },
    removeEventListener(name) { events.delete(name); },
  };
  const navigator = { onLine: online };
  vm.runInNewContext(script, {
    URL, window, navigator, document: { getElementById: (id) => elements[id] },
    setTimeout(callback, ms) { expired = callback; assert.equal(ms, 15_000); return 1; },
    clearTimeout() { cleared = true; },
  });
  return { screen, message, retry, navigator, events, expire: () => expired(),
    get cleared() { return cleared; }, get replacedUrl() { return replacedUrl; } };
}

test('missing bundles cannot leave a permanent splash; retry preserves route, filters and hash', () => {
  const app = openingApp();
  assert.equal(app.retry.hidden, true);
  app.expire();
  assert.equal(app.retry.hidden, false);
  const target = new URL(app.retry.href);
  assert.equal(target.pathname, '/admin/events');
  assert.equal(target.searchParams.get('event'), 'sargam');
  assert.equal(target.searchParams.get('ngsw-bypass'), 'true');
  assert.equal(target.hash, '#stock');
});

test('a failed bootstrap or script download offers retry immediately', () => {
  for (const failure of ['app-startup-failed', 'error']) {
    const app = openingApp();
    app.events.get(failure)({ target: { tagName: 'SCRIPT' } });
    assert.equal(app.retry.hidden, false);
    assert.equal(app.screen.isConnected, true);
  }
});

test('offline recovery explains the connection problem and updates when back online', () => {
  const app = openingApp({ online: false });
  app.expire();
  assert.match(app.message.textContent, /offline/);
  app.navigator.onLine = true;
  app.events.get('online')();
  assert.match(app.message.textContent, /try again/);
  assert.doesNotMatch(app.message.textContent, /offline/);
});

test('a successful first route removes the screen, cancels recovery and cleans only the bypass parameter', () => {
  const app = openingApp({ url: 'https://shop.example/admin/events?event=sargam&ngsw-bypass=true#stock' });
  assert.equal(app.replacedUrl, 'https://shop.example/admin/events?event=sargam#stock');
  app.events.get('app-startup-ready')();
  assert.equal(app.screen.isConnected, false);
  assert.equal(app.cleared, true);
  assert.equal(app.events.has('app-startup-failed'), false);
  assert.equal(app.replacedUrl, 'https://shop.example/admin/events?event=sargam#stock');
  app.expire();
  assert.equal(app.retry.hidden, true);
});

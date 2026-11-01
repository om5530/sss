import { test } from 'node:test';
import assert from 'node:assert/strict';
import { brandMark, brandTheme } from '../src/app/core/utils/saas-branding';
test('branding uses allowlisted palettes and a text-only bakery mark fallback', () => {
 for (const theme of ['gold', 'rose', 'sage']) assert.equal(brandTheme(theme), theme);
 for (const invalid of ['url(javascript:bad)', '#fff', undefined, {}, 'ROSE']) assert.equal(brandTheme(invalid), 'gold');
 assert.equal(brandMark('gb', 'Bakery'), 'GB'); assert.equal(brandMark('', 'The Golden Batch'), 'TG'); assert.equal(brandMark('<script>', 'Brand B'), 'BB'); assert.equal(brandMark('', ''), 'B'); assert.equal(brandMark('B2'), 'B2');
});

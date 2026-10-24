import { test } from 'node:test';
import assert from 'node:assert/strict';
import { groupRecipeRevisions, selectRecipeRevision } from '../src/app/pages/admin/bakery/recipes/recipe-revision-groups.ts';

const recipe = (id: string, fields: object = {}) => ({ _id: id, name: 'Biscoff', ...fields }) as any;

test('related revisions share one card while independent clones with the same name stay separate', () => {
  const root = recipe('a');
  const newer = recipe('b', { revisionFamilyId: 'a', revisionNumber: 2, piecesPerBatch: 9 });
  const groups = groupRecipeRevisions([newer, recipe('clone'), root]);
  assert.equal(groups.length, 2);
  const family = groups.find(g => g.id === 'a')!;
  assert.deepEqual(family.revisions.map(r => r._id), ['a', 'b']);
});

test('default shows mapped revision; explicit selection can preview another without altering mapping', () => {
  const root = recipe('a', { productId: 'product' });
  const newer = recipe('b', { revisionFamilyId: 'a', revisionNumber: 2 });
  const [family] = groupRecipeRevisions([newer, root]);
  assert.equal(selectRecipeRevision(family)._id, 'a');
  assert.equal(selectRecipeRevision(family, 'b')._id, 'b');
  assert.equal(root.productId, 'product');
  assert.equal(newer.productId, undefined);
});

test('archived roots and removed selections fall back to a remaining revision', () => {
  const [family] = groupRecipeRevisions([recipe('c', { revisionFamilyId: 'a', revisionNumber: 3 }), recipe('b', { revisionFamilyId: 'a', revisionNumber: 2 })]);
  assert.equal(family.id, 'a');
  assert.equal(selectRecipeRevision(family, 'removed')._id, 'c');
});

test('empty lists and legacy recipes work without revision metadata', () => {
  assert.deepEqual(groupRecipeRevisions([]), []);
  const [family] = groupRecipeRevisions([recipe('a')]);
  assert.equal(family.revisions.length, 1);
  assert.equal(selectRecipeRevision(family)._id, 'a');
});

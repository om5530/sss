import { test } from 'node:test';
import assert from 'node:assert/strict';
import { groupRecipeRevisions, searchRecipeGroups, selectRecipeRevision } from '../src/app/pages/admin/bakery/recipes/recipe-revision-groups.ts';

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

test('search is case insensitive, ignores excess whitespace and matches names, codes and revision labels', () => {
  const groups = groupRecipeRevisions([
    recipe('a', { name: 'Biscoff Cheesecake', category: 'Cakes', code: 'BIS-01' }),
    recipe('b', { name: 'Biscoff Cheesecake', revisionFamilyId: 'a', revisionLabel: 'Less sugar', revisionNumber: 2 }),
    recipe('c', { name: 'Brownie', category: 'Brownies' }),
  ]);
  for (const query of [' BIScoff ', 'bis-01', 'cakes', '  BISCOFF   less sugar ']) {
    const found = searchRecipeGroups(groups, query);
    assert.equal(found.length, 1);
    assert.equal(found[0].id, 'a');
    assert.equal(found[0].revisions.length, 2);
  }
  assert.equal(searchRecipeGroups(groups, '  '), groups);
  assert.equal(searchRecipeGroups(groups, 'tiramisu').length, 0);
});

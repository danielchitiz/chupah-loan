import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createStore } from '../store.js';

const action = overrides => ({ title: 'חולצה לזכר ירון', slug: 'shirts', description: 'הזמנת חולצה', destination: 'https://example.com/order', image: '', position: 2, visible: true, ...overrides });
function memory(t) { const store = createStore(':memory:'); t.after(() => store.db.close()); return store; }

test('initial initiatives include working destinations and no invented shirt link', t => {
  const store = memory(t);
  assert.equal(store.actionBySlug('chuppah').destination, '/chuppah');
  assert.equal(store.actions(true).length, 2);
  assert.equal(store.actionBySlug('shirts'), undefined);
});
test('initiative CRUD, visibility, drafts, and display order', t => {
  const store = memory(t);
  const saved = store.saveAction(action());
  assert.equal(store.actionBySlug('shirts').id, saved.id);
  store.saveAction({ visible: false }, saved.id);
  assert.equal(store.actionBySlug('shirts'), undefined);
  assert.equal(store.actions(true).some(row => row.id === saved.id), false);
  store.saveAction({ visible: true, title: 'חולצות', position: 0 }, saved.id);
  assert.equal(store.actions(true).find(row => row.id === saved.id).title, 'חולצות');
  assert.equal(store.actions(true).at(-1).slug, 'videos');
  const draft = store.saveAction(action({ slug: 'future', destination: '', visible: false }));
  assert.throws(() => store.saveAction({ visible: true }, draft.id));
  store.deleteAction(saved.id); assert.equal(store.actionBySlug('shirts'), undefined);
  assert.throws(() => store.saveAction({ title: 'חדש' }, saved.id), error => error.status === 404);
});
test('unsafe destinations, images, duplicate slugs, and invalid fields are rejected', t => {
  const store = memory(t);
  for (const destination of ['javascript:alert(1)', 'data:text/html,test', '//example.com', '/admin', 'https://user:password@example.com', 'https://example.com\r\nX-Test: bad']) {
    assert.throws(() => store.saveAction(action({ destination })));
  }
  for (const patch of [{ image: 'javascript:alert(1)' }, { slug: '../admin' }, { title: '' }, { position: -1 }, { visible: 'false' }]) assert.throws(() => store.saveAction(action(patch)));
  store.saveAction(action()); assert.throws(() => store.saveAction(action()), error => error.status === 409);
  assert.equal(store.saveAction(action({ slug: 'hebrew-link', destination: 'https://example.com/ירון' })).destination, 'https://example.com/%D7%99%D7%A8%D7%95%D7%9F');
});
test('actions migrate alongside bookings; edits and deletions survive reopening', t => {
  const dir = mkdtempSync(join(tmpdir(), 'chupah-actions-')); t.after(() => rmSync(dir, { recursive: true, force: true }));
  const path = join(dir, 'test.sqlite'); const first = createStore(path);
  const videos = first.actionBySlug('videos'); first.deleteAction(videos.id);
  first.saveAction(action({ visible: false, destination: '' })); first.db.close();
  const second = createStore(path); t.after(() => second.db.close());
  assert.equal(second.actionBySlug('videos'), undefined);
  assert.ok(second.actions().find(row => row.slug === 'shirts'));
  assert.equal(second.actions(true).length, 1);
});

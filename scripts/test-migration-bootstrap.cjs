const fs = require('node:fs');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const ts = require('typescript');
const exportsObject = {};
const source = ts.transpileModule(fs.readFileSync('src/lib/migration-bootstrap.ts', 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
vm.runInNewContext(source, {
  exports: exportsObject,
  require: () => ({ invoke: () => { throw new Error('Unexpected real IPC'); } }),
  Error,
});
const { initializeMigration } = exportsObject;
function storage(initial = {}) {
  const data = new Map(Object.entries(initial));
  return { data, getItem: key => data.has(key) ? data.get(key) : null,
    setItem: (key, value) => data.set(key, value), removeItem: key => data.delete(key) };
}
const seed = { id: 'synthetic-bundle', entries: { theme: 'dark', provider: '{"model":"synthetic"}' } };
function ipc(value = seed) {
  let completed = 0;
  return { call: async (command, args) => {
    if (command === 'get_migration_seed') return value;
    assert.equal(command, 'complete_migration_seed'); assert.equal(args.id, value.id); completed++;
  }, completed: () => completed };
}
(async () => {
  const target = storage(); const native = ipc();
  await initializeMigration(target, native.call);
  assert.equal(target.getItem('theme'), 'dark');
  assert.equal(target.getItem('provider'), seed.entries.provider);
  assert.equal(native.completed(), 1);
  target.setItem('theme', 'light');
  await initializeMigration(target, native.call);
  assert.equal(target.getItem('theme'), 'light', 'Repeating migration must not replace user edits');

  const existing = storage({ theme: 'system' }); const existingNative = ipc();
  await initializeMigration(existing, existingNative.call);
  assert.equal(existing.getItem('theme'), 'system'); assert.equal(existing.getItem('provider'), null);

  const interrupted = storage(); const normalSet = interrupted.setItem;
  interrupted.setItem = (key, value) => { if (key === 'provider') throw new Error('Simulated storage interruption'); normalSet(key, value); };
  await assert.rejects(initializeMigration(interrupted, ipc().call), /interruption/);
  assert.equal(interrupted.getItem('__pluely_migration_pending'), seed.id);
  interrupted.setItem = normalSet;
  interrupted.setItem('theme', 'locally-edited');
  await initializeMigration(interrupted, ipc().call);
  assert.equal(interrupted.getItem('theme'), 'locally-edited');
  assert.equal(interrupted.getItem('provider'), seed.entries.provider);

  const concurrent = storage(); const sharedNative = ipc();
  await Promise.all([initializeMigration(concurrent, sharedNative.call), initializeMigration(concurrent, sharedNative.call)]);
  assert.equal(concurrent.getItem('theme'), 'dark');
  assert.equal(concurrent.getItem('__pluely_migration_pending'), null);

  const noSeed = storage(); await initializeMigration(noSeed, ipc(null).call);
  assert.equal(noSeed.data.size, 0);
  const invalid = storage();
  await assert.rejects(initializeMigration(invalid, ipc({ id: 'invalid', entries: { setting: 42 } }).call), /配置格式/);
  assert.equal(invalid.data.size, 0);
  console.log('Migration bootstrap passed: fresh restore, existing data, repeat launch, interrupted import, concurrent windows and invalid data.');
})().catch(error => { console.error(error); process.exitCode = 1; });

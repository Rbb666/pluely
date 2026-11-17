// Verify the actual initialization callback without modifying Windows startup settings.
const fs = require('node:fs');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const ts = require('typescript');
const source = ts.createSourceFile('app.context.tsx', fs.readFileSync('src/contexts/app.context.tsx', 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
let callback;
function visit(node) {
  if (ts.isVariableDeclaration(node) && node.name.getText(source) === 'initializeAutostart') callback = node.initializer.getText(source);
  ts.forEachChild(node, visit);
}
visit(source);
assert.ok(callback);
const compiled = ts.transpileModule('globalThis.initialize = '+callback, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
async function run(saved, initialized, failure = false) {
  const actions = [];
  let marker = initialized ? 'true' : null;
  const context = vm.createContext({
    STORAGE_KEYS: { AUTOSTART_INITIALIZED: 'autostart_initialized' },
    safeLocalStorage: { getItem: () => marker, setItem: (_, value) => { marker = value; } },
    getCustomizableState: () => ({ autostart: { isEnabled: saved } }),
    // Deliberately different from the persisted preference, as on the first render.
    customizable: { autostart: { isEnabled: !saved } },
    enable: async () => { actions.push('enable'); if (failure) throw new Error('synthetic'); },
    disable: async () => { actions.push('disable'); if (failure) throw new Error('synthetic'); },
    console: { debug: () => {} },
  });
  vm.runInContext(compiled, context);
  await context.initialize();
  return { actions, marker };
}
(async () => {
  assert.deepEqual(await run(false, false), { actions: ['disable'], marker: 'true' });
  assert.deepEqual(await run(true, false), { actions: ['enable'], marker: 'true' });
  assert.deepEqual(await run(false, true), { actions: [], marker: 'true' });
  assert.deepEqual(await run(true, false, true), { actions: ['enable'], marker: null });
  console.log('Autostart preferences passed: restored values take precedence over initial React defaults, applied once, retryable on failure.');
})().catch(error => { console.error(error); process.exitCode = 1; });

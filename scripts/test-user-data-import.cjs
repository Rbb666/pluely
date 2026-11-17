// Tests use synthetic backup data and simulated IPC/Storage. No user files or keys are read.
const fs = require('node:fs');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const ts = require('typescript');
const transpile = file => ts.transpileModule(fs.readFileSync(file, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
}).outputText;
const constants = {};
vm.runInNewContext(transpile('src/config/constants.ts'), { exports: constants });
function loadApi(navigator) {
  const exports = {};
  vm.runInNewContext(transpile('src/lib/user-data-import.ts'), {
    exports, TextEncoder, Error, navigator,
    require(name) {
      if (name === '@/config/constants') return constants;
      if (name === '@tauri-apps/api/core') return { invoke() { throw Error('Real IPC is forbidden in this test'); } };
      throw Error(name);
    },
  });
  return exports;
}
const api = loadApi();
function storage(initial = {}) {
  const values = new Map(Object.entries(initial));
  return { values, get length() { return values.size; }, key: index => [...values.keys()][index] ?? null,
    getItem: key => values.has(key) ? values.get(key) : null,
    setItem: (key, value) => values.set(key, value), removeItem: key => values.delete(key) };
}
const backup = (override = {}) => JSON.stringify({
  format: 'pluely-backup', version: 1, createdAt: '2026-11-17T08:00:00+08:00',
  settings: { theme: 'dark', curl_selected_ai_provider: 'SYNTHETIC_PRIVATE_VALUE', customFutureSetting: 'restored', __pluely_fake: 'must-not-import' },
  databaseBase64: Buffer.from('synthetic database, never real user data').toString('base64'),
  databaseSha256: 'a'.repeat(64), secureStorage: null, ...override,
});
const pending = { id: 'import-test-1', entries: JSON.parse(backup()).settings };
function nativeImport(payload = pending) {
  const events = [];
  return { events, call: async (command, args) => {
    events.push(command);
    if (command === 'get_pending_user_data_settings') return payload;
    assert.equal(command, 'complete_user_data_import'); assert.equal(args.id, payload.id);
  } };
}

const successfulExport = {
  cancelled: false, path: 'C:\\backups\\synthetic.pluely-backup.json',
  settingsCount: 2, conversationsCount: 3, messagesCount: 8, promptsCount: 1,
};
function uiHarness({ restartFailure = false, exportOperation = async () => successfulExport } = {}) {
  const slots = [], effects = [], ipc = [];
  let index = 0, dirty = true, tree;
  const changed = (left, right) => !left || left.length !== right.length || left.some((value, i) => !Object.is(value, right[i]));
  const react = {
    useState(initial) { const i = index++; if (!slots[i]) slots[i] = { value: typeof initial === 'function' ? initial() : initial };
      return [slots[i].value, value => { const next = typeof value === 'function' ? value(slots[i].value) : value; if (!Object.is(next, slots[i].value)) { slots[i].value = next; dirty = true; } }]; },
    useRef(value) { return slots[index++] ||= { current: value }; },
    useEffect(fn, deps) { const i = index++; const old = slots[i]; if (changed(old?.deps, deps)) { slots[i] = { deps, cleanup: old?.cleanup }; effects.push(() => { slots[i].cleanup?.(); slots[i].cleanup = fn(); }); } },
  };
  const jsx = (type, props) => ({ type, props });
  const exports = {};
  const existing = storage({ theme: 'old', unrelated: 'preserve-in-native-backup', __pluely_existing: 'internal-marker' });
  let failRestart = restartFailure;
  const call = async (command, args) => {
    ipc.push({ command, args });
    if (command === 'export_user_data') return exportOperation();
    if (command === 'stage_user_data_import') return { id: 'staged-id', settingsCount: 3, requiresRestart: true };
    assert.equal(command, 'restart_after_user_data_import');
    if (failRestart) { failRestart = false; throw Error('SYNTHETIC_PRIVATE_ERROR'); }
  };
  const components = Object.fromEntries(['Button', 'Header', 'Dialog', 'DialogContent', 'DialogDescription', 'DialogFooter', 'DialogHeader', 'DialogTitle'].map(name => [name, name]));
  vm.runInNewContext(transpile('src/pages/settings/components/UserDataImport.tsx'), {
    exports, Error, DOMException,
    require(name) {
      if (name === 'react') return react;
      if (name === 'react/jsx-runtime') return { jsx, jsxs: jsx };
      if (name === '@/components') return components;
      if (name === 'lucide-react') return { FolderOpenIcon: 'icon', ImportIcon: 'icon', DownloadIcon: 'icon', Loader2: 'icon' };
      if (name === '@/lib/user-data-import') return { ...api,
        stageUserDataImport: json => api.stageUserDataImport(json, existing, call),
        exportUserData: () => api.exportUserData(existing, call),
        restartAfterUserDataImport: () => api.restartAfterUserDataImport(call) };
      throw Error(name);
    },
  });
  function all(node = tree) {
    if (!node || typeof node !== 'object') return [];
    const children = [node.props?.children].flat(5).filter(child => child && typeof child === 'object');
    return [node, ...children.flatMap(all)];
  }
  function text(node) {
    if (typeof node === 'string' || typeof node === 'number') return String(node);
    if (!node || typeof node !== 'object') return '';
    return [node.props?.children].flat(5).map(text).join(' ');
  }
  function flush() {
    let attempts = 0;
    while (dirty || effects.length) {
      if (++attempts > 40) throw Error('Unexpected render loop');
      if (dirty) { dirty = false; index = 0; tree = exports.UserDataImport(); }
      while (effects.length) effects.shift()();
    }
  }
  const settle = async () => { for (let i = 0; i < 12; i++) { await Promise.resolve(); flush(); } };
  flush();
  const select = file => all().find(node => node.type === 'input').props.onChange({ target: { files: [file], value: 'selected' } });
  const button = label => all().find(node => node.type === 'Button' && text(node).trim() === label);
  return { ipc, all, text: () => text(tree), flush, settle, select, button };
}

(async () => {
  const preview = api.inspectUserDataBackup(backup());
  assert.equal(preview.settingsCount, 3); assert.equal(Object.keys(preview).length, 2);
  for (const invalid of ['', '{}', 'not-json', backup({ version: 2 }), backup({ createdAt: 'invalid' }), backup({ settings: { x: 1 } }), backup({ databaseBase64: '' }), backup({ databaseSha256: 'bad' })]) {
    assert.throws(() => api.inspectUserDataBackup(invalid));
  }
  const destination = storage({ theme: 'light', transparency: '50', unrelated: 'keep', __pluely_existing: 'keep-internal' });
  await api.initializeUserDataImport(destination, nativeImport().call);
  assert.equal(destination.getItem('theme'), 'dark');
  assert.equal(destination.getItem('transparency'), null, 'Missing known keys must be cleared');
  assert.equal(destination.getItem('unrelated'), 'keep');
  assert.equal(destination.getItem('customFutureSetting'), 'restored');
  assert.equal(destination.getItem('__pluely_fake'), null);
  assert.equal(destination.getItem('__pluely_existing'), 'keep-internal');
  destination.setItem('theme', 'new-user-edit');
  await api.initializeUserDataImport(destination, nativeImport().call);
  assert.equal(destination.getItem('theme'), 'new-user-edit', 'Repeated completion must not reapply');

  const autostartPreference = '{"autostart":{"isEnabled":false}}';
  const legacyAutostart = { id: 'legacy-autostart-backup', entries: {
    customizable: autostartPreference, autostart_initialized: 'true',
  } };
  const otherComputer = storage({ customizable: '{"autostart":{"isEnabled":true}}', autostart_initialized: 'true' });
  await api.initializeUserDataImport(otherComputer, nativeImport(legacyAutostart).call);
  assert.equal(otherComputer.getItem('customizable'), autostartPreference, 'The user preference must survive import');
  assert.equal(otherComputer.getItem('autostart_initialized'), null, 'Legacy machine initialization flags must be cleared');
  otherComputer.setItem('autostart_initialized', 'true'); // AppProvider has applied the preference on this PC.
  await api.initializeUserDataImport(otherComputer, nativeImport(legacyAutostart).call);
  assert.equal(otherComputer.getItem('autostart_initialized'), 'true', 'A completed import must not reset the new machine flag');

  const interrupted = storage({ theme: 'old' }); const originalSet = interrupted.setItem;
  interrupted.setItem = (key, value) => { if (key === 'curl_selected_ai_provider') throw Error('quota'); originalSet(key, value); };
  const interruptedNative = nativeImport();
  await assert.rejects(api.initializeUserDataImport(interrupted, interruptedNative.call), /quota/);
  assert.equal(interruptedNative.events.includes('complete_user_data_import'), false);
  assert.equal(interrupted.getItem('__pluely_user_data_import_pending'), pending.id);
  interrupted.setItem = originalSet;
  await api.initializeUserDataImport(interrupted, nativeImport().call);
  assert.equal(interrupted.getItem('curl_selected_ai_provider'), pending.entries.curl_selected_ai_provider);
  assert.equal(interrupted.getItem('__pluely_user_data_import_pending'), null);

  const ackRetry = storage(); let acknowledgements = 0;
  const ackCall = async command => {
    if (command === 'get_pending_user_data_settings') return pending;
    if (++acknowledgements === 1) throw Error('ack interrupted');
  };
  await assert.rejects(api.initializeUserDataImport(ackRetry, ackCall), /ack interrupted/);
  ackRetry.setItem('theme', 'edited-after-apply');
  await api.initializeUserDataImport(ackRetry, ackCall);
  assert.equal(ackRetry.getItem('theme'), 'edited-after-apply');

  const concurrent = storage(); const concurrentNative = nativeImport();
  await Promise.all([api.initializeUserDataImport(concurrent, concurrentNative.call), api.initializeUserDataImport(concurrent, concurrentNative.call)]);
  assert.equal(concurrent.getItem('theme'), 'dark');
  const untouched = storage({ theme: 'keep' });
  await assert.rejects(api.initializeUserDataImport(untouched, nativeImport({ id: '', entries: {} }).call));
  assert.equal(untouched.values.size, 1);
  await api.initializeUserDataImport(untouched, nativeImport(null).call);
  assert.equal(untouched.getItem('theme'), 'keep');

  let lockTail = Promise.resolve(), lockCalls = 0;
  const lockedApi = loadApi({ locks: { request(name, work) {
    assert.equal(name, 'pluely-user-data-import'); lockCalls++;
    const run = lockTail.then(work); lockTail = run.catch(() => {}); return run;
  } } });
  const locked = storage();
  await Promise.all([lockedApi.initializeUserDataImport(locked, nativeImport().call), lockedApi.initializeUserDataImport(locked, nativeImport().call)]);
  assert.equal(lockCalls, 2); assert.equal(locked.getItem('theme'), 'dark');

  await assert.rejects(api.stageUserDataImport(backup(), storage(), async () => { throw Error('SYNTHETIC_PRIVATE_ERROR'); }), error => !error.message.includes('SYNTHETIC_PRIVATE_ERROR'));
  const ui = uiHarness({ restartFailure: true });
  ui.select({ name: 'backup.json', size: Buffer.byteLength(backup()), text: async () => backup() });
  await ui.settle();
  assert.equal(ui.ipc.length, 0, 'Selecting a file must not stage or restart');
  assert.ok(ui.text().includes('backup.json'));
  assert.equal(ui.text().includes('SYNTHETIC_PRIVATE_VALUE'), false, 'Preview must not show settings values');
  ui.button('导入用户数据').props.onClick(); ui.flush();
  assert.equal(ui.all().find(node => node.type === 'Dialog').props.open, true);
  const confirm = ui.button('确认导入并重启');
  confirm.props.onClick(); confirm.props.onClick();
  await ui.settle();
  assert.equal(ui.ipc.filter(event => event.command === 'stage_user_data_import').length, 1, 'Double clicks must not stage twice');
  assert.deepEqual(ui.ipc.map(event => event.command), ['stage_user_data_import', 'restart_after_user_data_import']);
  assert.equal(JSON.parse(ui.ipc[0].args.existingSettingsJson).unrelated, 'preserve-in-native-backup');
  assert.equal(ui.text().includes('SYNTHETIC_PRIVATE_ERROR'), false);
  ui.button('重试重启').props.onClick(); await ui.settle();
  assert.equal(ui.ipc.filter(event => event.command === 'stage_user_data_import').length, 1);
  assert.equal(ui.ipc.filter(event => event.command === 'restart_after_user_data_import').length, 2);
  assert.equal(ui.button('导出用户数据').props.disabled, true, 'A staged import must block exporting');
  ui.button('导出用户数据').props.onClick(); await ui.settle();
  assert.equal(ui.ipc.some(event => event.command === 'export_user_data'), false);

  const tooLarge = uiHarness(); let readLarge = false;
  tooLarge.select({ name: 'oversize.json', size: api.MAX_USER_DATA_IMPORT_BYTES + 1, text: async () => { readLarge = true; return ''; } });
  await tooLarge.settle(); assert.equal(readLarge, false); assert.equal(tooLarge.ipc.length, 0);

  // Export carries the settings needed for migration without internal task markers.
  const exportSettings = storage({
    system_prompt: 'synthetic system prompt', customizable: '{"alwaysOnTop":true}',
    curl_selected_ai_provider: '{"variables":{"api_key":"SYNTHETIC_API_KEY"}}',
    autostart_initialized: 'true',
    __pluely_user_data_import_applied: 'internal-id',
  });
  let exportedSettings;
  const exported = await api.exportUserData(exportSettings, async (command, args) => {
    assert.equal(command, 'export_user_data');
    exportedSettings = JSON.parse(args.settingsJson);
    return { ...successfulExport, privatePayload: 'SYNTHETIC_PRIVATE_VALUE' };
  });
  assert.equal(exportedSettings.system_prompt, 'synthetic system prompt');
  assert.equal(exportedSettings.customizable, '{"alwaysOnTop":true}');
  assert.equal(JSON.parse(exportedSettings.curl_selected_ai_provider).variables.api_key, 'SYNTHETIC_API_KEY');
  assert.equal(exportedSettings.__pluely_user_data_import_applied, undefined);
  assert.equal(exportedSettings.autostart_initialized, undefined, 'Export must omit machine initialization state');
  assert.equal(Object.keys(exported).length, 6, 'Export helper must return only safe metadata');
  assert.equal(JSON.stringify(exported).includes('SYNTHETIC_PRIVATE_VALUE'), false);
  const cancelled = await api.exportUserData(exportSettings, async () => ({ cancelled: true, path: 'must-not-display' }));
  assert.deepEqual(JSON.parse(JSON.stringify(cancelled)), { cancelled: true });
  for (const result of [null, {}, { cancelled: false }, { ...successfulExport, path: '' }, { ...successfulExport, messagesCount: -1 }, { ...successfulExport, settingsCount: 1.5 }]) {
    await assert.rejects(api.exportUserData(exportSettings, async () => result), /确认导出结果/);
  }
  await assert.rejects(api.exportUserData(exportSettings, async () => { throw Error('SYNTHETIC_PRIVATE_ERROR'); }), cause => !cause.message.includes('SYNTHETIC_PRIVATE_ERROR'));

  let finishExport;
  const exporting = uiHarness({ exportOperation: () => new Promise(resolve => { finishExport = resolve; }) });
  const exportButton = exporting.button('导出用户数据');
  exportButton.props.onClick(); exportButton.props.onClick(); exporting.flush();
  assert.equal(exporting.ipc.filter(event => event.command === 'export_user_data').length, 1, 'Rapid double clicks must open only one native dialog');
  assert.equal(exporting.button('选择备份文件').props.disabled, true);
  exporting.select({ name: 'backup.json', size: Buffer.byteLength(backup()), text: async () => { throw Error('Import must not read during export'); } });
  await exporting.settle(); assert.equal(exporting.ipc.length, 1);
  finishExport(successfulExport); await exporting.settle();
  assert.ok(exporting.text().includes('用户数据已导出'));
  assert.ok(exporting.text().includes(successfulExport.path));
  assert.equal(exporting.text().includes('internal-marker'), false);
  assert.equal(exporting.button('导出用户数据').props.disabled, false);

  let exportedOnce = false;
  const cancelUi = uiHarness({ exportOperation: async () => {
    if (!exportedOnce) { exportedOnce = true; return successfulExport; }
    return { cancelled: true };
  } });
  cancelUi.button('导出用户数据').props.onClick(); await cancelUi.settle();
  assert.ok(cancelUi.text().includes('用户数据已导出'));
  cancelUi.button('导出用户数据').props.onClick(); await cancelUi.settle();
  assert.equal(cancelUi.text().includes('用户数据已导出'), false, 'Cancelling a later export must not leave an old success notice');
  assert.equal(cancelUi.button('导出用户数据').props.disabled, false);
  const exportFailure = uiHarness({ exportOperation: async () => { throw Error('SYNTHETIC_PRIVATE_ERROR'); } });
  exportFailure.button('导出用户数据').props.onClick(); await exportFailure.settle();
  assert.ok(exportFailure.text().includes('导出失败'));
  assert.equal(exportFailure.text().includes('SYNTHETIC_PRIVATE_ERROR'), false);
  assert.equal(exportFailure.button('导出用户数据').props.disabled, false);

  let finishReading;
  const readingUi = uiHarness();
  readingUi.select({ name: 'backup.json', size: Buffer.byteLength(backup()), text: () => new Promise(resolve => { finishReading = resolve; }) });
  readingUi.flush();
  assert.equal(readingUi.button('导出用户数据').props.disabled, true);
  readingUi.button('导出用户数据').props.onClick(); await readingUi.settle();
  assert.equal(readingUi.ipc.length, 0);
  finishReading(backup()); await readingUi.settle();
  readingUi.button('导入用户数据').props.onClick(); readingUi.flush();
  assert.equal(readingUi.button('导出用户数据').props.disabled, true);
  readingUi.button('导出用户数据').props.onClick(); await readingUi.settle();
  assert.equal(readingUi.ipc.length, 0, 'Open import confirmation must block export');
  console.log('User data import/export passed: metadata-only UI, native-save cancellation, sensitive-data filtering, operation exclusion, explicit restore confirmation, resumable bootstrap and restart retry.');
})().catch(error => { console.error(error); process.exitCode = 1; });

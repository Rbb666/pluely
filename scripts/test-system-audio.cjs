// Run with: node scripts/test-system-audio.cjs
// Execute the real hook with simulated native events and deferred provider lookup.
// No audio device is opened and no ASR or LLM request leaves this process.
const fs = require('node:fs');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const ts = require('typescript');

const deferred = () => {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
};
const flush = async () => { for (let i = 0; i < 20; i++) await Promise.resolve(); };
const code = ts.transpileModule(fs.readFileSync('src/hooks/useSystemAudio.ts', 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;

function harness() {
  const slots = [];
  const listeners = new Map();
  const sttCalls = [];
  const aiCalls = [];
  const saves = [];
  const pendingSaves = new Map();
  const lookup = deferred();
  let cursor = 0;
  let conversationId = 0;
  let replyGate;
  let pendingEffects = [];
  let hook;
  const sameDeps = (left, right) => left && right && left.length === right.length &&
    left.every((value, index) => Object.is(value, right[index]));
  const react = {
    useState(initial) {
      const index = cursor++;
      if (!(index in slots)) slots[index] = typeof initial === 'function' ? initial() : initial;
      return [slots[index], (next) => {
        slots[index] = typeof next === 'function' ? next(slots[index]) : next;
      }];
    },
    useRef(initial) {
      const index = cursor++;
      return slots[index] || (slots[index] = { current: initial });
    },
    useCallback(callback, dependencies) {
      const index = cursor++;
      if (!sameDeps(slots[index]?.dependencies, dependencies)) {
        slots[index] = { callback, dependencies };
      }
      return slots[index].callback;
    },
    useEffect(effect, dependencies) {
      const index = cursor++;
      if (!sameDeps(slots[index]?.dependencies, dependencies)) {
        pendingEffects.push(() => {
          slots[index]?.cleanup?.();
          slots[index] = { dependencies, cleanup: effect() };
        });
      }
    },
  };
  const app = {
    selectedSttProvider: { provider: 'asr', variables: {} }, allSttProviders: [{ id: 'asr' }],
    selectedAIProvider: { provider: 'llm', variables: {} }, allAiProviders: [{ id: 'llm' }],
    selectedAudioDevices: { output: { id: 'default' } }, systemPrompt: '',
  };
  const shortcuts = { registerSystemAudioCallback() {} };
  const resizeWindow = () => {};
  const exports = {};
  vm.runInNewContext(code, {
    exports, Blob, Uint8Array, AbortController, atob,
    setTimeout(callback, delay) {
      if (delay !== 500) return setTimeout(callback, delay);
      const id = Symbol('save');
      pendingSaves.set(id, callback);
      return id;
    },
    clearTimeout(id) {
      if (typeof id === 'symbol') pendingSaves.delete(id);
      else clearTimeout(id);
    },
    console: { log() {}, error() {}, warn() {} },
    window: { addEventListener() {}, removeEventListener() {} },
    require(name) {
      if (name === 'react') return react;
      if (name === '.') return { useWindowResize: () => ({ resizeWindow }), useGlobalShortcuts: () => shortcuts };
      if (name === '@tauri-apps/api/core') return { invoke: async (command) => command === 'check_system_audio_access' ? true : undefined };
      if (name === '@tauri-apps/api/event') return { listen: async (name, callback) => {
        const callbacks = listeners.get(name) || new Set();
        callbacks.add(callback);
        listeners.set(name, callbacks);
        return () => callbacks.delete(callback);
      } };
      if (name === '@/contexts') return { useApp: () => app };
      if (name === '@/config') return { DEFAULT_QUICK_ACTIONS: [], DEFAULT_SYSTEM_PROMPT: '', STORAGE_KEYS: {} };
      if (name === '@/lib/functions') return {
        fetchSTT: async (args) => { sttCalls.push(args); return 'recognized speech'; },
        fetchAIResponse: async function* (args) {
          aiCalls.push(args);
          yield 'reply';
          await replyGate?.promise;
        },
      };
      if (name === '@/lib') return {
        safeLocalStorage: { getItem: () => null, setItem() {} },
        shouldUsePluelyAPI: () => lookup.promise,
        generateConversationTitle: (text) => text,
        createConversation: async ({ id }) => { saves.push(['create', id]); },
        updateConversation: async ({ id }) => { saves.push(['update', id]); },
        CONVERSATION_SAVE_DEBOUNCE_MS: 500,
        generateConversationId: () => `test-conversation-${++conversationId}`, generateMessageId: () => 'test-message',
      };
      throw new Error(`Unexpected module: ${name}`);
    },
  });
  const render = () => {
    cursor = 0;
    pendingEffects = [];
    hook = exports.useSystemAudio();
    for (const effect of pendingEffects) effect();
    return hook;
  };
  const start = async () => { await hook.startCapture(); render(); await flush(); };
  const stop = async () => { await hook.stopCapture(); render(); await flush(); };
  const speak = () => {
    const callbacks = [...(listeners.get('speech-detected') || [])];
    assert.equal(callbacks.length, 1, 'one speech handler must be registered');
    return callbacks[0]({ payload: Buffer.from('synthetic audio').toString('base64') });
  };
  const unmount = () => { for (const value of slots) value?.cleanup?.(); };
  const save = async () => {
    const callbacks = [...pendingSaves.values()];
    pendingSaves.clear();
    for (const callback of callbacks) await callback();
  };
  const remove = (id) => {
    for (const listener of listeners.get('conversations-deleted') ?? []) listener({ payload: [id] });
  };
  const holdReply = () => { replyGate = deferred(); return replyGate.resolve; };
  render();
  return { lookup, sttCalls, aiCalls, render, start, stop, speak, unmount, saves, save, remove, holdReply };
}

(async () => {
  const active = harness();
  await flush();
  await active.start();
  active.lookup.resolve(false);
  await active.speak();
  assert.equal(active.sttCalls.length, 1, 'an active utterance must reach ASR');
  assert.equal(active.aiCalls.length, 1, 'an active transcription must reach the LLM');
  active.unmount();

  const stopped = harness();
  await flush();
  await stopped.start();
  const staleSpeech = stopped.speak();
  await flush();
  assert.equal(stopped.sttCalls.length, 0, 'provider lookup is still pending');
  await stopped.stop();
  stopped.lookup.resolve(false);
  await staleSpeech;
  assert.equal(stopped.sttCalls.length, 0, 'stopping during provider lookup must not send cancelled audio to ASR');
  assert.equal(stopped.aiCalls.length, 0);
  stopped.unmount();

  const restarted = harness();
  await flush();
  await restarted.start();
  const previousSession = restarted.speak();
  await restarted.stop();
  await restarted.start();
  restarted.lookup.resolve(false);
  await previousSession;
  assert.equal(restarted.sttCalls.length, 0, 'restarting must not revive an utterance from the previous session');
  await restarted.speak();
  assert.equal(restarted.sttCalls.length, 1, 'the new session must still accept speech');
  assert.equal(restarted.aiCalls.length, 1);
  restarted.unmount();

  const deleted = harness();
  await flush();
  await deleted.start();
  deleted.lookup.resolve(false);
  await deleted.speak();
  const old = deleted.render().conversation.id;
  await flush();
  await deleted.save();
  assert.deepEqual(deleted.saves, [['create', old]]);
  await deleted.speak();
  deleted.render();
  await flush();
  await deleted.save();
  assert.deepEqual(deleted.saves, [['create', old], ['update', old]]);
  await deleted.speak();
  deleted.render();
  await flush();

  const finishReply = deleted.holdReply();
  const reply = deleted.speak();
  await flush();
  const activeRequest = deleted.aiCalls.at(-1);
  assert.equal(deleted.aiCalls.length, 4);
  deleted.remove(old);
  assert.equal(activeRequest.signal.aborted, true);
  await deleted.save();
  finishReply();
  await reply;
  const fresh = deleted.render().conversation;
  assert.notEqual(fresh.id, old);
  assert.equal(fresh.messages.length, 0);
  assert.deepEqual(deleted.saves, [['create', old], ['update', old]]);
  deleted.unmount();

  console.log('System audio checks passed: cancellation and deletion during an active reply.');
})().catch((error) => { console.error(error); process.exitCode = 1; });

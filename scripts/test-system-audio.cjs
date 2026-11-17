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
  const lookup = deferred();
  let cursor = 0;
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
    exports, Blob, Uint8Array, AbortController, atob, setTimeout, clearTimeout,
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
        fetchAIResponse: async function* (args) { aiCalls.push(args); yield 'reply'; },
      };
      if (name === '@/lib') return {
        safeLocalStorage: { getItem: () => null, setItem() {} },
        shouldUsePluelyAPI: () => lookup.promise,
        generateConversationTitle: (text) => text, saveConversation: async () => {},
        CONVERSATION_SAVE_DEBOUNCE_MS: 500,
        generateConversationId: () => 'test-conversation', generateMessageId: () => 'test-message',
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
  render();
  return { lookup, sttCalls, aiCalls, render, start, stop, speak, unmount };
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

  console.log('System audio cancellation passed: active speech, stop during provider lookup, stale session after restart.');
})().catch((error) => { console.error(error); process.exitCode = 1; });

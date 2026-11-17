/**
 * Local Pinyin candidates backed by the Apache-2.0 Android PinyinIME dictionary.
 * Source/version and transformation are recorded in third_party/pinyin/README.md.
 * This adapter never sends input to a network service.
 */
export interface PinyinCandidate {
  text: string;
  /** Number of original input characters consumed, including separator marks. */
  consumed: number;
}

interface Entry {
  text: string;
  frequency: number;
  boundaries: Set<number>;
}

interface DictionaryIndex {
  full: Map<string, Entry[]>;
  abbreviations: Map<string, Entry[]>;
  keys: string[];
  maxKeyLength: number;
}

interface NormalizedInput {
  key: string;
  rawEnds: number[];
  boundaries: Set<number>;
}

let dictionaryPromise: Promise<DictionaryIndex> | undefined;

function loadDictionary(): Promise<DictionaryIndex> {
  if (!dictionaryPromise) {
    dictionaryPromise = import("../assets/pinyin-dictionary.json").then(({ default: data }) => {
      const full = new Map<string, Entry[]>();
      const abbreviations = new Map<string, Entry[]>();
      let maxKeyLength = 0;
      for (const [spelling, text, frequency] of data.entries as [string, string, number][]) {
        const syllables = spelling.split(" ");
        const key = syllables.join("");
        let offset = 0;
        const boundaries = new Set<number>();
        for (const syllable of syllables) {
          offset += syllable.length;
          boundaries.add(offset);
        }
        const entry = { text, frequency, boundaries };
        const list = full.get(key) || [];
        list.push(entry);
        full.set(key, list);
        maxKeyLength = Math.max(maxKeyLength, key.length);
        if (syllables.length > 1) {
          const abbreviation = syllables.map((syllable) => syllable[0]).join("");
          const shortList = abbreviations.get(abbreviation) || [];
          shortList.push(entry);
          abbreviations.set(abbreviation, shortList);
        }
      }
      return { full, abbreviations, keys: [...full.keys()].sort(), maxKeyLength };
    }).catch((error) => {
      dictionaryPromise = undefined;
      throw error;
    });
  }
  return dictionaryPromise;
}

function normalizeInput(input: string): NormalizedInput | undefined {
  if (!input || input.length > 256) return undefined;
  let key = "";
  const rawEnds: number[] = [];
  const boundaries = new Set<number>();
  for (let i = 0; i < input.length; i += 1) {
    let character = input[i].toLowerCase();
    if (/[\s'’]/.test(character)) {
      if (key.length) boundaries.add(key.length);
      continue;
    }
    if (character === "ü") character = "v";
    if (character === "u" && input[i + 1] === ":") { character = "v"; i += 1; }
    if (!/^[a-z]$/.test(character)) return undefined;
    key += character;
    rawEnds.push(i + 1);
  }
  return key ? { key, rawEnds, boundaries } : undefined;
}

function lowerBound(keys: string[], needle: string): number {
  let low = 0;
  let high = keys.length;
  while (low < high) {
    const middle = (low + high) >>> 1;
    if (keys[middle] < needle) low = middle + 1;
    else high = middle;
  }
  return low;
}

/**
 * Full Pinyin, initials and unfinished-syllable candidates. If a whole string
 * has no dictionary entry, a leading word can be selected and the UI continues
 * converting the unconsumed suffix, e.g. nihaozhongwen -> 你好 + zhongwen.
 */
export async function queryPinyin(input: string): Promise<PinyinCandidate[]> {
  const normalized = normalizeInput(input);
  if (!normalized) return [];
  const index = await loadDictionary();
  const { key, rawEnds, boundaries } = normalized;
  const candidates: (PinyinCandidate & { rank: number; frequency: number })[] = [];

  const append = (entries: Entry[] | undefined, count: number, rank: number, abbreviation = false) => {
    if (!entries) return;
    let consumed = rawEnds[count - 1];
    while (consumed < input.length && /[\s'’]/.test(input[consumed])) consumed += 1;
    for (const entry of entries) {
      // An apostrophe/space explicitly separates syllables: xi'an must not become 先.
      if (!abbreviation && [...boundaries].some((boundary) => boundary <= count && !entry.boundaries.has(boundary))) continue;
      candidates.push({ text: entry.text, consumed, rank, frequency: entry.frequency });
    }
  };

  append(index.full.get(key), key.length, 0);
  if (key.length > 1 && boundaries.size === 0) append(index.abbreviations.get(key), key.length, 1, true);

  // Complete an unfinished Pinyin prefix locally, following the upstream engine's behavior.
  for (let i = lowerBound(index.keys, key); i < index.keys.length && index.keys[i].startsWith(key); i += 1) {
    if (index.keys[i] !== key) append(index.full.get(index.keys[i]), key.length, 2);
  }

  // Provide partial-word consumption for strings that span more than one phrase.
  for (let count = Math.min(key.length - 1, index.maxKeyLength); count > 0; count -= 1) {
    append(index.full.get(key.slice(0, count)), count, 3);
  }

  candidates.sort((a, b) => a.rank - b.rank || (a.rank === 3 ? b.consumed - a.consumed : 0) || b.frequency - a.frequency);
  const seen = new Set<string>();
  const result: PinyinCandidate[] = [];
  for (const { text, consumed } of candidates) {
    const id = `${text}\0${consumed}`;
    if (seen.has(id)) continue;
    seen.add(id);
    result.push({ text, consumed });
    if (result.length >= 60) break;
  }
  return result;
}

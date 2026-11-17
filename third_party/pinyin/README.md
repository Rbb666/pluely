# Offline Pinyin dictionary

The source dictionary is vendored from
[dongyuwei/web-pinyin-ime](https://github.com/dongyuwei/web-pinyin-ime/tree/ee505cf7bab43cf70dcc2540579027aea432f28a),
commit `ee505cf7bab43cf70dcc2540579027aea432f28a`.

Source path: `ime/src/script/google_pinyin_rawdict_utf8_65105_freq.txt`.
SHA-256: `aaf694bb2dde77678ecabe9ca80059caefb71b89b94656a0541b96a615a52ef6`.

The data originates in Android's open-source PinyinIME dictionary, copyright
2009 The Android Open Source Project, licensed under Apache-2.0. The original
`NOTICE` and the upstream `lisence.txt` (stored as `LICENSE`) are retained here
and are also bundled under `public/licenses/pinyin/`.

Pluely's transformation selects the 55,320 simplified-Chinese rows (flag `0`),
keeps syllable boundaries, words and frequency, and serializes them as JSON.
The generated file is `src/assets/pinyin-dictionary.json`. Reproduce it offline:

```powershell
rtk proxy node scripts/prepare-pinyin-dictionary.cjs
```

The query adapter is new Pluely code. It does not include the upstream React UI,
Lodash or packed-trie implementation. Candidate lookup never sends typed text
to a service; the JSON dictionary is a local, lazily loaded application asset.

"""Wrap the previously verified local snapshot into a private import file."""
import argparse
import base64
import hashlib
import json
import sqlite3
from pathlib import Path

parser = argparse.ArgumentParser()
parser.add_argument('--source', type=Path, default=Path('.local-tools/migration-private/current'))
parser.add_argument('--output', type=Path, required=True)
args = parser.parse_args()
source = args.source.resolve(strict=True)
manifest = json.loads((source / 'manifest.json').read_text(encoding='utf-8-sig'))
settings_bytes = (source / 'settings.json').read_bytes()
database_bytes = (source / 'pluely.db').read_bytes()
settings = json.loads(settings_bytes)
assert isinstance(settings, dict) and all(isinstance(k, str) and isinstance(v, str) for k, v in settings.items())
for filename, content in [('settings.json', settings_bytes), ('pluely.db', database_bytes)]:
    assert hashlib.sha256(content).hexdigest() == manifest['files'][filename]['sha256'], 'Snapshot checksum mismatch'
with sqlite3.connect((source / 'pluely.db').as_uri()+'?mode=ro&immutable=1', uri=True) as connection:
    assert connection.execute('PRAGMA integrity_check').fetchone()[0] == 'ok'
backup = {
    'format': 'pluely-backup', 'version': 1, 'createdAt': manifest['createdAt'],
    'settings': {k: v for k, v in settings.items() if not k.startswith('__pluely_')},
    'databaseBase64': base64.b64encode(database_bytes).decode('ascii'),
    'databaseSha256': hashlib.sha256(database_bytes).hexdigest(),
    'secureStorage': None,
}
secure = source / 'secure_storage.json'
if secure.exists():
    backup['secureStorage'] = json.loads(secure.read_text(encoding='utf-8'))
args.output.parent.mkdir(parents=True, exist_ok=True)
encoded = json.dumps(backup, ensure_ascii=False, separators=(',', ':')).encode('utf-8')
with args.output.open('xb') as output:
    output.write(encoded)
Path(str(args.output)+'.sha256').write_text(hashlib.sha256(encoded).hexdigest()+'  '+args.output.name+'\n', encoding='utf-8')
print(f'Created private import file: {args.output.resolve()} ({len(encoded)} bytes; {len(backup["settings"])} settings).')

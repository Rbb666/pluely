"""Stage the official Fixed Version runtime under Tauri's relative runtime/ path."""
import argparse
import hashlib
import os
import shutil
from pathlib import Path

parser = argparse.ArgumentParser()
parser.add_argument('source', type=Path)
parser.add_argument('--destination', type=Path)
parser.add_argument('--copy', action='store_true', help='Copy independent files instead of hard-linking')
args = parser.parse_args()
root = Path(__file__).resolve().parent.parent
source = args.source.resolve(strict=True)
destination = (args.destination or (root / 'src-tauri' / 'runtime')).resolve()
if not destination.is_relative_to(root):
    raise RuntimeError('Runtime staging must remain inside this workspace')
assert (source / 'msedgewebview2.exe').is_file(), 'The source must be an extracted Fixed Runtime'
destination.mkdir(parents=True, exist_ok=True)
source_files = sorted(path for path in source.rglob('*') if path.is_file())
expected = {path.relative_to(source).as_posix().lower() for path in source_files}
existing = {path.relative_to(destination).as_posix().lower() for path in destination.rglob('*') if path.is_file()}
if existing - expected:
    raise RuntimeError('Staging contains unrelated files; refusing to remove or mix runtimes')
def digest(path):
    with path.open('rb') as stream:
        return hashlib.file_digest(stream, 'sha256').digest()
for path in source_files:
    if path.is_symlink():
        raise RuntimeError('Runtime symlinks are not supported')
    target = destination / path.relative_to(source)
    target.parent.mkdir(parents=True, exist_ok=True)
    if target.exists():
        if target.stat().st_size != path.stat().st_size or digest(target) != digest(path):
            raise RuntimeError('A different runtime is already staged; refusing to overwrite it')
        continue
    try:
        if args.copy:
            shutil.copy2(path, target)
        else:
            os.link(path, target)
    except OSError:
        shutil.copy2(path, target)
print(f'Staged complete Fixed Runtime: {len(source_files)} files, {sum(p.stat().st_size for p in source_files)} bytes.')

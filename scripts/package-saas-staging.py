"""Create a secret-free deployment source bundle, never the legacy app entry."""
import base64
import hashlib
import json
from pathlib import Path
import shutil
import sys

root = Path(__file__).resolve().parents[1]
build = Path(sys.argv[1]).resolve() / 'browser'
output = Path(sys.argv[2]).resolve()
if output == root or root in output.parents or not (build / 'index.html').is_file():
    raise SystemExit('Use a completed staging build and an output folder outside the repository')
if output.exists() and any(output.iterdir()):
    raise SystemExit('Use a fresh output folder to avoid stale deployment files')
output.mkdir(parents=True, exist_ok=True)
for relative in ['server/src', 'server/package.json', 'server/package-lock.json', 'api/saas-staging.js']:
    source, destination = root / relative, output / relative
    if source.is_dir():
        shutil.copytree(source, destination, dirs_exist_ok=True)
    else:
        destination.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(source, destination)
package = json.loads((root / 'server/package.json').read_text())
package.pop('main', None)
package['scripts'] = {}
package['private'] = True
package['engines'] = {'node': '22.x'}
(output / 'package.json').write_text(json.dumps(package, indent=2) + '\n')
shutil.copyfile(root / 'server/package-lock.json', output / 'package-lock.json')
shutil.copytree(build, output / 'public', dirs_exist_ok=True)
config = {'framework': None, 'regions': ['bom1'], 'installCommand': 'npm ci --omit=dev',
          'buildCommand': '', 'outputDirectory': 'public',
          'functions': {'api/saas-staging.js': {'maxDuration': 60}},
          'routes': [{'src': '/.*', 'headers': {'X-Robots-Tag': 'noindex, nofollow'}, 'continue': True},
                     {'src': '/api/.*', 'dest': '/api/saas-staging'}, {'handle': 'filesystem'},
                     {'src': '/.*', 'dest': '/index.html'}]}
(output / 'vercel.json').write_text(json.dumps(config, indent=2) + '\n')
files = []
for path in sorted(output.rglob('*')):
    if not path.is_file():
        continue
    relative = path.relative_to(output).as_posix()
    if any(part.startswith('.') or part == 'node_modules' for part in path.relative_to(output).parts):
        raise SystemExit('Unexpected private file in bundle')
    content = path.read_bytes()
    files.append({'file': relative, 'data': base64.b64encode(content).decode(), 'encoding': 'base64'})
manifest = output.parent / (output.name + '-files.json')
manifest.write_text(json.dumps(files, separators=(',', ':')))
print(json.dumps({'files': len(files), 'manifest': str(manifest), 'sha256': hashlib.sha256(manifest.read_bytes()).hexdigest(), 'bytes': manifest.stat().st_size}))

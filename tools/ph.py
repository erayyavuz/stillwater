# Download Poly Haven CC0 assets. usage: ph.py model <id>... | ph.py tex <id> <res>
import json, urllib.request, os, sys
H = {'User-Agent': 'stillwater-build/1.0 (+https://github.com/erayyavuz/stillwater)'}
def req(u): return urllib.request.urlopen(urllib.request.Request(u, headers=H))
def get(u): return json.load(req(u))
def save(u, p):
    os.makedirs(os.path.dirname(p) or '.', exist_ok=True)
    open(p, 'wb').write(req(u).read())
kind = sys.argv[1]
if kind == 'model':
    for mid in sys.argv[2:]:
        g = get(f'https://api.polyhaven.com/files/{mid}')['gltf']['1k']['gltf']
        d = f'models/{mid}'
        save(g['url'], f'{d}/{mid}.gltf')
        for path, inc in g.get('include', {}).items(): save(inc['url'], f'{d}/{path}')
        print(mid, 'ok')
else:
    tid, res = sys.argv[2], sys.argv[3]
    f = get(f'https://api.polyhaven.com/files/{tid}')
    for m in ['Diffuse', 'nor_gl', 'Rough', 'AO', 'arm']:
        if m in f and res in f[m]:
            fmt = 'jpg' if 'jpg' in f[m][res] else 'png'
            save(f[m][res][fmt]['url'], f'tex/{tid}/{m}.{fmt}')
    print(tid, 'ok', [m for m in ['Diffuse','nor_gl','Rough','AO','arm'] if m in f])

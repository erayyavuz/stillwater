# usage: python3 gen.py <in.png> <out.png> "<prompt>"   — nano-banana edit, logs spend to ledger.txt
import sys, json, os, urllib.request, fal_client
assert os.environ.get('FAL_KEY'), 'set FAL_KEY'
LEDGER = os.path.join(os.path.dirname(__file__), 'ledger.txt')
CAP = 1.00
spent = sum(float(l.split()[0]) for l in open(LEDGER)) if os.path.exists(LEDGER) else 0
if spent + 0.0398 > CAP - 0.05: sys.exit(f'budget stop: spent {spent:.3f}')
src, out, prompt = sys.argv[1:4]
url = fal_client.upload_file(src)
r = fal_client.subscribe('fal-ai/nano-banana/edit', arguments={'prompt': prompt, 'image_urls': [url], 'num_images': 1, 'output_format': 'png'})
with open(LEDGER, 'a') as f: f.write(f'0.0398 nano-banana/edit {out}\n')
img = r['images'][0]['url']
urllib.request.urlretrieve(img, out)
print(out, r['images'][0].get('width'), r['images'][0].get('height'), f'total spent {spent+0.0398:.3f}')

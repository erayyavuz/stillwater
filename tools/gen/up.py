import sys, os, urllib.request, fal_client, json
assert os.environ.get('FAL_KEY'), 'set FAL_KEY'
src, out = sys.argv[1:3]
url = fal_client.upload_file(src)
r = fal_client.subscribe('fal-ai/seedvr/upscale/image', arguments={'image_url': url, 'upscale_factor': 2})
img = r['image']
urllib.request.urlretrieve(img['url'], out)
with open(os.path.join(os.path.dirname(__file__), 'ledger.txt'), 'a') as f: f.write(f'0.0045 seedvr {out}\n')
print(out, img.get('width'), img.get('height'))

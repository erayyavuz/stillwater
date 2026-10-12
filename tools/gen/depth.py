import sys, os, urllib.request, fal_client
assert os.environ.get('FAL_KEY'), 'set FAL_KEY'
src, out = sys.argv[1:3]
r = fal_client.subscribe('fal-ai/image-preprocessors/depth-anything/v2', arguments={'image_url': fal_client.upload_file(src)})
urllib.request.urlretrieve(r['image']['url'], out)
with open(os.path.join(os.path.dirname(__file__), 'ledger.txt'), 'a') as f: f.write(f'0.01 depth {out}\n')
print(out)

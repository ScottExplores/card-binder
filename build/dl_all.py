import json,os,urllib.request,concurrent.futures as cf
ids=json.load(open('all_ids.json'))
def g(i):
    f=f'art/{i}.jpg'
    if os.path.exists(f): return
    for _ in range(3):
        try: urllib.request.urlretrieve(f'https://cards.scryfall.io/small/front/{i[0]}/{i[1]}/{i}.jpg',f); return
        except Exception: pass
with cf.ThreadPoolExecutor(16) as ex: list(ex.map(g,ids))
print('done')

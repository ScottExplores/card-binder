import json,os,urllib.request,concurrent.futures as cf
ids=json.load(open('ua_ids.json'))
def g(i):
    f=f'art/{i}.jpg'
    if os.path.exists(f): return
    try: urllib.request.urlretrieve(f'https://cards.scryfall.io/small/front/{i[0]}/{i[1]}/{i}.jpg',f)
    except Exception as e: pass
with cf.ThreadPoolExecutor(8) as ex: list(ex.map(g,ids))
print('done')

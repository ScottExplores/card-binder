import json,time,urllib.request,urllib.parse,os
H={'User-Agent':'CardBinderBench/1.0','Accept':'application/json'}
def get(u):
    return json.load(urllib.request.urlopen(urllib.request.Request(u,headers=H)))
groups=[("old93","frame:1993 game:paper lang:en",90),("old97","frame:1997 game:paper lang:en",60),("m03","frame:2003 game:paper lang:en",60),
("modern","frame:2015 game:paper lang:en -is:showcase -border:borderless -is:fullart",120),("dfc","is:dfc game:paper lang:en",40),("showcase","(is:showcase or border:borderless) game:paper lang:en -is:dfc",30)]
out=[];seen=set()
for g,q,n in groups:
    k=0;tries=0
    while k<n and tries<n*3:
        tries+=1
        try:c=get('https://api.scryfall.com/cards/random?q='+urllib.parse.quote(q))
        except Exception as e: print(e);time.sleep(1);continue
        time.sleep(0.11)
        if c['id'] in seen or c.get('type_line','').startswith(('Basic Land','Token')) : continue
        iu=c.get('image_uris') or c['card_faces'][0].get('image_uris')
        if not iu: continue
        seen.add(c['id']);k+=1
        f=f"cards/{c['id']}.jpg"
        if not os.path.exists(f): urllib.request.urlretrieve(iu['normal'],f)
        out.append(dict(id=c['id'],name=c['name'],set=c['set'],cn=c['collector_number'],frame=c['frame'],group=g,layout=c['layout']))
json.dump(out,open('cards.json','w'),indent=0);print(len(out))

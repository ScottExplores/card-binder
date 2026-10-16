import json,time,urllib.request,urllib.parse,os
H={'User-Agent':'CardBinderBench/1.0','Accept':'application/json'}
cards=json.load(open('cards.json'));keep=[c for c in cards if c['group']!='dfc'];seen={c['id'] for c in keep};new=[]
q='(layout:transform or layout:modal_dfc) game:paper lang:en'
while len(new)<40:
    c=json.load(urllib.request.urlopen(urllib.request.Request('https://api.scryfall.com/cards/random?q='+urllib.parse.quote(q),headers=H)));time.sleep(0.55)
    if c['id'] in seen: continue
    seen.add(c['id']);f=f"cards/{c['id']}.jpg"
    if not os.path.exists(f): urllib.request.urlretrieve(c['card_faces'][0]['image_uris']['normal'],f)
    new.append(dict(id=c['id'],name=c['name'],set=c['set'],cn=c['collector_number'],frame=c['frame'],group='dfc',layout=c['layout']))
# keep the original order slots: put dfc back where they were
out=[];it=iter(new)
for c in cards: out.append(next(it) if c['group']=='dfc' else c)
json.dump(out,open('cards.json','w'),indent=0);print(len(out))

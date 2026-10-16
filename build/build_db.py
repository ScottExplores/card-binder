# Builds public/data/cards.json: compact table of every English paper printing (from Scryfall bulk default_cards).
import gzip,json,sys
names={};nl=[];sets={};rows=[]
skip_layout={'token','double_faced_token','emblem','art_series','vanguard','scheme','planar'}
for line in gzip.open(sys.argv[1] if len(sys.argv)>1 else 'default.jsonl.gz','rt'):
    line=line.strip().rstrip(',')
    if not line.startswith('{'): continue
    c=json.loads(line)
    if 'paper' not in c.get('games',[]) or c.get('lang')!='en' or c['layout'] in skip_layout or c.get('set_type') in ('memorabilia','token','minigame'): continue
    n=c['name']
    if n not in names: names[n]=len(nl);nl.append(n)
    sets[c['set']]=c['set_name']
    p=c.get('prices',{})
    f=lambda k:(round(float(p[k]),2) if p.get(k) else None)
    fin=''.join(x[0] for x in c.get('finishes',[]))  # n,f,e
    img = 1 if c.get('image_uris') else (2 if c.get('card_faces') and c['card_faces'][0].get('image_uris') else 0)
    if not img: continue
    rows.append([c['id'],names[n],c['set'],c['collector_number'],c.get('frame',''),c.get('rarity','')[:1],fin,f('usd'),f('usd_foil'),f('usd_etched'),c.get('released_at','')[:10],1 if c.get('full_art') or c.get('border_color')=='borderless' else 0])
json.dump({'v':1,'built':__import__('datetime').date.today().isoformat(),'names':nl,'sets':sets,'cols':['id','name','set','cn','frame','rarity','fin','usd','usd_foil','usd_etched','released','fullart'],'rows':rows},open('../public/data/cards.json','w'),separators=(',',':'))
print(len(rows),len(nl),len(sets))

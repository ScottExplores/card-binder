# Confidence calibration: how often each confidence level is right (single + grid results).
import json,sys
from collections import Counter
t={x['file']:x for x in json.load(open('bench/truth.json'))};cards={c['id']:c for c in json.load(open('bench/cards.json'))}
for f in sys.argv[1:]:
    cc=Counter();tot=0
    for x in json.load(open(f)):
        tt=t[x['file']];tot+=len(tt['cards'])
        for g in x['res']:
            slot=0 if tt['mode']=='single' else g['slot']
            if tt['mode']=='single' and g is not x['res'][0]: continue
            cc[(g['conf'],g['name']==cards[tt['cards'][slot]]['name'])]+=1
    auto=cc[('high',True)]+cc[('medium',True)];autow=cc[('high',False)]+cc[('medium',False)]
    print(f,tot,dict(cc));print(f'  auto-added {auto+autow}/{tot} ({100*(auto+autow)/tot:.1f}%), of which wrong {autow} ({100*autow/max(1,auto+autow):.1f}%); high-only precision {100*cc[("high",True)]/max(1,cc[("high",True)]+cc[("high",False)]):.1f}%')

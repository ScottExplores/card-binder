import json,subprocess,cv2,numpy as np,sys
t=[x for x in json.load(open('bench/truth.json')) if x['mode']=='single']
subprocess.run(['node','bench/quads.mjs','3']+[x['file'] for x in t],check=True)
q=json.load(open('/tmp/quads.json'));ok=0;bad=[]
from collections import Counter;bc=Counter()
for x in t:
    im=cv2.imread('bench/'+x['file']);H,W=im.shape[:2]
    a=np.zeros((H,W),np.uint8);cv2.fillPoly(a,[np.int32(x['quads'][0])],1)
    best=0
    qs=q.get(x['file'],[])
    if qs:
        # app picks the largest
        qq=max(qs,key=lambda z:cv2.contourArea(np.float32(z)))
        b=np.zeros((H,W),np.uint8);cv2.fillPoly(b,[np.int32(qq)],1);best=(a&b).sum()/max(1,(a|b).sum())
    if best>0.85: ok+=1
    else: bad.append((x['file'],x['cond'],round(best,2)));bc[x['cond']]+=1
print('detect ok',ok,len(t));print(bc);print(bad[:20])

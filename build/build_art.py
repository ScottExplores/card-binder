# Builds public/data/art.bin from build/artvec.f32 (computed by build/artvec.mjs with the app's feature code).
import numpy as np,json,os
X=np.fromfile('artvec.f32',dtype=np.float32).reshape(-1,576);ids=json.load(open('artvec_ids.json'))
db=json.load(open('../public/data/cards.json'));C={k:i for i,k in enumerate(db['cols'])};row={r[0]:i for i,r in enumerate(db['rows'])}
keep=[k for k,i in enumerate(ids) if i in row and not db['rows'][row[i]][C['noimg']]]
X=X[keep];ids=[ids[k] for k in keep]
mu=X.mean(0);Xc=X-mu
U,S,Vt=np.linalg.svd(Xc[np.random.default_rng(0).choice(len(X),20000,replace=False)],full_matrices=False)
D=64;P=Vt[:D].astype(np.float32);Z=Xc@P.T;Z/=np.linalg.norm(Z,axis=1,keepdims=True)+1e-9
q=np.clip(np.round(Z*127),-127,127).astype(np.int8);idx=np.array([row[i] for i in ids],dtype=np.uint32)
hdr=json.dumps({'n':len(ids),'d':D,'in':576,'built':db['built']}).encode();hdr+=b' '*((4-len(hdr)%4)%4)
with open('../public/data/art.bin','wb') as f:
    for b in (np.uint32(len(hdr)).tobytes(),hdr,mu.astype(np.float32).tobytes(),P.tobytes(),idx.tobytes(),q.tobytes()): f.write(b)
print(len(ids),os.path.getsize('../public/data/art.bin'))

# Builds public/data/prints.bin: PCA-D int8 index over every printing's weighted [full, art] feature (dot ~= app sim()).
import numpy as np,json,os,sys
D=int(sys.argv[1]) if len(sys.argv)>1 else 64
ids=json.load(open('printvec_ids.json'));X=np.memmap('printvec.f32',dtype=np.float32,mode='r').reshape(len(ids),3024)
w=np.concatenate([np.full(2448,np.sqrt(.45)),np.full(576,np.sqrt(.55))]).astype(np.float32)
db=json.load(open('../public/data/cards.json'));C={k:i for i,k in enumerate(db['cols'])};row={r[0]:i for i,r in enumerate(db['rows'])}
rng=np.random.default_rng(0);S=np.asarray(X[np.sort(rng.choice(len(ids),25000,replace=False))])*w
mu=S.mean(0);U,s,Vt=np.linalg.svd(S-mu,full_matrices=False);P=Vt[:D].astype(np.float32)
Z=np.zeros((len(ids),D),np.float32)
for i in range(0,len(ids),20000): Z[i:i+20000]=(np.asarray(X[i:i+20000])*w-mu)@P.T
Z/=np.linalg.norm(Z,axis=1,keepdims=True)+1e-9
q=np.clip(np.round(Z*127),-127,127).astype(np.int8);idx=np.array([row[i] for i in ids],dtype=np.uint32)
hdr=json.dumps({'n':len(ids),'d':D,'in':3024,'built':db['built']}).encode();hdr+=b' '*((4-len(hdr)%4)%4)
Pw=(P*w).astype(np.float32); muw=(mu/w).astype(np.float32)  # so the app can project its raw [full,art] vector: z = P*w . (v - mu/w)
with open('../public/data/prints.bin','wb') as f:
    for b in (np.uint32(len(hdr)).tobytes(),hdr,muw.tobytes(),Pw.tobytes(),idx.tobytes(),q.tobytes()): f.write(b)
print(len(ids),os.path.getsize('../public/data/prints.bin'))

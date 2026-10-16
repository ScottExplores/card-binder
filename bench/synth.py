import cv2,numpy as np,json,random,os
random.seed(7);np.random.seed(7)
cards=json.load(open('cards.json'));os.makedirs('scenes',exist_ok=True)
def bg(w,h):
    t=random.choice(['wood','solid','grad','dark','cloth'])
    if t=='solid': b=np.full((h,w,3),[random.randint(60,230) for _ in range(3)],np.uint8)
    elif t=='dark': b=np.full((h,w,3),random.randint(10,45),np.uint8)
    elif t=='grad':
        a=np.linspace(0,1,h)[:,None,None];c1=np.random.randint(0,255,3);c2=np.random.randint(0,255,3);b=(c1*(1-a)+c2*a).repeat(w,1).astype(np.uint8)
    elif t=='wood':
        x=np.arange(w)[None,:];y=np.arange(h)[:,None];v=np.sin(x/random.uniform(6,20)+np.sin(y/40)*3)*0.5+0.5
        b=np.stack([v*40+60,v*60+90,v*70+130],-1).astype(np.uint8)
    else:
        n=cv2.GaussianBlur(np.random.randint(0,255,(h,w)).astype(np.uint8),(5,5),0);c=np.random.randint(40,200,3)
        b=(n[...,None]/255*0.4*c+0.6*c).astype(np.uint8)
    return b
def card_img(c,cond):
    im=cv2.imread(f"cards/{c['id']}.jpg");im=cv2.resize(im,(488,680)).astype(np.float32)
    h,w=im.shape[:2]
    if 'foil' in cond:
        yy,xx=np.mgrid[0:h,0:w];ph=(xx+yy)/random.uniform(60,140)
        rb=np.stack([np.sin(ph)*0.5+.5,np.sin(ph+2)*0.5+.5,np.sin(ph+4)*0.5+.5],-1)*255
        im=im*(1-.2)+rb*.2
    if 'sleeve' in cond:
        im=im*0.92+255*0.08
        pad=int(w*0.03);s=np.full((h+2*pad,w+2*pad,3),200,np.float32);s[pad:pad+h,pad:pad+w]=im;im=s
    if 'glare' in cond:
        H,W=im.shape[:2];m=np.zeros((H,W),np.float32)
        cv2.ellipse(m,(random.randint(0,W),random.randint(0,H)),(random.randint(40,160),random.randint(20,90)),random.randint(0,180),0,360,1,-1)
        m=cv2.GaussianBlur(m,(0,0),25)*random.uniform(.5,.85);im=im*(1-m[...,None])+255*m[...,None]
    return np.clip(im,0,255).astype(np.uint8)
def place(scene,im,quad):
    h,w=im.shape[:2];M=cv2.getPerspectiveTransform(np.float32([[0,0],[w,0],[w,h],[0,h]]),np.float32(quad))
    H,W=scene.shape[:2];wi=cv2.warpPerspective(im,M,(W,H));mk=cv2.warpPerspective(np.full((h,w),255,np.uint8),M,(W,H))
    mk=cv2.GaussianBlur(mk,(3,3),0)[...,None]/255.;return (scene*(1-mk)+wi*mk).astype(np.uint8)
def persp(cx,cy,cw,ch,ang,tilt):
    pts=np.float32([[-cw/2,-ch/2],[cw/2,-ch/2],[cw/2,ch/2],[-cw/2,ch/2]])
    # tilt: shrink top edge (camera angle)
    tx,ty=tilt;pts[0,0]*=1-tx;pts[1,0]*=1-tx;pts[0,1]*=1-ty*0.3;pts[1,1]*=1-ty*0.3
    pts[1,1]+=random.uniform(-1,1)*cw*0.04;
    a=np.deg2rad(ang);R=np.array([[np.cos(a),-np.sin(a)],[np.sin(a),np.cos(a)]]);return (pts@R.T+[cx,cy]).tolist()
def finish(s,blur=True):
    if blur and random.random()<.5: s=cv2.GaussianBlur(s,(0,0),random.uniform(.5,1.4))
    s=np.clip(s.astype(np.float32)*random.uniform(.7,1.15)+np.random.normal(0,random.uniform(2,7),s.shape),0,255).astype(np.uint8)
    return s
truth=[]
conds=['clean','angled','glare','sleeve','foil','angled+glare','sleeve+foil','angled+sleeve']
for i,c in enumerate(cards):
    cond=conds[i%len(conds)];W,H=960,1280;s=bg(W,H)
    ch=H*random.uniform(.5,.75);cw=ch*0.716
    tilt=(random.uniform(.08,.22),random.uniform(.05,.2)) if 'angled' in cond else (random.uniform(0,.04),0)
    ang=random.uniform(-20,20) if 'angled' in cond else random.uniform(-5,5)
    q=persp(W/2+random.uniform(-60,60),H/2+random.uniform(-60,60),cw,ch,ang,tilt)
    s=place(s,card_img(c,cond),q);fn=f"scenes/s{i:03d}.jpg"
    if 'sleeve' in cond:  # card sits inside the sleeve pad
        pass
    cv2.imwrite(fn,finish(s),[cv2.IMWRITE_JPEG_QUALITY,random.randint(60,88)])
    truth.append(dict(file=fn,mode='single',cond=cond,cards=[c['id']],quads=[q]))
def grid(n,k,idx):
    W,H=1200,1600;s=np.full((H,W,3),random.randint(15,40),np.uint8)
    gw,gh=W*0.92/n,H*0.92/n;cw=min(gw*0.92,gh*0.92*0.716);ch=cw/0.716;ids=[]
    cond=random.choice(['sleeve','sleeve+glare','sleeve','clean','sleeve+foil'])
    for r in range(n):
        for cc in range(n):
            c=cards[idx.pop()];ids.append(c['id'])
            cx=W*0.04+gw*(cc+.5);cy=H*0.04+gh*(r+.5)
            q=persp(cx,cy,cw,ch,random.uniform(-2,2),(random.uniform(0,.03),0))
            s=place(s,card_img(c,cond if random.random()<.7 else 'sleeve'),q)
    # whole-page tilt
    t=random.uniform(0,.08);src=np.float32([[0,0],[W,0],[W,H],[0,H]]);dst=np.float32([[W*t,H*t*0.5],[W*(1-t),H*t*.5],[W,H],[0,H]])
    s=cv2.warpPerspective(s,cv2.getPerspectiveTransform(src,dst),(W,H),borderValue=(20,20,20))
    fn=f"scenes/g{n}_{k:03d}.jpg";cv2.imwrite(fn,finish(s),[cv2.IMWRITE_JPEG_QUALITY,80])
    truth.append(dict(file=fn,mode=f'grid{n}',cond=cond,cards=ids))
for k in range(40): idx=random.sample(range(len(cards)),4);grid(2,k,idx)
for k in range(30): idx=random.sample(range(len(cards)),9);grid(3,k,idx)
json.dump(truth,open('truth.json','w'));print(len(truth))

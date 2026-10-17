import cv2,numpy as np,json,random,os
random.seed(7);np.random.seed(7)

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

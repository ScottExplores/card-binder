import cv2,numpy as np,json,subprocess,sys,os,tempfile,concurrent.futures as cf,re
from collections import defaultdict
cards=json.load(open('cards.json'))
def band(im,y0=.035,y1=.098,x0=.055,x1=.80):
    h,w=im.shape[:2];b=im[int(y0*h):int(y1*h),int(x0*w):int(x1*w)];s=64/b.shape[0];return cv2.resize(b,None,fx=s,fy=s,interpolation=cv2.INTER_CUBIC)
def variants(b):
    g=cv2.cvtColor(b,cv2.COLOR_BGR2GRAY);out={}
    med=np.median(g);out['auto']=255-g if med<110 else g
    k=cv2.getStructuringElement(cv2.MORPH_ELLIPSE,(17,17))
    th=cv2.morphologyEx(g,cv2.MORPH_TOPHAT,k);bh=cv2.morphologyEx(g,cv2.MORPH_BLACKHAT,k)
    out['tophat']=255-cv2.normalize(th,None,0,255,cv2.NORM_MINMAX)
    out['blackhat']=255-cv2.normalize(bh,None,0,255,cv2.NORM_MINMAX)
    _,o=cv2.threshold(th,0,255,cv2.THRESH_BINARY+cv2.THRESH_OTSU);out['tophat_otsu']=255-o
    _,o=cv2.threshold(bh,0,255,cv2.THRESH_BINARY+cv2.THRESH_OTSU);out['blackhat_otsu']=255-o
    return out
def ocr(img):
    f=tempfile.mktemp(suffix='.png');cv2.imwrite(f,cv2.copyMakeBorder(img,8,8,12,12,cv2.BORDER_CONSTANT,value=255))
    r=subprocess.run(['tesseract',f,'-','--psm','7'],capture_output=True,text=True);os.remove(f);return r.stdout.strip()
def norm(s):return re.sub(r'[^a-z ]','',s.lower()).strip()
def run(c):
    im=cv2.resize(cv2.imread(f"cards/{c['id']}.jpg"),(488,680));v=variants(band(im));name=norm(c['name'].split(' // ')[0])
    return c['group'],{k:(name in norm(ocr(x))) for k,x in v.items()}
sel=[c for c in cards if c['group'] in sys.argv[1].split(',')][:int(sys.argv[2])]
with cf.ThreadPoolExecutor(4) as ex: res=list(ex.map(run,sel))
agg=defaultdict(lambda:defaultdict(int));cnt=defaultdict(int)
for g,r in res:
    for gg in (g,'all'):
        cnt[gg]+=1
        for k,v in r.items(): agg[gg][k]+=v
        agg[gg]['any']+=any(r.values())
for g in cnt: print(g,cnt[g],{k:round(v/cnt[g],2) for k,v in agg[g].items()})

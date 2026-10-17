# Synthetic "sweep" video: bench scenes held ~1.2 s with hand jitter, joined by blurred slide transitions.
import json,random,subprocess,sys
from PIL import Image,ImageFilter
random.seed(int(sys.argv[2]) if len(sys.argv)>2 else 1)
out=sys.argv[1] if len(sys.argv)>1 else 'bench/video1'
t=json.load(open('bench/truth.json'))
singles=[x for x in t if x['mode']=='single'];g2=[x for x in t if x['mode']=='grid2'];g3=[x for x in t if x['mode']=='grid3']
seq=random.sample(singles,14)+random.sample(g2,3)+random.sample(g3,2); random.shuffle(seq)
W,H=1080,1440;fps=30
def load(x):
    im=Image.open('bench/'+x['file']).convert('RGB');s=min(W/im.width,H/im.height)*1.08
    return im.resize((int(im.width*s),int(im.height*s)))
p=subprocess.Popen(['ffmpeg','-y','-loglevel','error','-f','rawvideo','-pix_fmt','rgb24','-s',f'{W}x{H}','-r',str(fps),'-i','-','-c:v','libx264','-pix_fmt','yuv420p','-crf','23',out+'.mp4'],stdin=subprocess.PIPE)
def put(im,dx,dy,blur=0):
    c=Image.new('RGB',(W,H),(30,28,26));c.paste(im,((W-im.width)//2+int(dx),(H-im.height)//2+int(dy)))
    if blur: c=c.filter(ImageFilter.BoxBlur(blur))
    p.stdin.write(c.tobytes())
truth=[]
for k,x in enumerate(seq):
    im=load(x);hold=int(fps*random.uniform(0.9,1.5))
    for f in range(8): put(im,(8-f)*130,0,blur=(8-f)*1.5)   # slide in
    jx=jy=0
    for f in range(hold): jx+=random.uniform(-2,2);jy+=random.uniform(-2,2);put(im,jx,jy,blur=1.2 if random.random()<0.15 else 0)
    for f in range(8): put(im,-f*130,0,blur=f*1.5)          # slide out
    truth+=x['cards']
p.stdin.close();p.wait()
json.dump({'cards':truth,'scenes':[x['file'] for x in seq]},open(out+'.json','w'))
print(len(truth),'cards')

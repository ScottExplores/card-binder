# Synthetic "deal a deck" video: cards are dealt one at a time onto a pile under the phone.
# Each new card slides in over the previous one, is held 0.45-0.9 s with hand jitter, sometimes a little blur.
# Includes runs of identical basic lands (the hard case for counting). Usage: python3 mkdeck.py out_base seed n_unique
import cv2, numpy as np, json, random, subprocess, sys
out = sys.argv[1] if len(sys.argv) > 1 else 'deck1'; seed = int(sys.argv[2]) if len(sys.argv) > 2 else 1; nu = int(sys.argv[3]) if len(sys.argv) > 3 else 45
random.seed(seed); np.random.seed(seed)
import synth_lib as S
random.seed(seed); np.random.seed(seed)
cards = [c for c in json.load(open('cards.json')) if c['layout'] in ('normal', 'transform', 'modal_dfc', 'adventure', 'saga', 'leveler', 'class', 'split', 'flip', 'meld') ]
basics = json.load(open('basics.json'))
seq = random.sample(cards, nu)
# insert runs of basics
for b in basics[:4]:
    k = random.randint(2, 5); pos = random.randint(0, len(seq)); seq[pos:pos] = [b] * k
W, H, fps = 1080, 1440, 30
bgimg = S.bg(W, H)
cond = random.choice(['sleeve', 'sleeve+glare', 'clean'])
p = subprocess.Popen(['ffmpeg', '-y', '-loglevel', 'error', '-f', 'rawvideo', '-pix_fmt', 'bgr24', '-s', f'{W}x{H}', '-r', str(fps), '-i', '-', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-crf', '24', out + '.mp4'], stdin=subprocess.PIPE)
ch = H * 0.66; cw = ch * 0.716
def quad(dx, dy, ang): return S.persp(W / 2 + dx, H / 2 + dy, cw, ch, ang, (0.04, 0.02))
pile = bgimg.copy(); truth = []
for k, c in enumerate(seq):
    im = S.card_img(c, random.choice(['sleeve', 'sleeve', 'sleeve+glare', 'clean', 'sleeve+foil']) if cond != 'clean' else 'clean')
    ang = random.uniform(-6, 6); fx, fy = random.uniform(-30, 30), random.uniform(-30, 30)
    n_in = random.randint(6, 9)
    for f in range(n_in):  # slide in from the right/bottom over the pile
        t = 1 - (f + 1) / n_in; fr = S.place(pile, im, quad(fx + t * 900, fy + t * random.uniform(80, 200), ang + t * 15))
        if t > 0.2: fr = cv2.GaussianBlur(fr, (0, 0), 2 + 4 * t)
        p.stdin.write(fr.tobytes())
    pile = S.place(pile, im, quad(fx, fy, ang)); hold = int(fps * random.uniform(0.45, 0.9)); jx = jy = 0
    for f in range(hold):
        jx += random.uniform(-2.5, 2.5); jy += random.uniform(-2.5, 2.5)
        M = np.float32([[1, 0, jx], [0, 1, jy]]); fr = cv2.warpAffine(pile, M, (W, H), borderMode=cv2.BORDER_REFLECT)
        if random.random() < 0.15: fr = cv2.GaussianBlur(fr, (0, 0), 1.3)
        fr = np.clip(fr.astype(np.int16) + np.random.randint(-4, 5, fr.shape, dtype=np.int16), 0, 255).astype(np.uint8)
        p.stdin.write(fr.tobytes())
    truth.append(c['id'])
p.stdin.close(); p.wait()
allc = {c['id']: c for c in cards + basics}
json.dump({'cards': truth, 'names': [allc[i]['name'] for i in truth]}, open(out + '.json', 'w'))
print(len(truth), 'cards', cond)

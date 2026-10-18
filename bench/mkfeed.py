# Synthetic "fast scan" camera feed: phone held over a table, cards slid one after another into the on-screen card box.
# Each card slides in over ~0.1 s (3 frames), then sits still. Usage: python3 mkfeed.py out_base cards_per_sec n seed
# Writes out_base.y4m (portrait 720x1280, 30 fps, for Chrome's fake camera) and out_base.json (truth, in order).
import cv2, numpy as np, json, random, subprocess, sys
out = sys.argv[1]; rate = float(sys.argv[2]); n = int(sys.argv[3]); seed = int(sys.argv[4]) if len(sys.argv) > 4 else 1
random.seed(seed); np.random.seed(seed)
import synth_lib as S
random.seed(seed); np.random.seed(seed)
cards = [c for c in json.load(open('cards.json')) if c['layout'] in ('normal', 'transform', 'modal_dfc', 'adventure', 'saga', 'leveler', 'class', 'split', 'flip', 'meld')]
seq = random.sample(cards, n)
W, H, fps = 720, 1280, 30
# the app's card box for a 412x915 phone screen: centre (360, 563) in video pixels, about 543 x 758
CX, CY, ch = 360, 563, 700; cw = ch * 0.716
bgimg = S.bg(W, H)
p = subprocess.Popen(['ffmpeg', '-y', '-loglevel', 'error', '-f', 'rawvideo', '-pix_fmt', 'bgr24', '-s', f'{W}x{H}', '-r', str(fps), '-i', '-', '-pix_fmt', 'yuv420p', '-f', 'yuv4mpegpipe', out + '.y4m'], stdin=subprocess.PIPE)
def quad(dx, dy, ang): return S.persp(CX + dx, CY + dy, cw, ch, ang, (0.02, 0.01))
per = fps / rate; pile = bgimg.copy(); truth = []; acc = 0.0
# a second of empty table first
for f in range(fps): p.stdin.write(np.clip(bgimg.astype(np.int16) + np.random.randint(-3, 4, bgimg.shape, dtype=np.int16), 0, 255).astype(np.uint8).tobytes())
for k, c in enumerate(seq):
    im = S.card_img(c, random.choice(['sleeve', 'clean', 'clean', 'sleeve+glare', 'sleeve+foil']))
    ang = random.uniform(-3, 3); fx, fy = random.uniform(-14, 14), random.uniform(-14, 14)
    acc += per; frames = int(round(acc)); acc -= frames; n_in = 3
    for f in range(n_in):
        t = 1 - (f + 1) / (n_in + 1); fr = S.place(pile, im, quad(fx + t * 700, fy + t * 60, ang + t * 8))
        fr = cv2.GaussianBlur(fr, (0, 0), 1 + 4 * t); p.stdin.write(fr.tobytes())
    pile = S.place(pile, im, quad(fx, fy, ang))
    for f in range(max(1, frames - n_in)):
        fr = np.clip(pile.astype(np.int16) + np.random.randint(-3, 4, pile.shape, dtype=np.int16), 0, 255).astype(np.uint8)
        p.stdin.write(fr.tobytes())
    truth.append(c['id'])
for f in range(fps): p.stdin.write(pile.tobytes())
p.stdin.close(); p.wait()
json.dump({'rate': rate, 'cards': truth, 'names': [c['name'] for c in seq], 'seconds': (n / rate) + 2}, open(out + '.json', 'w'))
print(len(truth), 'cards at', rate, '/s')

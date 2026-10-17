# Builds public/data/meta.json: per-name game info (type, cmc, colors, color identity, format legality)
# and per-printing style flags, aligned with public/data/cards.json (names[] and rows[] order).
# Needs oracle.jsonl.gz and default.jsonl.gz from Scryfall bulk data (free, no key).
import gzip, json, re
cards = json.load(open('../public/data/cards.json'))
names = cards['names']; ni = {n: i for i, n in enumerate(names)}
FORMATS = ['commander', 'standard', 'modern', 'pioneer', 'legacy', 'vintage', 'pauper']
CODE = {'legal': 'l', 'banned': 'b', 'restricted': 'r', 'not_legal': 'n'}
info = [None] * len(names)
def rd(p):
    for line in gzip.open(p, 'rt'):
        line = line.strip().rstrip(',')
        if line.startswith('{'): yield json.loads(line)
for c in rd('oracle.jsonl.gz'):
    i = ni.get(c['name'])
    if i is None or (info[i] and c['layout'] in ('token', 'art_series')): continue
    tl = c.get('type_line') or (c.get('card_faces') or [{}])[0].get('type_line', '')
    front = tl.split(' // ')[0]
    txt = (c.get('oracle_text') or '') + ' '.join(f.get('oracle_text', '') for f in c.get('card_faces', []))
    leg = ''.join(CODE.get(c.get('legalities', {}).get(f, 'not_legal'), 'n') for f in FORMATS)
    ftxt = ((c.get('card_faces') or [c])[0].get('oracle_text') or '')
    lines = ftxt.split('\n')
    has = lambda l: any(x == l or x.startswith(l + ' (') for x in lines)
    bg = 'Legendary' in front and 'Enchantment' in front and 'Background' in front
    # 1 = can be a commander, 2 = only next to a "Choose a Background" commander
    cmdr = 1 if (('Legendary' in front and 'Creature' in front) or 'can be your commander' in ftxt or c['name'] == 'Grist, the Hunger Tide') else 2 if bg else 0
    pair = []
    if has('Partner'): pair.append('P')
    for x in lines:
        m = re.match(r'^Partner with ([^(]+?)(?: \(|$)', x)
        if m: pair.append('W:' + m.group(1).strip())
        m = re.match(r'^Partner—([^(]+?)(?: \(|$)', x)
        if m: pair.append('P:' + m.group(1).strip())
    if has('Friends forever'): pair.append('P:Friends forever')
    if has('Choose a Background'): pair.append('B')
    if bg: pair.append('G')
    if has("Doctor's companion"): pair.append('D')
    if front == 'Legendary Creature — Time Lord Doctor': pair.append('T')
    # singleton exceptions: "A deck can have any number of cards named X" / "up to seven"
    lim = 0
    if re.search(r'any number of cards named', txt): lim = 999
    m = re.search(r'up to (\w+) cards named', txt)
    if m: lim = {'seven': 7, 'nine': 9}.get(m.group(1), 999)
    info[i] = [front, c.get('cmc', 0), ''.join(c.get('colors') or sorted({x for f in c.get('card_faces', []) for x in f.get('colors', [])})), ''.join(c.get('color_identity', [])), leg, cmdr, lim, '|'.join(pair)]
byname = {}
for i, x in enumerate(info):
    if x: byname[names[i]] = x
for i, x in enumerate(info):  # reversible "X // X" printings: use the front card
    if x is None and names[i].split(' // ')[0] in byname: info[i] = byname[names[i].split(' // ')[0]]
W = 'WUBRG'
for x in info:
    if x: x[2] = ''.join(sorted(x[2], key=W.index)); x[3] = ''.join(sorted(x[3], key=W.index))
missing = sum(1 for x in info if x is None)
# printing styles
rowOf = {r[0]: k for k, r in enumerate(cards['rows'])}
style = [''] * len(cards['rows'])
for c in rd('default.jsonl.gz'):
    k = rowOf.get(c['id'])
    if k is None: continue
    fx = c.get('frame_effects') or []
    s = ''
    if 'showcase' in fx: s += 'S'
    if 'extendedart' in fx: s += 'X'
    if c.get('border_color') == 'borderless': s += 'B'
    if c.get('full_art'): s += 'F'
    if c.get('promo'): s += 'P'
    if 'etched' in fx: s += 'E'
    if c.get('frame') == '1997' and c.get('released_at', '') > '2004': s += 'R'  # retro frame reprint
    if c.get('textless'): s += 'T'
    style[k] = s
json.dump({'v': 1, 'formats': FORMATS, 'cols': ['type', 'cmc', 'colors', 'ci', 'legal', 'cmdr', 'limit', 'pair'], 'info': info, 'style': style}, open('../public/data/meta.json', 'w'), separators=(',', ':'))
print('names', len(names), 'missing', missing, 'styled', sum(1 for s in style if s))

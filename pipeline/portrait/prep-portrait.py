"""Prepares the portrait for the page.

    python3 pipeline/portrait/prep-portrait.py <original-photo> public/assets/portrait [check.png]

1. Traces the glasses: the two lens rims, the top edge of the browline and the
   bridge, starting from hand-placed points (photo pixels) that are snapped to
   the frame's edges.
2. Removes the thin parts of the original frame from the photo (metal rims,
   bridge, nose pads), filling in from the skin around them. The clear
   browline stays: the page covers it with the new frame's browline, and
   draws the laser rims along the same outline.
3. Crops to the head, halves the size and writes my-face.webp plus
   eyewear.json (the frame's outline, in the cropped photo's pixels).

The hand-placed points below belong to this one photo. For another photo, place
new points (or drop the eyewear from src/content.ts).
"""
import json, os, sys
import numpy as np, cv2

src, out_dir = sys.argv[1], sys.argv[2]
os.makedirs(out_dir, exist_ok=True)
img = cv2.imread(src)
g = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY).astype(np.float32)
ridge = np.abs(g - cv2.GaussianBlur(g, (0, 0), 5)) + 0.5 * np.abs(g - cv2.GaussianBlur(g, (0, 0), 2))
ridge = cv2.GaussianBlur(ridge, (0, 0), 1.2)

O = np.array([1000, 1300])  # the hand-placed points were read off a crop at this offset
def pts(a):
    return np.array(a, np.float64) + O

LENS_R = pts([(160, 170), (300, 135), (450, 140), (600, 165), (670, 200), (692, 260), (690, 330), (683, 400), (670, 460), (640, 520), (590, 565), (450, 585), (300, 580), (200, 545), (155, 480), (138, 400), (135, 300), (140, 220)])
LENS_L = pts([(905, 200), (960, 165), (1100, 145), (1250, 145), (1400, 160), (1430, 200), (1440, 280), (1438, 380), (1425, 470), (1400, 540), (1350, 580), (1200, 595), (1050, 590), (960, 545), (925, 480), (905, 400), (900, 320), (898, 250)])
# top edge of the clear browline, outer hinge to bridge
BROW_R = pts([(60, 140), (160, 128), (300, 117), (450, 118), (600, 130), (650, 145), (685, 170), (703, 205), (712, 240), (714, 262)])
BROW_L = pts([(884, 262), (882, 235), (888, 205), (903, 180), (930, 160), (975, 145), (1100, 130), (1300, 128), (1450, 140), (1530, 160)])
BRIDGE = pts([(705, 238), (750, 232), (790, 230), (830, 232), (875, 240)])
PADS = [((1670, 1672), (42, 108)), ((1902, 1676), (44, 108))]  # nose pads: centre, half-axes (full photo pixels)
CROP = (900, 900, 2700, 3100)  # x0, y0, x1, y1
SCALE = 0.5
LANDMARKS = {'eyeR': (1452, 1584), 'eyeL': (2143, 1578), 'chin': (1800, 2742)}


def catmull(P, n, closed):
    out = []
    N = len(P)
    rng = range(N) if closed else range(N - 1)
    for i in rng:
        p0 = P[(i - 1) % N] if closed or i > 0 else P[0]
        p1, p2 = P[i], P[(i + 1) % N]
        p3 = P[(i + 2) % N] if closed or i + 2 < N else P[-1]
        for t in np.linspace(0, 1, n, endpoint=False):
            t2, t3 = t * t, t * t * t
            out.append(0.5 * ((2 * p1) + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2 + (-p0 + 3 * p1 - 3 * p2 + p3) * t3))
    if not closed:
        out.append(P[-1])
    return np.array(out)


def normals(D, closed):
    n = len(D)
    N = np.zeros_like(D)
    for i in range(n):
        a = D[(i - 1) % n] if closed or i > 0 else D[i]
        b = D[(i + 1) % n] if closed or i < n - 1 else D[i]
        t = b - a
        t /= np.linalg.norm(t) + 1e-9
        N[i] = (-t[1], t[0])
    return N


def snap(P, closed, reach=12, iters=3):
    for _ in range(iters):
        D = catmull(P, 8, closed)
        Nm = normals(D, closed)
        offs = np.zeros(len(D))
        for i, (p, nv) in enumerate(zip(D, Nm)):
            best, bo = -1, 0
            for o in np.arange(-reach, reach + 0.5, 0.5):
                x, y = p + nv * o
                v = cv2.getRectSubPix(ridge, (1, 1), (float(x), float(y)))[0, 0] - 0.004 * o * o
                if v > best:
                    best, bo = v, o
            offs[i] = bo
        k = 9
        if closed:
            pad = np.concatenate([offs[-k:], offs, offs[:k]])
        else:
            pad = np.concatenate([np.repeat(offs[0], k), offs, np.repeat(offs[-1], k)])
        med = np.array([np.median(pad[i:i + 2 * k + 1]) for i in range(len(offs))])
        if closed:
            F = np.fft.rfft(med)
            F[7:] = 0
            sm = np.fft.irfft(F, len(med))
        else:
            sm = np.convolve(np.pad(med, 6, mode='edge'), np.ones(13) / 13, mode='valid')
        D = D + Nm * sm[:, None]
        P = D[::4] if closed else np.vstack([D[:-1:4], D[-1:]])
        reach = max(5, reach // 2)
    return P


lensR, lensL = snap(LENS_R, True), snap(LENS_L, True)
browR, browL = snap(BROW_R, False, reach=6), snap(BROW_L, False, reach=6)

# remove the nose pads and the thin metal rims (lower three sides; the top is covered by the new frame)
mask = np.zeros(g.shape, np.uint8)
cv2.polylines(mask, [catmull(BRIDGE, 6, False).astype(np.int32)], False, 255, 22, cv2.LINE_AA)
for (c, ax) in PADS:
    cv2.ellipse(mask, c, ax, 0, 0, 360, 255, -1)
for P in (lensR, lensL):
    D = catmull(P, 6, True)
    cy = D[:, 1].min()
    low = D[D[:, 1] > cy + 60].astype(np.int32)
    cv2.polylines(mask, [low], False, 255, 15, cv2.LINE_AA)
mask = cv2.dilate(mask, np.ones((5, 5), np.uint8))
clean = cv2.inpaint(img, mask, 7, cv2.INPAINT_TELEA)

x0, y0, x1, y1 = CROP
crop = clean[y0:y1, x0:x1]
crop = cv2.resize(crop, None, fx=SCALE, fy=SCALE, interpolation=cv2.INTER_AREA)
cv2.imwrite(os.path.join(out_dir, 'my-face.webp'), crop, [cv2.IMWRITE_WEBP_QUALITY, 92])

def to_out(P):
    return [[round((x - x0) * SCALE, 1), round((y - y0) * SCALE, 1)] for x, y in P]

geo = {
    'size': [crop.shape[1], crop.shape[0]],
    'landmarks': {k: to_out([v])[0] for k, v in LANDMARKS.items()},
    'lenses': [to_out(lensR), to_out(lensL)],
    'brow': [to_out(browR), to_out(browL)],
    'bridge': to_out(BRIDGE),
}
json.dump(geo, open(os.path.join(out_dir, 'eyewear.json'), 'w'), separators=(',', ':'))
# a check image: the traced outline on the cleaned photo
vis = crop.copy()
for P in geo['lenses']:
    cv2.polylines(vis, [np.array(P, np.int32)], True, (0, 0, 255), 1, cv2.LINE_AA)
for P in geo['brow'] + [geo['bridge']]:
    cv2.polylines(vis, [np.array(P, np.int32)], False, (0, 255, 255), 1, cv2.LINE_AA)
if len(sys.argv) > 3:
    cv2.imwrite(sys.argv[3], vis)
print(json.dumps(geo['landmarks']), geo['size'], len(geo['lenses'][0]))

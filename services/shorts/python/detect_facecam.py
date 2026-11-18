"""OpenCV se clip ke andar face dhoondta hai (Haar cascade, free + local).
Usage: python detect_facecam.py <video> <start_sec> <end_sec> <out.json>
Output: {"found": bool, "face": {cx, cy, w, h (0..1 normalized)}, "kind": "overlay"|"fullframe"}
  overlay   = chhota facecam (gameplay/screen recording ke corner me, chhota chehra)
  fullframe = talking-head video (face badi hai)
"""
import json
import statistics
import sys

import cv2

video, start, end, out_path = sys.argv[1], float(sys.argv[2]), float(sys.argv[3]), sys.argv[4]

result = {"found": False}
cap = cv2.VideoCapture(video)
W = cap.get(cv2.CAP_PROP_FRAME_WIDTH)
H = cap.get(cv2.CAP_PROP_FRAME_HEIGHT)

if cap.isOpened() and W > 0 and H > 0:
    cascade = cv2.CascadeClassifier(cv2.data.haarcascades + "haarcascade_frontalface_default.xml")
    if cascade.empty():
        sys.exit("Haar cascade file nahi mili. 'pip install \"opencv-python-headless<5\"' chalao (OpenCV 5 me ye file nahi aati)")
    faces = []
    samples = 8
    for i in range(samples):
        t = start + (end - start) * (i + 0.5) / samples
        cap.set(cv2.CAP_PROP_POS_MSEC, t * 1000)
        ok, frame = cap.read()
        if not ok:
            continue
        gray = cv2.equalizeHist(cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY))
        min_side = int(W * 0.04)
        found = cascade.detectMultiScale(gray, scaleFactor=1.1, minNeighbors=6, minSize=(min_side, min_side))
        if len(found):
            x, y, w, h = max(found, key=lambda f: f[2] * f[3])
            faces.append(((x + w / 2) / W, (y + h / 2) / H, w / W, h / H))

    if len(faces) >= 3:  # kam se kam 3 frames me face dikhe tabhi maano
        cx = statistics.median([f[0] for f in faces])
        cy = statistics.median([f[1] for f in faces])
        w = statistics.median([f[2] for f in faces])
        h = statistics.median([f[3] for f in faces])
        # Corner facecam = chhota chehra + frame ke kone ke paas. Baaki sab talking-head maana jayega.
        in_corner = abs(cx - 0.5) > 0.25 and abs(cy - 0.5) > 0.2
        result = {
            "found": True,
            "face": {"cx": cx, "cy": cy, "w": w, "h": h},
            "kind": "overlay" if (h < 0.25 and in_corner) else "fullframe",
            "hits": len(faces),
        }
cap.release()

with open(out_path, "w") as f:
    json.dump(result, f)

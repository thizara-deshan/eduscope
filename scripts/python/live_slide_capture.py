import os
import time
import shutil
import select
import sys
from datetime import datetime
from PIL import Image
import imagehash

# ---------------- CONFIG ----------------

SOURCE_IMAGE = "/home/edus/slides/current.png"
BASE_OUTPUT_DIR = "/home/edus/slide_sessions"

CAPTURE_INTERVAL = 1.0       # seconds
PHASH_THRESHOLD = 10         # 8–12 recommended for slides

# ----------------------------------------

os.makedirs(BASE_OUTPUT_DIR, exist_ok=True)

capturing = False
session_dir = None

last_candidate_path = None
last_hash = None
slide_index = 0

def compute_phash(path):
    img = Image.open(path).convert("RGB")
    img = img.resize((1280, 720))
    return imagehash.phash(img)

def finalize_last_slide():
    global last_candidate_path, slide_index

    if last_candidate_path and os.path.exists(last_candidate_path):
        slide_index += 1
        final_path = os.path.join(
            session_dir, f"slide_{slide_index:03d}.png"
        )
        shutil.move(last_candidate_path, final_path)
        print(f"[FINAL] slide_{slide_index:03d}.png saved")
        last_candidate_path = None

def start_session():
    global capturing, session_dir, slide_index
    global last_candidate_path, last_hash

    ts = datetime.now().strftime("%Y-%m-%d_%H-%M-%S")
    session_dir = os.path.join(BASE_OUTPUT_DIR, ts)
    os.makedirs(session_dir, exist_ok=True)
    # candidate frames live here, NOT in session_dir, so the OCR service never
    # sees them (that was the source of the junk frame_xxxxx.txt files)
    os.makedirs(os.path.join(session_dir, ".tmp"), exist_ok=True)

    slide_index = 0
    last_candidate_path = None
    last_hash = None
    capturing = True

    print(f"\n[START] Slide capture started")
    print(f"[DIR]   {session_dir}\n")

def end_session():
    global capturing
    finalize_last_slide()
    # remove leftover candidate frames
    try:
        tmpd = os.path.join(session_dir, ".tmp")
        if os.path.isdir(tmpd):
            shutil.rmtree(tmpd, ignore_errors=True)
    except Exception:
        pass
    capturing = False
    print("\n[END] Slide capture ended\n")

print("""
Controls:
  s + ENTER  → start slide capture
  e + ENTER  → end slide capture
""")

last_capture_time = 0

while True:
    # ---------- NON-BLOCKING KEY INPUT ----------
    if sys.stdin in select.select([sys.stdin], [], [], 0)[0]:
        cmd = sys.stdin.readline().strip().lower()
        if cmd == "s" and not capturing:
            start_session()
        elif cmd == "e" and capturing:
            end_session()

    # ---------- CAPTURE LOOP ----------
    if not capturing:
        time.sleep(0.1)
        continue

    now = time.time()
    if now - last_capture_time < CAPTURE_INTERVAL:
        time.sleep(0.05)
        continue
    last_capture_time = now

    if not os.path.exists(SOURCE_IMAGE):
        continue

    tmp_name = f"frame_{int(now)}.png"
    tmp_path = os.path.join(session_dir, ".tmp", tmp_name)

    try:
        shutil.copy(SOURCE_IMAGE, tmp_path)
    except Exception:
        continue

    try:
        curr_hash = compute_phash(tmp_path)
    except Exception:
        os.remove(tmp_path)
        continue

    if last_candidate_path is None:
        last_candidate_path = tmp_path
        last_hash = curr_hash
        continue

    distance = curr_hash - last_hash

    if distance <= PHASH_THRESHOLD:
        # Same slide (animation) → replace previous
        os.remove(last_candidate_path)
        last_candidate_path = tmp_path
        last_hash = curr_hash
        #print("[UPDATE] animation frame replaced")
    else:
        # New slide → finalize previous
        slide_index += 1
        final_path = os.path.join(
            session_dir, f"slide_{slide_index:03d}.png"
        )
        shutil.move(last_candidate_path, final_path)
        print(f"[SLIDE] slide_{slide_index:03d}.png saved")

        last_candidate_path = tmp_path
        last_hash = curr_hash

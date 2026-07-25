import os
import time
from PIL import Image
import pytesseract

BASE_DIR = "/home/edus/slide_sessions"

POLL_INTERVAL = 1

processed = set()
current_session = None


def newest_session():
    folders = [
        os.path.join(BASE_DIR, d)
        for d in os.listdir(BASE_DIR)
        if os.path.isdir(os.path.join(BASE_DIR, d))
    ]

    if not folders:
        return None

    folders.sort(key=os.path.getmtime)

    return folders[-1]


def normalize(text):
    return " ".join(text.split())


print("===== OCR Service Started =====")

while True:

    session = newest_session()

    if session is None:
        time.sleep(1)
        continue

    if session != current_session:
        current_session = session
        processed.clear()
        print(f"\nNew lecture session detected")
        print(current_session)

    # Only finalized slides. The capture tool writes temporary frame_<ts>.png
    # candidates; OCRing those produced the junk frame_xxxxx.txt files.
    pngs = sorted(
        f for f in os.listdir(current_session)
        if f.startswith("slide_") and f.endswith(".png")
    )

    for png in pngs:

        if png in processed:
            continue

        image_path = os.path.join(current_session, png)

        try:
            img = Image.open(image_path)
        except Exception:
            continue

        try:
            text = pytesseract.image_to_string(
                img,
                lang="eng",
                config="--oem 1 --psm 6"
            )
        except Exception as e:
            print(e)
            continue

        text = normalize(text)

        txt_path = os.path.splitext(image_path)[0] + ".txt"

        with open(txt_path, "w", encoding="utf-8") as f:
            f.write(text)

        print(f"OCR completed: {os.path.basename(txt_path)}")

        processed.add(png)

    time.sleep(POLL_INTERVAL)

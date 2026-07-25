import sounddevice as sd
import json
import queue
import time
import requests
import os
import threading
import numpy as np
from datetime import datetime
from vosk import Model, KaldiRecognizer

# ===================== MODE =====================
LECTURE_MODE = "short"

# ===================== AUDIO =====================

PREFERRED_DEVICE_NAME = "USB Audio Device"
STT_ALSA_CARD = 6   # STT uses card 6; card 7 (UMS) is GStreamer-only
CAPTURE_RATE = 44100      # microphone native rate
VOSK_RATE = 16000         # Vosk expected rate

# ===================== CONFIG =====================

MODEL_PATH = "/home/edus/vosk-models/vosk-model-en-us-0.22"
BLOCK_SIZE = 4410         # ~100ms @ 44.1k
MIN_WORDS_PER_SEGMENT = 3

if LECTURE_MODE == "short":
    SEND_INTERVAL_MIN = 4
    SILENCE_END_SECONDS = 240
    MIN_LECTURE_WORDS = 30
    LLM_OUTPUT_TOKENS = 256
    FINAL_SUMMARY_TOKENS = 384
else:
    SEND_INTERVAL_MIN = 15
    SILENCE_END_SECONDS = 120
    MIN_LECTURE_WORDS = 100
    LLM_OUTPUT_TOKENS = 384
    FINAL_SUMMARY_TOKENS = 512

SEND_INTERVAL_SEC = SEND_INTERVAL_MIN * 60

LLM_URL = "http://172.16.65.13:5000/completion"
LLM_MAX_WORDS = 900

SEGMENT_PROMPT = """
You are summarizing a lecture so far.

Write a clear cumulative summary using bullet points.

LECTURE:
{content}

SUMMARY:
"""

FINAL_PROMPT = """
You are summarizing a complete lecture.

Create a concise final summary.

LECTURE:
{content}

FINAL SUMMARY:
"""

STATE_IDLE = "IDLE"
STATE_ACTIVE = "ACTIVE"
STATE_ENDING = "ENDING"

state = STATE_IDLE
start_requested = False
stop_requested = False
# Bounded: during LLM calls the callback keeps producing. Unbounded growth was
# the 2-hour OOM. ~100 blocks/sec * 600 = ~60s of audio buffer max.
q = queue.Queue(maxsize=600)
HEARTBEAT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '.stt_heartbeat')


def find_input_device():
    devices = sd.query_devices()

    print("\nAvailable Input Devices")
    print("-----------------------")

    selected = None

    for i, d in enumerate(devices):
        if d["max_input_channels"] > 0:
            print(f"{i}: {d['name']}")

            if f"hw:{STT_ALSA_CARD}," in d["name"]:
                selected = i            # exact ALSA card 6 match wins
            elif PREFERRED_DEVICE_NAME in d["name"] and "UMS" not in d["name"] and selected is None:
                selected = i

    if selected is None:
        raise RuntimeError(f"Input device '{PREFERRED_DEVICE_NAME}' not found")

    print(f"\nUsing input device {selected}: {devices[selected]['name']}")
    return selected


INPUT_DEVICE = find_input_device()


def audio_callback(indata, frames, time_info, status):
    if status:
        print(status)

    audio = np.frombuffer(indata, dtype=np.int16)

    # simple 44.1k -> 16k resample
    new_len = int(len(audio) * VOSK_RATE / CAPTURE_RATE)
    if new_len <= 0:
        return

    audio16 = np.interp(
        np.linspace(0, len(audio) - 1, new_len),
        np.arange(len(audio)),
        audio
    ).astype(np.int16)

    try:
        q.put_nowait(audio16.tobytes())
    except queue.Full:
        try:
            q.get_nowait()      # drop oldest, keep newest
            q.put_nowait(audio16.tobytes())
        except Exception:
            pass


def word_count(text):
    return len(text.split())


def split_chunks(text, max_words):
    words = text.split()
    for i in range(0, len(words), max_words):
        yield " ".join(words[i:i + max_words])


def send_to_llm(prompt, max_tokens):
    payload = {
        "prompt": prompt,
        "n_predict": max_tokens,
        "temperature": 0.3
    }

    r = requests.post(LLM_URL, json=payload, timeout=120)
    return r.json().get("content", "").strip()


def summarize_async(lecture_text, fname, prompt_tpl, max_tokens):
    """Runs in a background thread so the audio consumer never stalls."""
    try:
        parts = []
        for chunk in split_chunks(lecture_text, LLM_MAX_WORDS):
            parts.append(send_to_llm(prompt_tpl.format(content=chunk), max_tokens))
        with open(fname, "w", encoding="utf-8") as f:
            f.write("\n".join(parts))
        print(f"[OK] Saved {fname}")
    except Exception as e:
        print(f"[WARN] summary failed: {e}")


def beat(state_name, session=None):
    """Heartbeat file the web panel reads to prove STT is alive."""
    try:
        with open(HEARTBEAT, "w", encoding="utf-8") as f:
            f.write(f"{time.time()}\n{state_name}\n{session or ''}\n")
    except Exception:
        pass


def keyboard_listener():
    global start_requested, stop_requested

    while True:
        key = input().strip().lower()

        if key == "s":
            start_requested = True

        elif key == "e":
            stop_requested = True


threading.Thread(target=keyboard_listener, daemon=True).start()

print("Loading Vosk model...")

model = Model(MODEL_PATH)
rec = KaldiRecognizer(model, VOSK_RATE)

rec.SetWords(False)
rec.SetPartialWords(False)
rec.SetMaxAlternatives(0)

print("🎤 System ready")
print("Press 's' + Enter to START a lecture")
print("Press 'e' + Enter to END the lecture")

with sd.RawInputStream(
    device=INPUT_DEVICE,
    samplerate=CAPTURE_RATE,
    blocksize=BLOCK_SIZE,
    dtype="int16",
    channels=1,
    callback=audio_callback
):
    while True:

        if state == STATE_IDLE:

            if start_requested:

                start_requested = False

                session_time = datetime.now().strftime("%Y-%m-%d_%H-%M-%S")

                session_dir = f"lecture_{session_time}"

                os.makedirs(session_dir, exist_ok=True)

                full_file = os.path.join(
                    session_dir,
                    "full_lecture.txt"
                )

                last_send = time.time()
                last_speech = time.time()
                summary_index = 1
                stop_requested = False

                print(f"\nLecture STARTED -> {session_dir}")
                beat("ACTIVE", session_dir)

                state = STATE_ACTIVE

            else:
                beat("IDLE")
                time.sleep(0.1)

        elif state == STATE_ACTIVE:

            now = time.time()

            if stop_requested or now - last_speech > SILENCE_END_SECONDS:
                state = STATE_ENDING
                continue

            beat("ACTIVE", session_dir)

            try:
                data = q.get(timeout=1.0)
            except queue.Empty:
                continue

            if rec.AcceptWaveform(data):

                result = json.loads(rec.Result())

                text = result.get("text", "").strip()

                if word_count(text) >= MIN_WORDS_PER_SEGMENT:

                    last_speech = time.time()

                    with open(full_file, "a", encoding="utf-8") as f:
                        f.write(text + " ")

            if now - last_send >= SEND_INTERVAL_SEC:

                with open(full_file, encoding="utf-8") as f:
                    lecture_text = f.read()

                if word_count(lecture_text) >= MIN_LECTURE_WORDS:
                    # Run the LLM in a BACKGROUND thread: previously this blocked
                    # the audio consumer for up to 120s, the queue filled, and
                    # memory grew until OOM (~2h). Now audio keeps draining.
                    fname = os.path.join(
                        session_dir,
                        f"summary_{summary_index * SEND_INTERVAL_MIN:02d}min.txt"
                    )
                    threading.Thread(
                        target=summarize_async,
                        args=(lecture_text, fname, SEGMENT_PROMPT, LLM_OUTPUT_TOKENS),
                        daemon=True,
                    ).start()
                    summary_index += 1

                last_send = now

        elif state == STATE_ENDING:

            print("Lecture ENDED -> generating final summary")
            beat("ENDING", session_dir)

            with open(full_file, encoding="utf-8") as f:
                full_text = f.read()

            final_parts = []

            for chunk in split_chunks(full_text, LLM_MAX_WORDS):

                final_parts.append(
                    send_to_llm(
                        FINAL_PROMPT.format(content=chunk),
                        FINAL_SUMMARY_TOKENS
                    )
                )

            with open(
                os.path.join(session_dir, "final_summary.txt"),
                "w",
                encoding="utf-8"
            ) as f:
                f.write("\n".join(final_parts))

            print("Lecture COMPLETED")
            beat("IDLE")

            state = STATE_IDLE

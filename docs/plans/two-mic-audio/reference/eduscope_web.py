#!/usr/bin/env python3
"""
Eduscope web control panel.
Runs on the Radxa; control from any laptop on the LAN:  http://172.16.65.15:8080

Keeps ALL original services (pub_rtsp, prev_rtsp, prev_composite, rec_composite ...)
and adds: cam2 publisher/preview, cam1+cam2 composite, single-camera + separate-file
recording, and the livestream pipelines.

  shm shell scripts  -> /home/shmpipe/   (auto-detected)
  python tools       -> home folder, each with its own venv:
        live_slide_capture.py  ~/slideshow_env/bin/python
        slide_ocrnew.py        ~/ocr_env/bin/python
        live_lecture_start.py  taskset -c 4-7 ~/live-lecture/bin/python

  ── NEW ── Audio mixer:
  pub_audio now runs pub_audio.py (mixes card 7 BOMGE + card 8 UMS -> /tmp/audio.sock,
  one software fader + one level meter per source). This panel shows the two meters
  and faders (Audio Mixer group) and proxies control to the mixer's local HTTP
  server on 127.0.0.1:8090 (see AUDIO_CTRL).
"""
import glob
import os
import signal
import subprocess
import threading
import time
import urllib.request                      # ── NEW ── proxy to the audio mixer
from flask import Flask, jsonify, render_template_string, request


HOME = os.path.expanduser("~")


def _find_dir(candidates, marker):
    for c in candidates:
        if os.path.isfile(os.path.join(c, marker)):
            return c
    return candidates[0]


SHM_DIR = _find_dir(
    [os.path.join(HOME, "shmpipe"), "/home/shmpipe",
     os.path.join(HOME, "eduscope_web"), os.path.dirname(os.path.abspath(__file__))],
    "pub_usb.sh")
PY_DIR = _find_dir([HOME, os.path.join(HOME, "eduscope_py")], "live_lecture_start.py")

SLIDE_PY = os.path.join(HOME, "slideshow_env", "bin", "python")
OCR_PY = os.path.join(HOME, "ocr_env", "bin", "python")
STT_PY = os.path.join(HOME, "live-lecture", "bin", "python")

LECTURE_ROOT = PY_DIR
SLIDE_SESSIONS = "/home/edus/slide_sessions"
SLIDES_DIR = "/home/edus/slides"
STT_HEARTBEAT = os.path.join(PY_DIR, ".stt_heartbeat")

# ── NEW ── where pub_audio.py's control/telemetry server listens
AUDIO_CTRL = os.environ.get("AUDIO_CTRL", "http://127.0.0.1:8090")

# runtime settings the UI can change (applied when a service is started)
SETTINGS = {"stream_key": "test", "ratio_a": "50", "ratio_b": "50"}

app = Flask(__name__)
procs = {}
errors = {}
lock = threading.Lock()


# ---- command builders -------------------------------------------------------
def _plain(script):
    """script with no arguments"""
    return lambda: ["bash", script]


def _py(script, python="python3"):          # ── NEW ── run a python tool
    """python script with no arguments (system python, needs python3-gi)"""
    return lambda: [python, script]


def _ratio(script):
    """script that takes  A B  (composite record/preview)"""
    return lambda: ["bash", script, SETTINGS["ratio_a"], SETTINGS["ratio_b"]]


def _live_key(script):
    """live script that takes  KEY"""
    return lambda: ["bash", script, SETTINGS["stream_key"]]


def _live_ratio_key(script):
    """live script that takes  A B KEY"""
    return lambda: ["bash", script, SETTINGS["ratio_a"], SETTINGS["ratio_b"],
                    SETTINGS["stream_key"]]


# name -> (cmd builder, cwd, needs_display, sends_keys, pgrep pattern)
SERVICES = {
    # ---------------- SOURCES ----------------
    "pub_usb":   (_plain("pub_usb.sh"),   SHM_DIR, False, False, "pub_usb.sh"),
    "pub_rtsp":  (_plain("pub_rtsp.sh"),  SHM_DIR, False, False, "pub_rtsp.sh"),
    "pub_rtsp2": (_plain("pub_rtsp2.sh"), SHM_DIR, False, False, "pub_rtsp2.sh"),   # NEW cam2
    # ── CHANGED ── mixes card 7 BOMGE + card 8 UMS (was pub_audio.sh: UMS only)
    "pub_audio": (_py("pub_audio.py"),    SHM_DIR, False, False, "pub_audio.py"),

    # ---------------- RECORDING ----------------
    # original
    "rec_composite": (_plain("rec_composite.sh"), SHM_DIR, False, False, "rec_composite.sh"),
    # new
    "rec_usb_cam1_5050":     (_ratio("rec_usb_cam1_5050.sh"),  SHM_DIR, False, False,
                              "rec_usb_cam1_5050.sh"),
    "rec_cam1_cam2_5050":    (_ratio("rec_cam1_cam2_5050.sh"), SHM_DIR, False, False,
                              "rec_cam1_cam2_5050.sh"),
    "rec_cam1":              (_plain("rec_cam1.sh"),           SHM_DIR, False, False,
                              "rec_cam1.sh"),
    "rec_cam2":              (_plain("rec_cam2.sh"),           SHM_DIR, False, False,
                              "rec_cam2.sh"),
    "rec_usb_cam1_separate": (_plain("rec_usb_cam1_separate.sh"), SHM_DIR, False, False,
                              "rec_usb_cam1_separate.sh"),

    # ---------------- PREVIEW ----------------
    # original
    "prev_usb":       (_plain("prev_usb.sh"),       SHM_DIR, True, False, "prev_usb.sh"),
    "prev_rtsp":      (_plain("prev_rtsp.sh"),      SHM_DIR, True, False, "prev_rtsp.sh"),
    "prev_composite": (_plain("prev_composite.sh"), SHM_DIR, True, False, "prev_composite.sh"),
    # new
    "prev_rtsp2":           (_plain("prev_rtsp2.sh"),           SHM_DIR, True, False,
                             "prev_rtsp2.sh"),
    "prev_cam1_cam2_5050":  (_ratio("prev_cam1_cam2_5050.sh"),  SHM_DIR, True, False,
                             "prev_cam1_cam2_5050.sh"),

    # ---------------- LIVE STREAM (local nginx for now) ----------------
    "live_cam1":           (_live_key("live_cam1.sh"),   SHM_DIR, False, False, "live_cam1.sh"),
    "live_cam2":           (_live_key("live_cam2.sh"),   SHM_DIR, False, False, "live_cam2.sh"),
    "live_usb":            (_live_key("live_usb.sh"),    SHM_DIR, False, False, "live_usb.sh"),
    "live_cam1_cam2_5050": (_live_ratio_key("live_cam1_cam2_5050.sh"), SHM_DIR, False, False,
                            "live_cam1_cam2_5050.sh"),
    "live_usb_cam1_5050":  (_live_ratio_key("live_usb_cam1_5050.sh"),  SHM_DIR, False, False,
                            "live_usb_cam1_5050.sh"),

    # ---------------- SLIDES / LECTURE ----------------
    "snap_slides": (_plain("snap_slides.sh"), SHM_DIR, False, False, "snap_slides.sh"),
    "slide_cap":   (lambda: [SLIDE_PY, "live_slide_capture.py"], PY_DIR, False, True,
                    "live_slide_capture.py"),
    "ocr":         (lambda: [OCR_PY, "slide_ocrnew.py"], PY_DIR, False, False,
                    "slide_ocrnew.py"),
    "stt":         (lambda: ["taskset", "-c", "4-7", STT_PY, "live_lecture_start.py"],
                    PY_DIR, False, True, "live_lecture_start.py"),
}

GROUPS = [
    ("Sources (start first)",
     ["pub_usb", "pub_rtsp", "pub_rtsp2", "pub_audio"]),
    ("Recording",
     ["rec_composite", "rec_usb_cam1_5050", "rec_cam1_cam2_5050",
      "rec_cam1", "rec_cam2", "rec_usb_cam1_separate"]),
    ("Preview",
     ["prev_usb", "prev_rtsp", "prev_rtsp2", "prev_composite", "prev_cam1_cam2_5050"]),
    ("Live stream",
     ["live_cam1", "live_cam2", "live_usb", "live_cam1_cam2_5050", "live_usb_cam1_5050"]),
    ("Slides / Lecture",
     ["snap_slides", "slide_cap", "ocr", "stt"]),
]

# services whose Start uses the ratio / key settings (shown as a hint in the UI)
USES_RATIO = {"rec_usb_cam1_5050", "rec_cam1_cam2_5050", "prev_cam1_cam2_5050",
              "live_cam1_cam2_5050", "live_usb_cam1_5050"}
USES_KEY = {"live_cam1", "live_cam2", "live_usb", "live_cam1_cam2_5050",
            "live_usb_cam1_5050"}


def _pgrep(pattern):
    try:
        r = subprocess.run(["pgrep", "-f", pattern],
                           stdout=subprocess.PIPE, stderr=subprocess.DEVNULL)
        return r.returncode == 0 and bool(r.stdout.strip())
    except Exception:
        return False


def is_running(name):
    p = procs.get(name)
    if p is not None and p.poll() is None:
        return True
    pat = SERVICES[name][4] if name in SERVICES else None
    return _pgrep(pat) if pat else False


def start(name):
    if name not in SERVICES or is_running(name):
        return
    build, cwd, needs_display, sends_keys, _pat = SERVICES[name]
    cmd = build()
    if not os.path.isdir(cwd):
        errors[name] = f"working dir not found: {cwd}"
        return
    env = dict(os.environ)
    if needs_display:
        env.setdefault("DISPLAY", ":0")
    try:
        p = subprocess.Popen(
            cmd, cwd=cwd, env=env,
            stdin=subprocess.PIPE if sends_keys else subprocess.DEVNULL,
            stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
            preexec_fn=os.setsid)
    except FileNotFoundError as e:
        errors[name] = f"cannot launch: {e}"
        return
    errors.pop(name, None)
    procs[name] = p
    if sends_keys and p.stdin:
        try:
            p.stdin.write(b"s\n")
            p.stdin.flush()
        except Exception:
            pass


def stop(name):
    if name not in SERVICES:
        return
    p = procs.get(name)
    _b, _c, _d, sends_keys, pat = SERVICES[name]
    if p and p.poll() is None:
        if sends_keys and p.stdin:
            try:
                p.stdin.write(b"e\n")
                p.stdin.flush()
            except Exception:
                pass
        try:
            os.killpg(os.getpgid(p.pid), signal.SIGINT)
            try:
                p.wait(timeout=6)
            except subprocess.TimeoutExpired:
                os.killpg(os.getpgid(p.pid), signal.SIGKILL)
        except ProcessLookupError:
            pass
    elif pat:
        # not started by this panel (or panel restarted) -> SIGINT by pattern so
        # gst-launch -e still finalises recordings cleanly
        subprocess.run(["pkill", "-INT", "-f", pat],
                       stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    procs.pop(name, None)


# ---------------- live status of the python tools ----------------

def _newest_dir(root, prefix=""):
    try:
        ds = [os.path.join(root, d) for d in os.listdir(root)
              if os.path.isdir(os.path.join(root, d)) and d.startswith(prefix)]
    except OSError:
        return None
    return max(ds, key=os.path.getmtime) if ds else None


def _fmt_age(path):
    try:
        dt = time.time() - os.path.getmtime(path)
    except OSError:
        return "?"
    if dt < 60:
        return f"{int(dt)}s ago"
    if dt < 3600:
        return f"{int(dt / 60)}m ago"
    return f"{int(dt / 3600)}h ago"


def _stt_heartbeat():
    try:
        raw = open(STT_HEARTBEAT, encoding="utf-8").read().split("\n")
        return (time.time() - float(raw[0].strip()),
                raw[1].strip() if len(raw) > 1 else "?")
    except Exception:
        return (None, None)


def detail_stt():
    age, hstate = _stt_heartbeat()
    if not is_running("stt"):
        health = "STOPPED"
    elif age is None:
        health = "starting..."
    elif age > 15:
        health = f"NOT RESPONDING ({int(age)}s)"
    else:
        health = f"OK ({hstate})"
    d = _newest_dir(LECTURE_ROOT, "lecture_")
    if not d:
        return {"health": health, "session": None, "info": "no session yet"}
    full = os.path.join(d, "full_lecture.txt")
    words = 0
    if os.path.isfile(full):
        try:
            words = len(open(full, encoding="utf-8").read().split())
        except OSError:
            pass
    return {"health": health, "session": os.path.basename(d), "words": words,
            "summaries": len(glob.glob(os.path.join(d, "summary_*min.txt"))),
            "final": os.path.isfile(os.path.join(d, "final_summary.txt")),
            "updated": _fmt_age(full) if os.path.isfile(full) else _fmt_age(d)}


def detail_slides():
    d = _newest_dir(SLIDE_SESSIONS)
    if not d:
        return {"session": None, "info": "no session yet"}
    pngs = glob.glob(os.path.join(d, "slide_*.png"))
    txts = glob.glob(os.path.join(d, "slide_*.txt"))
    newest = max(pngs, key=os.path.getmtime) if pngs else None
    return {"session": os.path.basename(d), "slides": len(pngs), "ocr_done": len(txts),
            "last_slide": os.path.basename(newest) if newest else None,
            "updated": _fmt_age(newest) if newest else _fmt_age(d)}


def detail_snapshot():
    cur = os.path.join(SLIDES_DIR, "current.png")
    return {"current.png": _fmt_age(cur)} if os.path.isfile(cur) else {"info": "none yet"}


PAGE = """
<!doctype html><html><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Eduscope Control</title>
<style>
 body{font-family:system-ui,Arial,sans-serif;margin:0;background:#0f1216;color:#e8eef5}
 header{padding:16px 20px;background:#151a21;font-size:20px;font-weight:600;border-bottom:1px solid #232a33}
 .group{padding:14px 20px;border-bottom:1px solid #1c222b}
 .group h3{margin:0 0 10px;font-size:13px;letter-spacing:.08em;text-transform:uppercase;color:#8aa0b6}
 .row{display:flex;flex-wrap:wrap;gap:10px}
 .svc{display:flex;align-items:center;gap:8px;background:#1a2029;border:1px solid #263140;border-radius:10px;padding:8px 10px}
 .dot{width:10px;height:10px;border-radius:50%;background:#556;transition:.2s;flex:none}
 .dot.on{background:#37d67a;box-shadow:0 0 8px #37d67a}
 .name{min-width:160px;font-size:14px}
 .tag{font-size:10px;color:#8aa0b6;border:1px solid #2c3846;border-radius:5px;padding:1px 5px}
 button{border:0;border-radius:8px;padding:7px 12px;font-size:13px;font-weight:600;cursor:pointer}
 .start{background:#1f6feb;color:#fff}.stop{background:#30363d;color:#e8eef5}
 .bar{padding:14px 20px}
 .allstop{background:#da3633;color:#fff;font-size:14px;padding:9px 16px}
 .cfg{display:flex;flex-wrap:wrap;gap:10px;align-items:center}
 .cfg input{background:#0f1216;border:1px solid #263140;color:#e8eef5;border-radius:8px;padding:7px 9px;font-size:13px}
 .cfg input.k{width:240px}.cfg input.r{width:58px}
 .detail{display:flex;flex-wrap:wrap;gap:12px}
 .card{background:#1a2029;border:1px solid #263140;border-radius:10px;padding:12px 14px;min-width:230px}
 .card h4{margin:0 0 8px;font-size:13px;color:#8aa0b6;text-transform:uppercase}
 .kv{display:flex;justify-content:space-between;font-size:13px;padding:2px 0;gap:14px}
 .muted{color:#7d8ba0}
 .err{color:#ff6b6b;font-size:12px}
 /* ── NEW ── audio mixer strips */
 .astrip{display:flex;align-items:center;gap:12px;margin-bottom:10px;flex-wrap:wrap}
 .alabel{min-width:120px;font-size:14px}
 .ameter{flex:1;height:14px;background:#0f1216;border:1px solid #263140;border-radius:7px;overflow:hidden;min-width:170px}
 .afill{height:100%;width:0%;background:linear-gradient(90deg,#37d67a,#37d67a 55%,#e9b44c 80%,#e5635b);transition:width .08s linear}
 .aslider{width:210px}
 .aval{min-width:52px;font-size:12px;text-align:right;color:#8aa0b6;font-variant-numeric:tabular-nums}
</style></head><body>
<header>Eduscope Control - 172.16.65.15</header>

<div class="group"><h3>Settings</h3>
 <div class="cfg">
   <span class="muted">stream key</span>
   <input class="k" id="key" placeholder="test">
   <span class="muted">ratio</span>
   <input class="r" id="ra" placeholder="50"> <span class="muted">/</span>
   <input class="r" id="rb" placeholder="50">
   <button class="start" onclick="saveCfg()">Apply</button>
   <span class="muted" id="cfgmsg"></span>
 </div>
 <div class="muted" style="font-size:12px;margin-top:8px">
   [key] services use the stream key; [ratio] services use A/B. Applied when you press
   Start. Streams publish to rtmp://127.0.0.1:1935/live/&lt;key&gt; on this board.
 </div>
</div>

<!-- ── NEW ── Audio Mixer: two faders + two post-fader meters -->
<div class="group"><h3>Audio Mixer</h3>
 <div class="astrip">
   <span class="alabel">BOMGE &middot; card 7</span>
   <div class="ameter"><div class="afill" id="mtr-bomge"></div></div>
   <input class="aslider" id="vol-bomge" type="range" min="0" max="150" step="1" value="100">
   <span class="aval" id="vol-bomge-val">100%</span>
 </div>
 <div class="astrip">
   <span class="alabel">UMS &middot; card 8</span>
   <div class="ameter"><div class="afill" id="mtr-ums"></div></div>
   <input class="aslider" id="vol-ums" type="range" min="0" max="150" step="1" value="100">
   <span class="aval" id="vol-ums-val">100%</span>
 </div>
 <div class="muted" id="audiostat" style="font-size:12px">audio mixer: checking...</div>
 <div class="muted" style="font-size:12px;margin-top:4px">
   Both sources are mixed into /tmp/audio.sock - the socket every record / preview / live
   pipeline reads. Sliders set each source's level; meters are post-fader and stay live
   while recording. Start <b>pub_audio</b> in Sources first.
 </div>
</div>

{% for title, names in groups %}
 <div class="group"><h3>{{title}}</h3><div class="row">
 {% for n in names %}
   <div class="svc"><span class="dot" id="dot-{{n}}"></span>
     <span class="name">{{n}}</span>
     {% if n in uses_ratio %}<span class="tag">ratio</span>{% endif %}
     {% if n in uses_key %}<span class="tag">key</span>{% endif %}
     <button class="start" onclick="act('{{n}}','start')">Start</button>
     <button class="stop"  onclick="act('{{n}}','stop')">Stop</button>
     <span class="err" id="err-{{n}}"></span>
   </div>
 {% endfor %}
 </div></div>
{% endfor %}

<div class="group"><h3>Live tool status</h3><div id="detail" class="detail">loading...</div></div>
<div class="bar"><button class="allstop" onclick="allstop()">STOP ALL</button></div>

<script>
async function refresh(){
  const s = await (await fetch('/status')).json();
  const run=s.running||{}, err=s.errors||{};
  for(const k in run){
    const d=document.getElementById('dot-'+k); if(d) d.classList.toggle('on', run[k]);
    const e=document.getElementById('err-'+k); if(e) e.textContent = err[k]||'';
  }
  const c=s.settings||{};
  const kf=document.getElementById('key');
  if(document.activeElement!==kf && kf.value==='') kf.value=c.stream_key||'';
  if(document.getElementById('ra').value==='') document.getElementById('ra').value=c.ratio_a||'50';
  if(document.getElementById('rb').value==='') document.getElementById('rb').value=c.ratio_b||'50';
}
async function act(n,a){ await fetch('/'+a+'/'+n,{method:'POST'}); setTimeout(refresh,300); }
async function allstop(){ await fetch('/stopall',{method:'POST'}); setTimeout(refresh,300); }
async function saveCfg(){
  const b={stream_key:document.getElementById('key').value||'test',
           ratio_a:document.getElementById('ra').value||'50',
           ratio_b:document.getElementById('rb').value||'50'};
  await fetch('/settings',{method:'POST',headers:{'Content-Type':'application/json'},
                           body:JSON.stringify(b)});
  document.getElementById('cfgmsg').textContent='saved';
  setTimeout(()=>document.getElementById('cfgmsg').textContent='',1500);
}

/* ── NEW ── audio mixer: post-fader meters + faders --------------------- */
function pctFromDb(db){
  if(db===null||db===undefined) return 0;
  if(db<=-60) return 0; if(db>0) db=0;
  return Math.round((db+60)/60*100);          /* -60..0 dB -> 0..100% */
}
var adrag={bomge:false, ums:false};
function setVol(ch,v){
  fetch('/audio/volume',{method:'POST',headers:{'Content-Type':'application/json'},
    body:JSON.stringify({ch:ch,value:v})}).catch(function(){});
}
function wireVol(ch){
  var sl=document.getElementById('vol-'+ch);
  var val=document.getElementById('vol-'+ch+'-val'); var t=null;
  sl.addEventListener('input',function(){
    adrag[ch]=true; val.textContent=sl.value+'%';
    clearTimeout(t); t=setTimeout(function(){ setVol(ch, sl.value/100); },120);
  });
  sl.addEventListener('change',function(){
    clearTimeout(t); setVol(ch, sl.value/100);
    setTimeout(function(){ adrag[ch]=false; },600);
  });
}
wireVol('bomge'); wireVol('ums');
async function refreshAudio(){
  var d; try{ d=await (await fetch('/audio/levels')).json(); }catch(e){ return; }
  var st=document.getElementById('audiostat');
  if(!d.running){
    st.textContent='audio mixer: not running - start pub_audio in Sources';
    document.getElementById('mtr-bomge').style.width='0%';
    document.getElementById('mtr-ums').style.width='0%';
    return;
  }
  st.textContent='audio mixer: running';
  document.getElementById('mtr-bomge').style.width=pctFromDb(d.bomge.peak)+'%';
  document.getElementById('mtr-ums').style.width=pctFromDb(d.ums.peak)+'%';
  if(!adrag.bomge){
    var sb=document.getElementById('vol-bomge'); sb.value=Math.round(d.bomge.vol*100);
    document.getElementById('vol-bomge-val').textContent=sb.value+'%';
  }
  if(!adrag.ums){
    var su=document.getElementById('vol-ums'); su.value=Math.round(d.ums.vol*100);
    document.getElementById('vol-ums-val').textContent=su.value+'%';
  }
}
setInterval(refreshAudio,150); refreshAudio();

function card(t,rows){let h='<div class="card"><h4>'+t+'</h4>';
  for(const [k,v] of rows) h+='<div class="kv"><span class="muted">'+k+'</span><b>'+v+'</b></div>';
  return h+'</div>';}
async function refreshDetail(){
  let d; try{ d=await (await fetch('/detail')).json(); }catch(e){ return; }
  const s=d.stt||{}, sl=d.slides||{}, sn=d.snapshot||{};
  const hc=(s.health||'').startsWith('OK')?'#37d67a':'#ff6b6b';
  const hh='<span style="color:'+hc+'">'+(s.health||'?')+'</span>';
  let h = s.session
    ? card('Lecture STT',[['health',hh],['session',s.session],['words',s.words],
        ['summaries',s.summaries],['final',s.final?'done':'-'],['updated',s.updated]])
    : card('Lecture STT',[['health',hh],['status',s.info||'idle']]);
  h += sl.session
    ? card('Slides + OCR',[['session',sl.session],['slides',sl.slides],
        ['OCR done',sl.ocr_done],['last',sl.last_slide||'-'],['updated',sl.updated]])
    : card('Slides + OCR',[['status',sl.info||'idle']]);
  h += card('Snapshot',[['current.png', sn['current.png']||sn.info||'-']]);
  document.getElementById('detail').innerHTML=h;
}
setInterval(refresh,2000); refresh();
setInterval(refreshDetail,3000); refreshDetail();
</script></body></html>
"""


@app.route("/")
def index():
    return render_template_string(PAGE, groups=GROUPS,
                                  uses_ratio=USES_RATIO, uses_key=USES_KEY)


@app.route("/status")
def status():
    with lock:
        return jsonify({"running": {n: is_running(n) for n in SERVICES},
                        "errors": dict(errors), "settings": SETTINGS,
                        "shm_dir": SHM_DIR, "py_dir": PY_DIR})


@app.route("/detail")
def detail():
    with lock:
        return jsonify({"stt": detail_stt(), "slides": detail_slides(),
                        "snapshot": detail_snapshot()})


# ── NEW ── audio mixer proxy: browser -> this panel -> pub_audio.py (127.0.0.1:8090)
@app.route("/audio/levels")
def audio_levels():
    try:
        with urllib.request.urlopen(AUDIO_CTRL + "/levels", timeout=0.5) as r:
            return (r.read(), 200, {"Content-Type": "application/json"})
    except Exception:
        return jsonify({"running": False})


@app.route("/audio/volume", methods=["POST"])
def audio_volume():
    body = request.get_data() or b"{}"
    try:
        req = urllib.request.Request(
            AUDIO_CTRL + "/volume", data=body,
            headers={"Content-Type": "application/json"}, method="POST")
        with urllib.request.urlopen(req, timeout=0.5) as r:
            return (r.read(), 200, {"Content-Type": "application/json"})
    except Exception as e:
        return jsonify({"ok": False, "error": str(e)}), 502


@app.route("/settings", methods=["POST"])
def r_settings():
    body = request.get_json(force=True, silent=True) or {}
    with lock:
        for k in ("stream_key", "ratio_a", "ratio_b"):
            if body.get(k):
                SETTINGS[k] = str(body[k]).strip()
    return jsonify(SETTINGS)


@app.route("/start/<name>", methods=["POST"])
def r_start(name):
    with lock:
        start(name)
    return ("", 204)


@app.route("/stop/<name>", methods=["POST"])
def r_stop(name):
    with lock:
        stop(name)
    return ("", 204)


@app.route("/stopall", methods=["POST"])
def r_stopall():
    with lock:
        for n in list(SERVICES):
            stop(n)
    return ("", 204)


if __name__ == "__main__":
    app.run(host="0.0.0.0", port=8080, threaded=True)

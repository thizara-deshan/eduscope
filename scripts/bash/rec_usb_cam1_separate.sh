#!/bin/bash
# Two SEPARATE files from one command:
#   usb_<ts>.ts   = USB HDMI + AUDIO   (audio belongs to the USB source)
#   cam1_<ts>.ts  = camera 1, H.264 passthrough (video only)
# To also put audio in the cam1 file: tee the aac branch into muxc as well.
TS=$(date +%Y%m%d_%H%M%S)
OUT_USB="${1:-usb_$TS.ts}"; OUT_CAM="${2:-cam1_$TS.ts}"
echo "REC separate -> $OUT_USB (with audio) + $OUT_CAM (video)"
gst-launch-1.0 -e \
  shmsrc socket-path=/tmp/usb.sock is-live=true do-timestamp=true ! \
    video/x-raw,format=NV12,width=1920,height=1080,framerate=60/1 ! \
    queue max-size-buffers=6 leaky=downstream ! \
    videorate drop-only=true ! video/x-raw,framerate=30/1 ! \
    mpph264enc bps=6000000 rc-mode=cbr gop=30 profile=high ! \
    h264parse config-interval=1 ! queue ! muxu. \
  shmsrc socket-path=/tmp/audio.sock is-live=true do-timestamp=true ! \
    audio/x-raw,format=S16LE,rate=48000,channels=2,layout=interleaved ! \
    queue ! audioconvert ! audioresample ! voaacenc bitrate=128000 ! aacparse ! queue ! muxu. \
  shmsrc socket-path=/tmp/rtsp.sock is-live=true do-timestamp=true ! \
    video/x-h264,stream-format=byte-stream,alignment=au,width=1920,height=1080,framerate=30/1 ! \
    h264parse ! queue ! muxc. \
  mpegtsmux name=muxu alignment=7 ! filesink location="$OUT_USB" \
  mpegtsmux name=muxc alignment=7 ! filesink location="$OUT_CAM"

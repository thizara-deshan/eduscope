#!/bin/bash
# 1 fps slide snapshots -> PNG. videoconvert normalizes the NV12 stride from shm
# (mppjpegenc read the raw stride wrong -> sheared/green-tear image). PNG is
# lossless = best for downstream OCR. CPU cost at 1fps is negligible.
mkdir -p /home/edus/slides
gst-launch-1.0 -e \
  shmsrc socket-path=/tmp/usb.sock is-live=true do-timestamp=true ! \
  video/x-raw,format=NV12,width=1920,height=1080,framerate=60/1 ! \
  videorate ! video/x-raw,framerate=1/1 ! \
  videoconvert ! video/x-raw,format=I420 ! \
  videoconvert ! pngenc ! multifilesink location=/home/edus/slides/current.png sync=false

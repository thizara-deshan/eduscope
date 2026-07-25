#!/bin/bash
rm -f /tmp/usb.sock
gst-launch-1.0 -e \
  v4l2src device=/dev/video1 io-mode=mmap do-timestamp=true ! \
  video/x-raw,format=NV12,width=1920,height=1080,framerate=60/1 ! \
  queue leaky=downstream max-size-buffers=4 ! \
  shmsink socket-path=/tmp/usb.sock shm-size=64000000 \
          wait-for-connection=false sync=false

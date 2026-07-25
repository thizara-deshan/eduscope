# 2-up compositor geometry, 1920x1080 canvas, 16:9 tiles, even dims.
# usage: eval $(ratio_layout 70 30) -> W0 H0 X0 Y0 W1 H1 X1 Y1
ratio_layout() {
  local a=${1:-50} b=${2:-50}
  local CW=1920 CH=1080
  local w0=$(( CW * a / (a + b) )); w0=$(( w0 - w0 % 2 ))
  local w1=$(( CW - w0 ));          w1=$(( w1 - w1 % 2 ))
  local h0=$(( w0 * 9 / 16 )); h0=$(( h0 - h0 % 2 ))
  local h1=$(( w1 * 9 / 16 )); h1=$(( h1 - h1 % 2 ))
  local y0=$(( (CH - h0) / 2 )); y0=$(( y0 - y0 % 2 ))
  local y1=$(( (CH - h1) / 2 )); y1=$(( y1 - y1 % 2 ))
  echo "W0=$w0 H0=$h0 X0=0 Y0=$y0 W1=$w1 H1=$h1 X1=$w0 Y1=$y1"
}
# common fragments
AUD_SHM='shmsrc socket-path=/tmp/audio.sock is-live=true do-timestamp=true ! audio/x-raw,format=S16LE,rate=48000,channels=2,layout=interleaved'
CAM1_SHM='shmsrc socket-path=/tmp/rtsp.sock is-live=true do-timestamp=true ! video/x-h264,stream-format=byte-stream,alignment=au,width=1920,height=1080,framerate=30/1'
CAM2_SHM='shmsrc socket-path=/tmp/rtsp2.sock is-live=true do-timestamp=true ! video/x-h264,stream-format=byte-stream,alignment=au,width=1920,height=1080,framerate=30/1'
USB_SHM='shmsrc socket-path=/tmp/usb.sock is-live=true do-timestamp=true ! video/x-raw,format=NV12,width=1920,height=1080,framerate=60/1'

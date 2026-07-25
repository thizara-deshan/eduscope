import { createRequire } from 'module';
const require = createRequire(import.meta.url);
import captureSetup from '../models/captureSetup.js';
const exec = require('child_process').exec
const shellExec = require('shell-exec')

// Cs
export const ApplyCs = async (req, res) => {

    try {
        var dataArr = Object.entries(req.body);
        let status = 200
        let message = 'updated'
        let allok = new Promise((resolve, reject) => {
            dataArr.forEach((data, index, array) => {
                captureSetup.updateById(req.params.id, data, (err, data) => {
                    if (err) {
                        if (err.kind === "not_found") {
                            status = 404
                            message = `Not found Setting with id ${req.params.id}.`
                        } else {
                            status = 500
                            message = "Error retrieving Setting with id " + req.params.id;
                        }
                    } else {

                    }
                    if (index === array.length - 1) resolve();

                });
            })

        })
        allok.then(() => {
            res.send({
                success: true,
                code: status,
                data: message
            });
        })

    } catch (err) {
        console.log(err);
        return res.status(500).json({
            message: "Unable to create captureSetup.",
            success: false
        });
    }
};

// get capture setup data
export const GetCs = (req, res, next) => {
    captureSetup.getAll(req.params.id, (err, data) => {
        if (err)
            res.status(500).send({
                message:
                    err.message || "Some error occurred"
            });
        else res.send(data);
    });
}

// v4l2 get devices list
export const GetDevices = (req, res, next) => {
    let devicearr = [];
    let stringval;
    if (req.params.types = 'video') {
        stringval = `v4l2-ctl --list-devices`;
    }
    shellExec(stringval).then((results) => {
        console.log(results);
        devicearr = results.stdout.split(/[\n(\t]/);

        devicearr.forEach((device, index) => {

            if (device.includes('xusb') || device.includes('/dev/video') || device == '') {
                console.log("gotcha", index);
                devicearr.splice(index, 1)
            }
        })
        devicearr = devicearr.filter(n => n);

        console.log(devicearr);
        res.status(200).json({
            message: "Successfull",
            success: true,
            data: devicearr
        });
    }).catch((err) => {
        console.log(err);
        res.status(409).json({
            message: "Error",
            success: false
        });
    })
}



var codeexec = function (code, callback) {
    var results = true
    console.log('---sss---', code);

    try {
        exec(code, (err, stdout, stderr) => {
            console.log("inside2");

            if (err !== null) {
                console.log(`exec error: ${err}`);
                results = false;
            } else {
                console.log("inside else");
                results = true;
            }
        })

    } catch (error) {
        results = false;
        console.log("on catch block------", error);
    }
    callback(results)
}


export const createSnaps = (req, res, next) => {
    console.log(req.params.status);
    console.log("inside snaps");
    let options = req.body;
    console.log(options);

    let rtsplink = options.datart.rtsplink;
    let rtsplink2 = options.datart.rtsplink2;

    let sources = options.data;

    let stringvalp1p1 = `gst-launch-1.0 -e v4l2src device=/dev/presentation ! tee name=t1 ! queue ! video/x-raw, width=1920, height=1080, framerate=60/1 ! videorate ! video/x-raw, width=1920, height=1080, framerate=2/1 ! videoconvert ! jpegenc ! jpegparse ! multifilesink location=presentation.jpg async=false t1. ! queue ! video/x-raw, width=1920, height=1080, framerate=60/1 ! videorate ! video/x-raw, width=1920, height=1080, framerate=2/1 ! videoconvert ! jpegenc ! jpegparse ! multifilesink location=presenter.jpg async=false`;
    let stringvalp1p2 = `gst-launch-1.0 -e v4l2src device=/dev/presentation ! tee name=t1 ! queue ! video/x-raw, width=1920, height=1080, framerate=60/1 ! videorate ! video/x-raw, width=1920, height=1080, framerate=2/1 ! videoconvert ! jpegenc ! jpegparse ! multifilesink location=presentation.jpg async=false v4l2src device=/dev/presenter ! tee name=t2 ! queue ! video/x-raw, width=1920, height=1080, framerate=30/1 ! videorate ! video/x-raw, width=1920, height=1080, framerate=2/1 ! videoconvert ! jpegenc ! jpegparse !  multifilesink location=presenter.jpg async=false`;
    let stringvalp2p1 = `gst-launch-1.0 -e v4l2src device=/dev/presenter ! tee name=t2 ! queue ! video/x-raw, width=1920, height=1080, framerate=30/1 ! videorate ! video/x-raw, width=1920, height=1080, framerate=2/1 ! videoconvert ! jpegenc ! jpegparse ! multifilesink location=presentation.jpg async=false v4l2src device=/dev/presentation ! tee name=t1 ! queue ! video/x-raw, width=1920, height=1080, framerate=60/1 ! videorate ! video/x-raw, width=1920, height=1080, framerate=2/1 ! videoconvert ! jpegenc ! jpegparse ! multifilesink location=presenter.jpg async=false`;
    let stringvalp2p2 = `gst-launch-1.0 -e v4l2src device=/dev/presenter ! tee name=t2 ! queue ! video/x-raw, width=1920, height=1080, framerate=30/1 ! videorate ! video/x-raw, width=1920, height=1080, framerate=2/1 ! videoconvert ! jpegenc ! jpegparse ! multifilesink location=presentation.jpg async=false t2. ! queue ! video/x-raw, width=1920, height=1080, framerate=30/1 ! videorate ! video/x-raw, width=1920, height=1080, framerate=2/1 ! videoconvert ! jpegenc ! jpegparse ! multifilesink location=presenter.jpg async=false`;
    let stringvalp1ex = `gst-launch-1.0 -e v4l2src device=/dev/presentation ! tee name=t1 ! queue ! video/x-raw, width=1920, height=1080, framerate=60/1 ! videorate ! video/x-raw, width=1920, height=1080, framerate=2/1 ! videoconvert ! jpegenc ! jpegparse ! multifilesink location=presentation.jpg async=false v4l2src device=/dev/exCAM io-mode=2 ! tee name=t3 ! queue ! image/jpeg,width=1920,height=1080,framerate=30/1 ! videorate ! image/jpeg,width=1920,height=1080,framerate=2/1 ! jpegparse ! multifilesink location=presenter.jpg async=false`;
    let stringvalp2ex = `gst-launch-1.0 -e v4l2src device=/dev/presenter ! tee name=t2 ! queue ! video/x-raw, width=1920, height=1080, framerate=30/1 ! videorate ! video/x-raw, width=1920, height=1080, framerate=2/1 ! videoconvert ! jpegenc ! jpegparse ! multifilesink location=presentation.jpg async=false v4l2src device=/dev/exCAM io-mode=2 ! tee name=t3 ! queue ! image/jpeg,width=1920,height=1080,framerate=30/1 ! videorate ! image/jpeg,width=1920,height=1080,framerate=2/1 ! jpegparse !  multifilesink location=presenter.jpg async=false`;

    let stringvalp1rt = `gst-launch-1.0 -e v4l2src device=/dev/presentation ! tee name=t1 ! queue ! video/x-raw, width=1920, height=1080, framerate=60/1 ! videorate ! video/x-raw, width=1920, height=1080, framerate=2/1 ! videoconvert ! jpegenc ! jpegparse ! multifilesink location=presentation.jpg async=false rtspsrc location=${rtsplink} latency=0 ! application/x-rtp, media=video, encoding-name=H264 ! rtph264depay ! queue ! h264parse ! queue ! nvv4l2decoder ! nvvidconv ! queue ! "video/x-raw(memory:NVMM),width=1920,height=1080,format=NV12" ! nvvidconv ! "video/x-raw(memory:NVMM),format=I420" ! videorate ! "video/x-raw(memory:NVMM),framerate=2/1" ! nvjpegenc ! jpegparse ! queue ! multifilesink location=presenter.jpg async=false`;
    let stringvalp2rt = `gst-launch-1.0 -e v4l2src device=/dev/presenter ! tee name=t2 ! queue ! video/x-raw, width=1920, height=1080, framerate=30/1 ! videorate ! video/x-raw, width=1920, height=1080, framerate=2/1 ! videoconvert ! jpegenc ! jpegparse ! multifilesink location=presentation.jpg async=false rtspsrc location=${rtsplink} latency=0 ! application/x-rtp, media=video, encoding-name=H264 ! rtph264depay ! queue ! h264parse ! queue ! nvv4l2decoder ! nvvidconv ! queue ! "video/x-raw(memory:NVMM),width=1920,height=1080,format=NV12" ! nvvidconv ! "video/x-raw(memory:NVMM),format=I420" ! videorate ! "video/x-raw(memory:NVMM),framerate=2/1" ! nvjpegenc ! jpegparse ! queue ! multifilesink location=presenter.jpg async=false`;
    let stringvalrtrt = `gst-launch-1.0 -e rtspsrc location=${rtsplink} latency=0 ! application/x-rtp, media=video, encoding-name=H264 ! rtph264depay ! queue ! h264parse ! queue ! nvv4l2decoder ! nvvidconv ! queue ! "video/x-raw(memory:NVMM),width=1920,height=1080,format=NV12" ! nvvidconv ! "video/x-raw(memory:NVMM),format=I420" ! videorate ! "video/x-raw(memory:NVMM),framerate=2/1" ! nvjpegenc ! jpegparse ! tee name=t2 ! queue ! multifilesink location=presentation.jpg async=false t2. ! multifilesink location=presenter.jpg async=false`;
    let stringvalrtex = `gst-launch-1.0 -e rtspsrc location=${rtsplink} latency=0 ! application/x-rtp, media=video, encoding-name=H264 ! rtph264depay ! queue ! h264parse ! queue ! nvv4l2decoder ! nvvidconv ! queue ! "video/x-raw(memory:NVMM),width=1920,height=1080,format=NV12" ! nvvidconv ! "video/x-raw(memory:NVMM),format=I420" ! videorate ! "video/x-raw(memory:NVMM),framerate=2/1" ! nvjpegenc ! jpegparse ! queue ! multifilesink location=presentation.jpg async=false v4l2src device=/dev/exCAM io-mode=2 ! tee name=t3 ! queue ! image/jpeg,width=1920,height=1080,framerate=30/1 ! videorate ! image/jpeg,width=1920,height=1080,framerate=2/1 ! jpegparse !  multifilesink location=presenter.jpg async=false`;
    let stringvalrtp2 = `gst-launch-1.0 -e rtspsrc location=${rtsplink} latency=0 ! application/x-rtp, media=video, encoding-name=H264 ! rtph264depay ! queue ! h264parse ! queue ! nvv4l2decoder ! nvvidconv ! queue ! "video/x-raw(memory:NVMM),width=1920,height=1080,format=NV12" ! nvvidconv ! "video/x-raw(memory:NVMM),format=I420" ! videorate ! "video/x-raw(memory:NVMM),framerate=2/1" ! nvjpegenc ! jpegparse ! queue ! multifilesink location=presentation.jpg async=false v4l2src device=/dev/presenter ! tee name=t2 ! queue ! video/x-raw, width=1920, height=1080, framerate=30/1 ! videorate ! video/x-raw, width=1920, height=1080, framerate=2/1 ! videoconvert ! jpegenc ! jpegparse !  multifilesink location=presenter.jpg async=false`;
    let stringvalrtp1 = `gst-launch-1.0 -e rtspsrc location=${rtsplink} latency=0 ! application/x-rtp, media=video, encoding-name=H264 ! rtph264depay ! queue ! h264parse ! queue ! nvv4l2decoder ! nvvidconv ! queue ! "video/x-raw(memory:NVMM),width=1920,height=1080,format=NV12" ! nvvidconv ! "video/x-raw(memory:NVMM),format=I420" ! videorate ! "video/x-raw(memory:NVMM),framerate=2/1" ! nvjpegenc ! jpegparse ! queue ! multifilesink location=presentation.jpg async=false v4l2src device=/dev/presentation ! tee name=t1 ! queue ! video/x-raw, width=1920, height=1080, framerate=60/1 ! videorate ! video/x-raw, width=1920, height=1080, framerate=2/1 ! videoconvert ! jpegenc ! jpegparse ! multifilesink location=presenter.jpg async=false`;

    let stringvalp1rt2 = `gst-launch-1.0 -e v4l2src device=/dev/presentation ! queue ! queue ! video/x-raw, width=1920, height=1080, framerate=60/1 ! videorate ! video/x-raw, width=1920, height=1080, framerate=1/1 ! jpegenc ! jpegparse ! multifilesink location=presentation.jpg async=false rtspsrc location=${rtsplink2} latency=0 ! application/x-rtp, media=video, encoding-name=H264 ! rtph264depay ! queue ! h264parse ! queue ! nvv4l2decoder ! nvvidconv ! queue ! "video/x-raw(memory:NVMM),width=1920,height=1080,format=NV12" ! nvvidconv ! "video/x-raw(memory:NVMM),format=I420" ! videorate ! "video/x-raw(memory:NVMM),framerate=1/1" ! nvjpegenc ! jpegparse ! queue ! multifilesink location=presenter.jpg async=false`;
    let stringvalp2rt2 = `gst-launch-1.0 -e v4l2src device=/dev/presenter ! tee name=t2 ! queue ! video/x-raw, width=1920, height=1080, framerate=30/1 ! videorate ! video/x-raw, width=1920, height=1080, framerate=2/1 ! videoconvert ! jpegenc ! jpegparse ! multifilesink location=presentation.jpg async=false rtspsrc location=${rtsplink2} latency=0 ! application/x-rtp, media=video, encoding-name=H264 ! rtph264depay ! queue ! h264parse ! queue ! nvv4l2decoder ! nvvidconv ! queue ! "video/x-raw(memory:NVMM),width=1920,height=1080,format=NV12" ! nvvidconv ! "video/x-raw(memory:NVMM),format=I420" ! videorate ! "video/x-raw(memory:NVMM),framerate=2/1" ! nvjpegenc ! jpegparse ! queue ! multifilesink location=presenter.jpg async=false`;
    let stringvalrt2p1 = `gst-launch-1.0 -e v4l2src device=/dev/presentation ! queue ! queue ! video/x-raw, width=1920, height=1080, framerate=60/1 ! videorate ! video/x-raw, width=1920, height=1080, framerate=1/1 ! jpegenc ! jpegparse ! multifilesink location=presenter.jpg async=false rtspsrc location=${rtsplink2} latency=0 ! application/x-rtp, media=video, encoding-name=H264 ! rtph264depay ! queue ! h264parse ! queue ! nvv4l2decoder ! nvvidconv ! queue ! "video/x-raw(memory:NVMM),width=1920,height=1080,format=NV12" ! nvvidconv ! "video/x-raw(memory:NVMM),format=I420" ! videorate ! "video/x-raw(memory:NVMM),framerate=1/1" ! nvjpegenc ! jpegparse ! queue ! multifilesink location=presentation.jpg async=false`;
    let stringvalrt2p2 = `gst-launch-1.0 -e rtspsrc location=${rtsplink2} latency=0 ! application/x-rtp, media=video, encoding-name=H264 ! rtph264depay ! queue ! h264parse ! queue ! nvv4l2decoder ! nvvidconv ! queue ! "video/x-raw(memory:NVMM),width=1920,height=1080,format=NV12" ! nvvidconv ! "video/x-raw(memory:NVMM),format=I420" ! videorate ! "video/x-raw(memory:NVMM),framerate=2/1" ! nvjpegenc ! jpegparse ! queue ! multifilesink location=presentation.jpg async=false v4l2src device=/dev/presenter ! tee name=t2 ! queue ! video/x-raw, width=1920, height=1080, framerate=30/1 ! videorate ! video/x-raw, width=1920, height=1080, framerate=2/1 ! videoconvert ! jpegenc ! jpegparse !  multifilesink location=presenter.jpg async=false`;
    let stringvalrt1rt2 = `gst-launch-1.0 -e rtspsrc location=${rtsplink} latency=0 ! application/x-rtp, media=video, encoding-name=H264 ! rtph264depay ! queue ! h264parse ! queue ! nvv4l2decoder ! nvvidconv ! queue ! "video/x-raw(memory:NVMM),width=1920,height=1080,format=NV12" ! nvvidconv ! "video/x-raw(memory:NVMM),format=I420" ! videorate ! "video/x-raw(memory:NVMM),framerate=1/1" ! nvjpegenc ! jpegparse ! queue ! multifilesink location=presentation.jpg async=false rtspsrc location=${rtsplink2} latency=0 ! application/x-rtp, media=video, encoding-name=H264 ! rtph264depay ! queue ! h264parse ! queue ! nvv4l2decoder ! nvvidconv ! queue ! "video/x-raw(memory:NVMM),width=1920,height=1080,format=NV12" ! nvvidconv ! "video/x-raw(memory:NVMM),format=I420" ! videorate ! "video/x-raw(memory:NVMM),framerate=1/1" ! nvjpegenc ! jpegparse ! queue ! multifilesink location=presenter.jpg async=false`
    let stringvalrt2rt1 = `gst-launch-1.0 -e rtspsrc location=${rtsplink2} latency=0 ! application/x-rtp, media=video, encoding-name=H264 ! rtph264depay ! queue ! h264parse ! queue ! nvv4l2decoder ! nvvidconv ! queue ! "video/x-raw(memory:NVMM),width=1920,height=1080,format=NV12" ! nvvidconv ! "video/x-raw(memory:NVMM),format=I420" ! videorate ! "video/x-raw(memory:NVMM),framerate=1/1" ! nvjpegenc ! jpegparse ! queue ! multifilesink location=presentation.jpg async=false rtspsrc location=${rtsplink} latency=0 ! application/x-rtp, media=video, encoding-name=H264 ! rtph264depay ! queue ! h264parse ! queue ! nvv4l2decoder ! nvvidconv ! queue ! "video/x-raw(memory:NVMM),width=1920,height=1080,format=NV12" ! nvvidconv ! "video/x-raw(memory:NVMM),format=I420" ! videorate ! "video/x-raw(memory:NVMM),framerate=1/1" ! nvjpegenc ! jpegparse ! queue ! multifilesink location=presenter.jpg async=false`
    let stringvalrt2ex = `gst-launch-1.0 -e rtspsrc location=${rtsplink2} latency=0 ! application/x-rtp, media=video, encoding-name=H264 ! rtph264depay ! queue ! h264parse ! queue ! nvv4l2decoder ! nvvidconv ! queue ! "video/x-raw(memory:NVMM),width=1920,height=1080,format=NV12" ! nvvidconv ! "video/x-raw(memory:NVMM),format=I420" ! videorate ! "video/x-raw(memory:NVMM),framerate=2/1" ! nvjpegenc ! jpegparse ! queue ! multifilesink location=presentation.jpg async=false v4l2src device=/dev/exCAM io-mode=2 ! tee name=t3 ! queue ! image/jpeg,width=1920,height=1080,framerate=30/1 ! videorate ! image/jpeg,width=1920,height=1080,framerate=2/1 ! jpegparse !  multifilesink location=presenter.jpg async=false`;

    let stringval;
    console.log('source----', sources);
    console.log('src1----', sources[0]);

    sources.forEach((source, index) => {
        if (source == "hdmisource") {
            sources[index] = 'p1'
        } else if (source == "sdisource") {
            sources[index] = 'p2'
        } else if (source == "rtsp") {
            sources[index] = 'rtsp'
        } else if (source == "rtsp2") {
            sources[index] = 'rtsp2'
        } else {
            sources[index] = 'excam'
        }
    })

    if (sources[0] == 'p1' && sources[1] == 'p1') { stringval = stringvalp1p1 }
    else if (sources[0] == 'p1' && sources[1] == 'p2') { stringval = stringvalp1p2 }
    else if (sources[0] == 'p2' && sources[1] == 'p1') { stringval = stringvalp2p1 }
    else if (sources[0] == 'p2' && sources[1] == 'p2') { stringval = stringvalp2p2 }
    else if (sources[0] == 'p1' && sources[1] == 'excam') { stringval = stringvalp1ex }
    else if (sources[0] == 'p2' && sources[1] == 'excam') { stringval = stringvalp2ex }
    else if (sources[0] == 'p1' && sources[1] == 'rtsp') { stringval = stringvalp1rt }
    else if (sources[0] == 'p2' && sources[1] == 'rtsp') { stringval = stringvalp2rt }
    else if (sources[0] == 'rtsp' && sources[1] == 'rtsp') { stringval = stringvalrtrt }
    else if (sources[0] == 'rtsp' && sources[1] == 'excam') { stringval = stringvalrtex }
    else if (sources[0] == 'rtsp' && sources[1] == 'p1') { stringval = stringvalrtp1 }
    else if (sources[0] == 'rtsp' && sources[1] == 'p2') { stringval = stringvalrtp2 }
    else if (sources[0] == 'p1' && sources[1] == 'rtsp2') { stringval = stringvalp1rt2 }
    else if (sources[0] == 'p2' && sources[1] == 'rtsp2') { stringval = stringvalp2rt2 }
    else if (sources[0] == 'rtsp2' && sources[1] == 'p1') { stringval = stringvalrt2p1 }
    else if (sources[0] == 'rtsp2' && sources[1] == 'p2') { stringval = stringvalrt2p2 }
    else if (sources[0] == 'rtsp' && sources[1] == 'rtsp2') { stringval = stringvalrt1rt2 }
    else if (sources[0] == 'rtsp2' && sources[1] == 'rtsp') { stringval = stringvalrt2rt1 }
    else if (sources[0] == 'rtsp2' && sources[1] == 'excam') { stringval = stringvalrt2ex }

    codeexec(stringval, function (results) {
        console.log(results);
        if (results) {

            res.status(200).json({
                message: "Successfull",
                success: true
            });
        } else {
            res.status(409).json({
                message: "Error",
                success: false
            });
        }
    })

}


export const changeSnaps = (req, res, next) => {
    console.log(req.params.source);
    console.log("inside snaps");
    let options = req.body;
    console.log(options);

    let rtsplink = options.rtspOptions.rtsplink;
    let rtsplink2 = options.rtspOptions.rtsplink2;

    let sources = options.data;

    let stringvalp1p1 = `gst-launch-1.0 -e v4l2src device=/dev/presentation ! tee name=t1 ! queue ! video/x-raw, width=1920, height=1080, framerate=60/1 ! videorate ! video/x-raw, width=1920, height=1080, framerate=2/1 ! videoconvert ! jpegenc ! jpegparse ! multifilesink location=presentation.jpg async=false t1. ! queue ! video/x-raw, width=1920, height=1080, framerate=60/1 ! videorate ! video/x-raw, width=1920, height=1080, framerate=2/1 ! videoconvert ! jpegenc ! jpegparse ! multifilesink location=presenter.jpg async=false`;
    let stringvalp1p2 = `gst-launch-1.0 -e v4l2src device=/dev/presentation ! tee name=t1 ! queue ! video/x-raw, width=1920, height=1080, framerate=60/1 ! videorate ! video/x-raw, width=1920, height=1080, framerate=2/1 ! videoconvert ! jpegenc ! jpegparse ! multifilesink location=presentation.jpg async=false v4l2src device=/dev/presenter ! tee name=t2 ! queue ! video/x-raw, width=1920, height=1080, framerate=30/1 ! videorate ! video/x-raw, width=1920, height=1080, framerate=2/1 ! videoconvert ! jpegenc ! jpegparse !  multifilesink location=presenter.jpg async=false`;
    let stringvalp2p1 = `gst-launch-1.0 -e v4l2src device=/dev/presenter ! tee name=t2 ! queue ! video/x-raw, width=1920, height=1080, framerate=30/1 ! videorate ! video/x-raw, width=1920, height=1080, framerate=2/1 ! videoconvert ! jpegenc ! jpegparse ! multifilesink location=presentation.jpg async=false v4l2src device=/dev/presentation ! tee name=t1 ! queue ! video/x-raw, width=1920, height=1080, framerate=60/1 ! videorate ! video/x-raw, width=1920, height=1080, framerate=2/1 ! videoconvert ! jpegenc ! jpegparse ! multifilesink location=presenter.jpg async=false `;
    let stringvalp2p2 = `gst-launch-1.0 -e v4l2src device=/dev/presenter ! tee name=t2 ! queue ! video/x-raw, width=1920, height=1080, framerate=30/1 ! videorate ! video/x-raw, width=1920, height=1080, framerate=2/1 ! videoconvert ! jpegenc ! jpegparse ! multifilesink location=presentation.jpg async=false t2. ! queue ! video/x-raw, width=1920, height=1080, framerate=30/1 ! videorate ! video/x-raw, width=1920, height=1080, framerate=2/1 ! videoconvert ! jpegenc ! jpegparse ! multifilesink location=presenter.jpg async=false`;
    let stringvalp1ex = `gst-launch-1.0 -e v4l2src device=/dev/presentation ! tee name=t1 ! queue ! video/x-raw, width=1920, height=1080, framerate=60/1 ! videorate ! video/x-raw, width=1920, height=1080, framerate=2/1 ! videoconvert ! jpegenc ! jpegparse ! multifilesink location=presentation.jpg async=false v4l2src device=/dev/exCAM io-mode=2 ! tee name=t3 ! queue ! image/jpeg,width=1920,height=1080,framerate=30/1 ! videorate ! image/jpeg,width=1920,height=1080,framerate=2/1 ! jpegparse ! multifilesink location=presenter.jpg async=false`;
    let stringvalp2ex = `gst-launch-1.0 -e v4l2src device=/dev/presenter ! tee name=t2 ! queue ! video/x-raw, width=1920, height=1080, framerate=30/1 ! videorate ! video/x-raw, width=1920, height=1080, framerate=2/1 ! videoconvert ! jpegenc ! jpegparse ! multifilesink location=presentation.jpg async=false v4l2src device=/dev/exCAM io-mode=2 ! tee name=t3 ! queue ! image/jpeg,width=1920,height=1080,framerate=30/1 ! videorate ! image/jpeg,width=1920,height=1080,framerate=2/1 ! jpegparse !  multifilesink location=presenter.jpg async=false`;

    let stringvalp1rt = `gst-launch-1.0 -e v4l2src device=/dev/presentation ! tee name=t1 ! queue ! video/x-raw, width=1920, height=1080, framerate=60/1 ! videorate ! video/x-raw, width=1920, height=1080, framerate=2/1 ! videoconvert ! jpegenc ! jpegparse ! multifilesink location=presentation.jpg async=false rtspsrc location=${rtsplink} latency=0 ! application/x-rtp, media=video, encoding-name=H264 ! rtph264depay ! queue ! h264parse ! queue ! nvv4l2decoder ! nvvidconv ! queue ! "video/x-raw(memory:NVMM),width=1920,height=1080,format=NV12" ! nvvidconv ! "video/x-raw(memory:NVMM),format=I420" ! videorate ! "video/x-raw(memory:NVMM),framerate=2/1" ! nvjpegenc ! jpegparse ! queue ! multifilesink location=presenter.jpg async=false`;
    let stringvalp2rt = `gst-launch-1.0 -e v4l2src device=/dev/presenter ! tee name=t2 ! queue ! video/x-raw, width=1920, height=1080, framerate=30/1 ! videorate ! video/x-raw, width=1920, height=1080, framerate=2/1 ! videoconvert ! jpegenc ! jpegparse ! multifilesink location=presentation.jpg async=false rtspsrc location=${rtsplink} latency=0 ! application/x-rtp, media=video, encoding-name=H264 ! rtph264depay ! queue ! h264parse ! queue ! nvv4l2decoder ! nvvidconv ! queue ! "video/x-raw(memory:NVMM),width=1920,height=1080,format=NV12" ! nvvidconv ! "video/x-raw(memory:NVMM),format=I420" ! videorate ! "video/x-raw(memory:NVMM),framerate=2/1" ! nvjpegenc ! jpegparse ! queue ! multifilesink location=presenter.jpg async=false`;
    let stringvalrtrt = `gst-launch-1.0 -e rtspsrc location=${rtsplink} latency=0 ! application/x-rtp, media=video, encoding-name=H264 ! rtph264depay ! queue ! h264parse ! queue ! nvv4l2decoder ! nvvidconv ! queue ! "video/x-raw(memory:NVMM),width=1920,height=1080,format=NV12" ! nvvidconv ! "video/x-raw(memory:NVMM),format=I420" ! videorate ! "video/x-raw(memory:NVMM),framerate=2/1" ! nvjpegenc ! jpegparse ! tee name=t2 ! queue ! multifilesink location=presentation.jpg async=false t2. ! multifilesink location=presenter.jpg async=false`;
    let stringvalrtex = `gst-launch-1.0 -e rtspsrc location=${rtsplink} latency=0 ! application/x-rtp, media=video, encoding-name=H264 ! rtph264depay ! queue ! h264parse ! queue ! nvv4l2decoder ! nvvidconv ! queue ! "video/x-raw(memory:NVMM),width=1920,height=1080,format=NV12" ! nvvidconv ! "video/x-raw(memory:NVMM),format=I420" ! videorate ! "video/x-raw(memory:NVMM),framerate=2/1" ! nvjpegenc ! jpegparse ! queue ! multifilesink location=presentation.jpg async=false v4l2src device=/dev/exCAM io-mode=2 ! tee name=t3 ! queue ! image/jpeg,width=1920,height=1080,framerate=30/1 ! videorate ! image/jpeg,width=1920,height=1080,framerate=2/1 ! jpegparse !  multifilesink location=presenter.jpg async=false`;
    let stringvalrtp2 = `gst-launch-1.0 -e rtspsrc location=${rtsplink} latency=0 ! application/x-rtp, media=video, encoding-name=H264 ! rtph264depay ! queue ! h264parse ! queue ! nvv4l2decoder ! nvvidconv ! queue ! "video/x-raw(memory:NVMM),width=1920,height=1080,format=NV12" ! nvvidconv ! "video/x-raw(memory:NVMM),format=I420" ! videorate ! "video/x-raw(memory:NVMM),framerate=2/1" ! nvjpegenc ! jpegparse ! queue ! multifilesink location=presentation.jpg async=false v4l2src device=/dev/presenter ! tee name=t2 ! queue ! video/x-raw, width=1920, height=1080, framerate=30/1 ! videorate ! video/x-raw, width=1920, height=1080, framerate=2/1 ! videoconvert ! jpegenc ! jpegparse !  multifilesink location=presenter.jpg async=false`;
    let stringvalrtp1 = `gst-launch-1.0 -e rtspsrc location=${rtsplink} latency=0 ! application/x-rtp, media=video, encoding-name=H264 ! rtph264depay ! queue ! h264parse ! queue ! nvv4l2decoder ! nvvidconv ! queue ! "video/x-raw(memory:NVMM),width=1920,height=1080,format=NV12" ! nvvidconv ! "video/x-raw(memory:NVMM),format=I420" ! videorate ! "video/x-raw(memory:NVMM),framerate=2/1" ! nvjpegenc ! jpegparse ! queue ! multifilesink location=presentation.jpg async=false v4l2src device=/dev/presentation ! tee name=t1 ! queue ! video/x-raw, width=1920, height=1080, framerate=60/1 ! videorate ! video/x-raw, width=1920, height=1080, framerate=2/1 ! videoconvert ! jpegenc ! jpegparse ! multifilesink location=presenter.jpg async=false`;

    let stringvalp1rt2 = `gst-launch-1.0 -e v4l2src device=/dev/presentation ! queue ! queue ! video/x-raw, width=1920, height=1080, framerate=60/1 ! videorate ! video/x-raw, width=1920, height=1080, framerate=1/1 ! jpegenc ! jpegparse ! multifilesink location=presentation.jpg async=false rtspsrc location=${rtsplink2} latency=0 ! application/x-rtp, media=video, encoding-name=H264 ! rtph264depay ! queue ! h264parse ! queue ! nvv4l2decoder ! nvvidconv ! queue ! "video/x-raw(memory:NVMM),width=1920,height=1080,format=NV12" ! nvvidconv ! "video/x-raw(memory:NVMM),format=I420" ! videorate ! "video/x-raw(memory:NVMM),framerate=1/1" ! nvjpegenc ! jpegparse ! queue ! multifilesink location=presenter.jpg async=false`;
    let stringvalp2rt2 = `gst-launch-1.0 -e v4l2src device=/dev/presenter ! tee name=t2 ! queue ! video/x-raw, width=1920, height=1080, framerate=30/1 ! videorate ! video/x-raw, width=1920, height=1080, framerate=2/1 ! videoconvert ! jpegenc ! jpegparse ! multifilesink location=presentation.jpg async=false rtspsrc location=${rtsplink2} latency=0 ! application/x-rtp, media=video, encoding-name=H264 ! rtph264depay ! queue ! h264parse ! queue ! nvv4l2decoder ! nvvidconv ! queue ! "video/x-raw(memory:NVMM),width=1920,height=1080,format=NV12" ! nvvidconv ! "video/x-raw(memory:NVMM),format=I420" ! videorate ! "video/x-raw(memory:NVMM),framerate=2/1" ! nvjpegenc ! jpegparse ! queue ! multifilesink location=presenter.jpg async=false`;
    let stringvalrt2p1 = `gst-launch-1.0 -e v4l2src device=/dev/presentation ! queue ! queue ! video/x-raw, width=1920, height=1080, framerate=60/1 ! videorate ! video/x-raw, width=1920, height=1080, framerate=1/1 ! jpegenc ! jpegparse ! multifilesink location=presenter.jpg async=false rtspsrc location=${rtsplink2} latency=0 ! application/x-rtp, media=video, encoding-name=H264 ! rtph264depay ! queue ! h264parse ! queue ! nvv4l2decoder ! nvvidconv ! queue ! "video/x-raw(memory:NVMM),width=1920,height=1080,format=NV12" ! nvvidconv ! "video/x-raw(memory:NVMM),format=I420" ! videorate ! "video/x-raw(memory:NVMM),framerate=1/1" ! nvjpegenc ! jpegparse ! queue ! multifilesink location=presentation.jpg async=false`;
    let stringvalrt2p2 = `gst-launch-1.0 -e rtspsrc location=${rtsplink2} latency=0 ! application/x-rtp, media=video, encoding-name=H264 ! rtph264depay ! queue ! h264parse ! queue ! nvv4l2decoder ! nvvidconv ! queue ! "video/x-raw(memory:NVMM),width=1920,height=1080,format=NV12" ! nvvidconv ! "video/x-raw(memory:NVMM),format=I420" ! videorate ! "video/x-raw(memory:NVMM),framerate=2/1" ! nvjpegenc ! jpegparse ! queue ! multifilesink location=presentation.jpg async=false v4l2src device=/dev/presenter ! tee name=t2 ! queue ! video/x-raw, width=1920, height=1080, framerate=30/1 ! videorate ! video/x-raw, width=1920, height=1080, framerate=2/1 ! videoconvert ! jpegenc ! jpegparse !  multifilesink location=presenter.jpg async=false`;
    let stringvalrt1rt2 = `gst-launch-1.0 -e rtspsrc location=${rtsplink} latency=0 ! application/x-rtp, media=video, encoding-name=H264 ! rtph264depay ! queue ! h264parse ! queue ! nvv4l2decoder ! nvvidconv ! queue ! "video/x-raw(memory:NVMM),width=1920,height=1080,format=NV12" ! nvvidconv ! "video/x-raw(memory:NVMM),format=I420" ! videorate ! "video/x-raw(memory:NVMM),framerate=1/1" ! nvjpegenc ! jpegparse ! queue ! multifilesink location=presentation.jpg async=false rtspsrc location=${rtsplink2} latency=0 ! application/x-rtp, media=video, encoding-name=H264 ! rtph264depay ! queue ! h264parse ! queue ! nvv4l2decoder ! nvvidconv ! queue ! "video/x-raw(memory:NVMM),width=1920,height=1080,format=NV12" ! nvvidconv ! "video/x-raw(memory:NVMM),format=I420" ! videorate ! "video/x-raw(memory:NVMM),framerate=1/1" ! nvjpegenc ! jpegparse ! queue ! multifilesink location=presenter.jpg async=false`
    let stringvalrt2rt1 = `gst-launch-1.0 -e rtspsrc location=${rtsplink2} latency=0 ! application/x-rtp, media=video, encoding-name=H264 ! rtph264depay ! queue ! h264parse ! queue ! nvv4l2decoder ! nvvidconv ! queue ! "video/x-raw(memory:NVMM),width=1920,height=1080,format=NV12" ! nvvidconv ! "video/x-raw(memory:NVMM),format=I420" ! videorate ! "video/x-raw(memory:NVMM),framerate=1/1" ! nvjpegenc ! jpegparse ! queue ! multifilesink location=presentation.jpg async=false rtspsrc location=${rtsplink} latency=0 ! application/x-rtp, media=video, encoding-name=H264 ! rtph264depay ! queue ! h264parse ! queue ! nvv4l2decoder ! nvvidconv ! queue ! "video/x-raw(memory:NVMM),width=1920,height=1080,format=NV12" ! nvvidconv ! "video/x-raw(memory:NVMM),format=I420" ! videorate ! "video/x-raw(memory:NVMM),framerate=1/1" ! nvjpegenc ! jpegparse ! queue ! multifilesink location=presenter.jpg async=false`
    let stringvalrt2ex = `gst-launch-1.0 -e rtspsrc location=${rtsplink2} latency=0 ! application/x-rtp, media=video, encoding-name=H264 ! rtph264depay ! queue ! h264parse ! queue ! nvv4l2decoder ! nvvidconv ! queue ! "video/x-raw(memory:NVMM),width=1920,height=1080,format=NV12" ! nvvidconv ! "video/x-raw(memory:NVMM),format=I420" ! videorate ! "video/x-raw(memory:NVMM),framerate=2/1" ! nvjpegenc ! jpegparse ! queue ! multifilesink location=presentation.jpg async=false v4l2src device=/dev/exCAM io-mode=2 ! tee name=t3 ! queue ! image/jpeg,width=1920,height=1080,framerate=30/1 ! videorate ! image/jpeg,width=1920,height=1080,framerate=2/1 ! jpegparse !  multifilesink location=presenter.jpg async=false`;

    let stringval;
    console.log('source----', sources);
    console.log('src1----', sources[0]);

    if (sources[0] == 'p1' && sources[1] == 'p1') { stringval = stringvalp1p1 }
    else if (sources[0] == 'p1' && sources[1] == 'p2') { stringval = stringvalp1p2 }
    else if (sources[0] == 'p2' && sources[1] == 'p1') { stringval = stringvalp2p1 }
    else if (sources[0] == 'p2' && sources[1] == 'p2') { stringval = stringvalp2p2 }
    else if (sources[0] == 'p1' && sources[1] == 'excam') { stringval = stringvalp1ex }
    else if (sources[0] == 'p2' && sources[1] == 'excam') { stringval = stringvalp2ex }
    else if (sources[0] == 'p1' && sources[1] == 'rtsp') { stringval = stringvalp1rt }
    else if (sources[0] == 'p2' && sources[1] == 'rtsp') { stringval = stringvalp2rt }
    else if (sources[0] == 'rtsp' && sources[1] == 'rtsp') { stringval = stringvalrtrt }
    else if (sources[0] == 'rtsp' && sources[1] == 'excam') { stringval = stringvalrtex }
    else if (sources[0] == 'rtsp' && sources[1] == 'p1') { stringval = stringvalrtp1 }
    else if (sources[0] == 'p1' && sources[1] == 'rtsp2') { stringval = stringvalp1rt2 }
    else if (sources[0] == 'p2' && sources[1] == 'rtsp2') { stringval = stringvalp2rt2 }
    else if (sources[0] == 'rtsp2' && sources[1] == 'p1') { stringval = stringvalrt2p1 }
    else if (sources[0] == 'rtsp2' && sources[1] == 'p2') { stringval = stringvalrt2p2 }
    else if (sources[0] == 'rtsp' && sources[1] == 'rtsp2') { stringval = stringvalrt1rt2 }
    else if (sources[0] == 'rtsp2' && sources[1] == 'rtsp') { stringval = stringvalrt2rt1 }
    else if (sources[0] == 'rtsp2' && sources[1] == 'excam') { stringval = stringvalrt2ex }
    console.log("test1");

    codeexec('sudo killall -SIGINT gst-launch-1.0', function (results) {
        console.log(results);
        if (results) {
            setTimeout(() => startcmd(), 4500)

        } else {
            res.status(409).json({
                message: "Error",
                success: false
            });
        }
    })

    const startcmd = () => {
        codeexec(stringval, (results) => {
            console.log('blink start', results);
            res.status(200).json({
                message: "Successfull",
                success: true
            });
        })
    }

}
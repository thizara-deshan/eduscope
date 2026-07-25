import { createRequire } from 'module';

import moment from 'moment'

import sql from "../models/db.js"

const require = createRequire(import.meta.url);

const crypto = require('crypto')

const shellExec = require('shell-exec')

const { NginxConfFile } = require("nginx-conf");

// import nginx conf file
const filenamenginx = '/etc/nginx/nginx.conf';

// import piplines
import * as pipes from '../pipelines/pipelines.js'

// import database models
import recordStatus from '../models/recstatus.js';
import VideoQueue from '../models/videoQueue.js';

var isError = false;

export const isErrorFunc = async (req, res) => {
    if (isError) {
        return res.status(200).json({
            message: "Successfull",
            success: true
        });
    } else {
        return res.status(409).json({
            message: "Error",
            success: false
        });
    }
};

// Get recording Status (Started or Not)
export const checkStatus = async (req, res) => {
    recordStatus.findById('1', (err, data) => {
        if (err)
            res.status(500).send({
                message:
                    err.message || "Some error occurred"
            });
        else res.send(data);
    });
};

// Update recording Status (Started or Not)
export const updateRecStatus = async (req, res) => {
    let recid = req.body.id;
    let recst = req.body.status;
    recordStatus.updateById(recid, recst, (err, data) => {
        if (err)
            res.status(500).send({
                message:
                    err.message || "Some error occurred"
            });
        else res.send(data);
    });
};

// Update pauseval in record_status table
export const updatePauseStatus = async (req, res) => {
    let recid = req.body.id;
    recordStatus.updatePauseById(recid, (err, data) => {
        if (err)
            res.status(500).send({
                message:
                    err.message || "Some error occurred"
            });
        else res.send(data);
    });
};

// Update groupid in last row of video_queue table
export const updateGroupID = async (req, res) => {
    let groupid = await crypto.randomBytes(10).toString('hex');
    VideoQueue.updateVidQGroupId(groupid, (err, data) => {
        if (err)
            res.status(500).send({
                message:
                    err.message || "Some error occurred"
            });
        else res.send(data);
    });
};

var codeexec = function (code, callback) {
    console.log("excecuting code... ", code);
    var results = true
    isError = false
    try {
        shellExec(code)
    } catch (error) {
        results = false;
        console.log("on catch block------", error);
    }
    callback(results)
}

let hdduuid = await query_promise();

// queru function
function query_promise() {
    return new Promise((resolve, reject) => {
        sql.query('select value from hdd_id where id=1', async (err, res) => {
            if (err) {
                console.log("error on update status of record: ", err);
                return reject(err);
            }
            console.log("data: ", res[0].value.split('/').pop());
            resolve(res[0].value.split('/').pop());
        });
    });
}


export let filename = 'a';
export let fpsp1 = 'a';
export let fpsp2 = 'a';
export let bitrate = 'a';
export let ampval_mic = 'a';
export let ampval_hdmi = 'a';
export let rtsplink = 'a';
export let rtsplink2 = 'a';

let updated_at;
let updated_at_now;
let groupid;
let groupid2;

// Record Start Function
export const ShellStart = async (req, res) => {
    console.log("rec start...");
    let options = req.body;

    // Get option values
    const csp1 = options.csOptions.presentation_source;
    const csp2 = options.csOptions.presenter_source;
    const lsp1 = options.lsOptions.presentation_source;
    const lsp2 = options.lsOptions.presenter_source;
    const lmcp1 = options.lmcOptions.presentation_source;
    const lmcp2 = options.lmcOptions.presenter_source;

    let width, height;

    // Set resolution
    if (options.resolution == '1080') {
        width = '1920'
        height = '1080'
    } if (options.resolution == '720') {
        width = '1280'
        height = '720'
    }

    fpsp1 = options.frpresentation
    fpsp2 = options.frpresenter
    bitrate = options.bitrate;

    let stringval, a1, a2, amix, a1g, a2g;
    ampval_mic = options.csOptions.audio1_gain;
    ampval_hdmi = options.csOptions.audio2_gain;
    rtsplink = options.rtspOptions.rtsplink;
    rtsplink2 = options.rtspOptions.rtsplink2;

    updated_at = moment().format('YYYY~MM~DD~h~mm~ss~a').toString();
    updated_at_now = moment();

    const userid = options.userid;

    filename = `${options.module}~${options.topic}~${options.lecture_hall}~${userid}~${updated_at}`;
    filename = filename.replace(/:/g, '-');

    if (options.csOptions.audioin_source == '11b95257a3755f703160cce39a32c76048bad417c3977f018db6ea6bc1cc6861') { a2 = 'presentationAud' }
    else if (options.csOptions.audioin_source == 'a634919b7eaca83429c0404f0da9204774e1b9b715da1106e9b7832047c5c7f5') { a2 = 'presenterAud' }

    // Separate Files, 50/50 Preview, 50/50 stream 
    let stval_sf_50_50_yuyv = `gst-launch-1.0 -e v4l2src device=/dev/presentation ! queue ! tee name=t1 ! video/x-raw, width=1920, height=1080, framerate=60/1 ! videorate ! video/x-raw, width=1920, height=1080, framerate=${fpsp1}/1 ! nvvidconv ! queue ! nvv4l2h264enc maxperf-enable=1 bitrate=${bitrate} profile=4 ! queue ! h264parse ! queue ! mux. liveadder name=mix1 ! queue ! audioconvert ! voaacenc ! mux. alsasrc device="hw:externAud,0" ! queue ! audio/x-raw ! queue ! audioresample ! "audio/x-raw,rate=48000" ! tee name=a1 ! queue ! mix1.sink_0 alsasrc device="hw:channel1,0" ! queue ! audio/x-raw ! queue ! audioresample ! "audio/x-raw,rate=48000" ! tee name=a2 ! queue ! mix1.sink_1 mpegtsmux name=mux ! filesink location='/media/${hdduuid}/record-ts/${filename}~1.ts' v4l2src device=/dev/presenter ! tee name=t2 ! queue ! video/x-raw, width=1920, height=1080, framerate=30/1 ! videorate ! video/x-raw, width=1920, height=1080, framerate=${fpsp2}/1 ! nvvidconv ! queue ! "video/x-raw(memory:NVMM),width=1920,height=1080,format=NV12" ! nvv4l2h264enc maxperf-enable=1 bitrate=${bitrate} profile=4 ! queue ! h264parse ! queue ! mpegtsmux ! filesink location='/media/${hdduuid}/record-ts/${filename}~2.ts' videotestsrc pattern=black ! video/x-raw,width=320,height=240 ! nvvidconv ! queue ! comp.sink_0 t1. ! video/x-raw, width=1920, height=1080, framerate=60/1 ! videorate ! video/x-raw, width=1920, height=1080, framerate=${fpsp1}/1 ! queue ! nvvidconv ! queue ! "video/x-raw(memory:NVMM),width=960,height=540,format=NV12" ! queue ! comp.sink_1 t2. ! queue ! video/x-raw, width=1920, height=1080, framerate=30/1 ! videorate ! video/x-raw, width=1920, height=1080, framerate=${fpsp2}/1 ! nvvidconv ! queue ! "video/x-raw(memory:NVMM),width=960,height=540,format=NV12" ! queue ! comp.sink_2 nvcompositor name=comp sink_0::width=1920 sink_0::height=1080 sink_1::xpos=0 sink_1::ypos=270 sink_1::width=960 sink_1::height=540  sink_2::xpos=960 sink_2::ypos=270 sink_2::width=960 sink_2::height=540 ! tee name=t3 ! queue ! nvvidconv ! queue ! nvv4l2h264enc maxperf-enable=1 bitrate=${bitrate} profile=4 ! queue ! h264parse ! queue ! mux3. liveadder name=mixer ! voaacenc ! queue ! mux3. a1. ! queue ! mixer.sink_0 a2. ! queue ! mixer.sink_1 flvmux name=mux3 ! rtmpsink location="rtmp://localhost/live" t3. ! nvvidconv ! nvoverlaysink liveadder name=mix ! queue ! audioconvert ! audioresample ! "audio/x-raw,rate=48000,channels=2,format=S16LE" ! alsasink device="hw:0,3" sync=false async=false a1. ! queue ! mix.sink_0 a2. ! queue ! mix.sink_1 t1. ! queue ! video/x-raw, width=1920, height=1080, framerate=60/1 ! videorate ! video/x-raw, width=1920, height=1080, framerate=1/1 ! jpegenc !  jpegparse ! multifilesink location=p1.jpg async=false t2. ! queue ! video/x-raw, width=1920, height=1080, framerate=30/1 ! videorate ! video/x-raw, width=1920, height=1080, framerate=1/1 ! jpegenc ! jpegparse ! multifilesink location=p2.jpg async=false liveadder name=mix4 ! queue ! audioconvert ! audioresample ! "audio/x-raw,rate=48000,channels=2,format=S16LE" ! alsasink device="hw:externAud,0" sync=false async=false a1. ! queue ! mix4.sink_0 a2. ! queue ! mix4.sink_1`;

    let stval_sf_50_50_mjpg = `gst-launch-1.0 -e v4l2src device=/dev/presentation ! queue ! tee name=t1 ! video/x-raw, width=1920, height=1080, framerate=60/1 ! videorate ! video/x-raw, width=1920, height=1080, framerate=${fpsp1}/1 ! nvvidconv ! queue ! nvv4l2h264enc maxperf-enable=1 bitrate=${bitrate} profile=4 ! queue ! h264parse ! queue ! mux. liveadder name=mix1 ! queue ! audioconvert ! voaacenc ! mux. alsasrc device="hw:externAud,0" ! queue ! audio/x-raw ! queue ! audioresample ! "audio/x-raw,rate=48000" ! tee name=a1 ! queue ! mix1.sink_0 alsasrc device="hw:channel1,0" ! queue ! audio/x-raw ! queue ! audioresample ! "audio/x-raw,rate=48000" ! tee name=a2 ! queue ! mix1.sink_1 mpegtsmux name=mux ! filesink location='/media/${hdduuid}/record-ts/${filename}~1.ts' v4l2src device=/dev/exCAM io-mode=2 ! tee name=t2 ! queue ! image/jpeg,width=1920,height=1080,framerate=30/1 ! videorate ! image/jpeg,width=1920,height=1080,framerate=${fpsp2}/1 ! jpegparse ! nvv4l2decoder mjpeg=1 ! nvvidconv ! queue ! "video/x-raw(memory:NVMM),width=1920,height=1080,format=NV12" ! nvv4l2h264enc maxperf-enable=1 bitrate=${bitrate} profile=4 ! queue ! h264parse ! queue ! mpegtsmux ! filesink location='/media/${hdduuid}/record-ts/${filename}~2.ts' videotestsrc pattern=black ! video/x-raw,width=320,height=240 ! nvvidconv ! queue ! comp.sink_0 t1. ! video/x-raw, width=1920, height=1080, framerate=60/1 ! videorate ! video/x-raw, width=1920, height=1080, framerate=${fpsp1}/1 ! queue ! nvvidconv ! queue ! "video/x-raw(memory:NVMM),width=960,height=540,format=NV12" ! queue ! comp.sink_1 t2. ! queue ! image/jpeg,width=1920,height=1080,framerate=30/1 ! videorate ! image/jpeg,width=1920,height=1080,framerate=${fpsp2}/1 ! jpegparse ! nvv4l2decoder mjpeg=1 ! nvvidconv ! queue ! "video/x-raw(memory:NVMM),width=960,height=540,format=NV12" ! queue ! comp.sink_2 nvcompositor name=comp sink_0::width=1920 sink_0::height=1080 sink_1::xpos=0 sink_1::ypos=270 sink_1::width=960 sink_1::height=540  sink_2::xpos=960 sink_2::ypos=270 sink_2::width=960 sink_2::height=540 ! tee name=t3 ! queue ! nvvidconv ! queue ! nvv4l2h264enc maxperf-enable=1 bitrate=${bitrate} profile=4 ! queue ! h264parse ! queue ! mux3. liveadder name=mixer ! voaacenc ! queue ! mux3. a1. ! queue ! mixer.sink_0 a2. ! queue ! mixer.sink_1 flvmux name=mux3 ! rtmpsink location="rtmp://localhost/live" t3. ! nvvidconv ! nvoverlaysink liveadder name=mix ! queue ! audioconvert ! audioresample ! "audio/x-raw,rate=48000,channels=2,format=S16LE" ! alsasink device="hw:0,3" sync=false async=false a1. ! queue ! mix.sink_0 a2. ! queue ! mix.sink_1 t1. ! queue ! video/x-raw, width=1920, height=1080, framerate=60/1 ! videorate ! video/x-raw, width=1920, height=1080, framerate=1/1 ! jpegenc ! jpegparse ! multifilesink location=p1.jpg async=false t2. ! queue !  image/jpeg,width=1920,height=1080,framerate=30/1 ! videorate ! image/jpeg,width=1920,height=1080,framerate=1/1 ! jpegparse !  multifilesink location=p2.jpg async=false liveadder name=mix4 ! queue ! audioconvert ! audioresample ! "audio/x-raw,rate=48000,channels=2,format=S16LE" ! alsasink device="hw:externAud,0" sync=false async=false a1. ! queue ! mix4.sink_0 a2. ! queue ! mix4.sink_1`;

    // SP-p1-p2/ex 50/50sdiusb 50/50sdiusb 01-10
    let stval_sfp1p2_50_50_p2_ex_yuyv = `gst-launch-1.0 -e v4l2src device=/dev/presentation ! queue ! tee name=t1 ! video/x-raw, width=1920, height=1080, framerate=60/1 ! videorate ! video/x-raw, width=1920, height=1080, framerate=${fpsp1}/1 ! nvvidconv ! queue ! nvv4l2h264enc maxperf-enable=1 bitrate=${bitrate} profile=4 ! queue ! h264parse ! queue ! mux. liveadder name=mix1 ! queue ! audioconvert ! voaacenc ! mux. alsasrc device="hw:externAud,0" ! queue ! audio/x-raw ! queue ! audioresample ! "audio/x-raw,rate=48000" ! tee name=a1 ! queue ! mix1.sink_0 alsasrc device="hw:channel1,0" ! queue ! audio/x-raw ! queue ! audioresample ! "audio/x-raw,rate=48000" ! tee name=a2 ! queue ! mix1.sink_1 mpegtsmux name=mux ! filesink location='/media/${hdduuid}/record-ts/${filename}~1.ts' v4l2src device=/dev/presenter ! tee name=t2 ! queue ! video/x-raw, width=1920, height=1080, framerate=30/1 ! videorate ! video/x-raw, width=1920, height=1080, framerate=${fpsp2}/1 ! nvvidconv ! queue ! "video/x-raw(memory:NVMM),width=1920,height=1080,format=NV12" ! nvv4l2h264enc maxperf-enable=1 bitrate=${bitrate} profile=4 ! queue ! h264parse ! queue ! mpegtsmux ! filesink location='/media/${hdduuid}/record-ts/${filename}~2.ts' videotestsrc pattern=black ! video/x-raw,width=320,height=240 ! nvvidconv ! queue ! comp.sink_0 t2. ! video/x-raw, width=1920, height=1080, framerate=30/1 ! videorate ! video/x-raw, width=1920, height=1080, framerate=30/1 ! queue ! nvvidconv ! queue ! "video/x-raw(memory:NVMM),width=960,height=540,format=NV12" ! queue ! comp.sink_1 v4l2src device=/dev/exCAM io-mode=2 ! tee name=t4 ! queue ! image/jpeg,width=1920,height=1080,framerate=30/1 ! videorate ! image/jpeg,width=1920,height=1080,framerate=${fpsp2}/1 ! jpegparse ! nvv4l2decoder mjpeg=1 ! nvvidconv ! queue ! "video/x-raw(memory:NVMM),width=960,height=540,format=NV12" ! queue ! comp.sink_2 nvcompositor name=comp sink_0::width=1920 sink_0::height=1080 sink_1::xpos=0 sink_1::ypos=270 sink_1::width=960 sink_1::height=540  sink_2::xpos=960 sink_2::ypos=270 sink_2::width=960 sink_2::height=540 ! tee name=t3 ! queue ! nvvidconv ! queue ! nvv4l2h264enc maxperf-enable=1 bitrate=${bitrate} profile=4 ! queue ! h264parse ! queue ! mux3. liveadder name=mixer ! voaacenc ! queue ! mux3. a1. ! queue ! mixer.sink_0 a2. ! queue ! mixer.sink_1 flvmux name=mux3 ! rtmpsink location="rtmp://localhost/live" t3. ! nvvidconv ! nvoverlaysink liveadder name=mix ! queue ! audioconvert ! audioresample ! "audio/x-raw,rate=48000,channels=2,format=S16LE" ! alsasink device="hw:0,3" sync=false async=false a1. ! queue ! mix.sink_0 a2. ! queue ! mix.sink_1 t1. ! queue ! video/x-raw, width=1920, height=1080, framerate=60/1 ! videorate ! video/x-raw, width=1920, height=1080, framerate=1/1 ! jpegenc ! jpegparse ! multifilesink location=p1.jpg async=false t2. ! queue ! video/x-raw, width=1920, height=1080, framerate=30/1 ! videorate ! video/x-raw, width=1920, height=1080, framerate=1/1 ! jpegenc ! jpegparse ! multifilesink location=p2.jpg async=false liveadder name=mix4 ! queue ! audioconvert ! audioresample ! "audio/x-raw,rate=48000,channels=2,format=S16LE" ! alsasink device="hw:externAud,0" sync=false async=false a1. ! queue ! mix4.sink_0 a2. ! queue ! mix4.sink_1`;
    let stval_sfp1ex_50_50_p2_ex_mjpg = `gst-launch-1.0 -e v4l2src device=/dev/presentation ! queue ! tee name=t1 ! video/x-raw, width=1920, height=1080, framerate=60/1 ! videorate ! video/x-raw, width=1920, height=1080, framerate=${fpsp1}/1 ! nvvidconv ! queue ! nvv4l2h264enc maxperf-enable=1 bitrate=${bitrate} profile=4 ! queue ! h264parse ! queue ! mux. liveadder name=mix1 ! queue ! audioconvert ! voaacenc ! mux. alsasrc device="hw:externAud,0" ! queue ! audio/x-raw ! queue ! audioresample ! "audio/x-raw,rate=48000" ! tee name=a1 ! queue ! mix1.sink_0 alsasrc device="hw:channel1,0" ! queue ! audio/x-raw ! queue ! audioresample ! "audio/x-raw,rate=48000" ! tee name=a2 ! queue ! mix1.sink_1 mpegtsmux name=mux ! filesink location='/media/${hdduuid}/record-ts/${filename}~1.ts' v4l2src device=/dev/exCAM io-mode=2 ! tee name=t2 ! queue ! image/jpeg,width=1920,height=1080,framerate=30/1 ! videorate ! image/jpeg,width=1920,height=1080,framerate=${fpsp2}/1 ! jpegparse ! nvv4l2decoder mjpeg=1 ! nvvidconv ! queue ! "video/x-raw(memory:NVMM),width=1920,height=1080,format=NV12" ! nvv4l2h264enc maxperf-enable=1 bitrate=${bitrate} profile=4 ! queue ! h264parse ! queue ! mpegtsmux ! filesink location='/media/${hdduuid}/record-ts/${filename}~2.ts' videotestsrc pattern=black ! video/x-raw,width=320,height=240 ! nvvidconv ! queue ! comp.sink_0 v4l2src device=/dev/presenter ! tee name=t4 ! video/x-raw, width=1920, height=1080, framerate=30/1 ! videorate ! video/x-raw, width=1920, height=1080, framerate=30/1 ! queue ! nvvidconv ! queue ! "video/x-raw(memory:NVMM),width=960,height=540,format=NV12" ! queue ! comp.sink_1 t2. ! queue ! image/jpeg,width=1920,height=1080,framerate=30/1 ! videorate ! image/jpeg,width=1920,height=1080,framerate=${fpsp2}/1 ! jpegparse ! nvv4l2decoder mjpeg=1 ! nvvidconv ! queue ! "video/x-raw(memory:NVMM),width=960,height=540,format=NV12" ! queue ! comp.sink_2 nvcompositor name=comp sink_0::width=1920 sink_0::height=1080 sink_1::xpos=0 sink_1::ypos=270 sink_1::width=960 sink_1::height=540  sink_2::xpos=960 sink_2::ypos=270 sink_2::width=960 sink_2::height=540 ! tee name=t3 ! queue ! nvvidconv ! queue ! nvv4l2h264enc maxperf-enable=1 bitrate=${bitrate} profile=4 ! queue ! h264parse ! queue ! mux3. liveadder name=mixer ! voaacenc ! queue ! mux3. a1. ! queue ! mixer.sink_0 a2. ! queue ! mixer.sink_1 flvmux name=mux3 ! rtmpsink location="rtmp://localhost/live" t3. ! nvvidconv ! nvoverlaysink liveadder name=mix ! queue ! audioconvert ! audioresample ! "audio/x-raw,rate=48000,channels=2,format=S16LE" ! alsasink device="hw:0,3" sync=false async=false a1. ! queue ! mix.sink_0 a2. ! queue ! mix.sink_1 t1. ! queue ! video/x-raw, width=1920, height=1080, framerate=60/1 ! videorate ! video/x-raw, width=1920, height=1080, framerate=1/1 ! jpegenc ! jpegparse ! multifilesink location=p1.jpg async=false t2. ! queue !  image/jpeg,width=1920,height=1080,framerate=30/1 ! videorate ! image/jpeg,width=1920,height=1080,framerate=1/1  ! jpegparse !  multifilesink location=p2.jpg async=false liveadder name=mix4 ! queue ! audioconvert ! audioresample ! "audio/x-raw,rate=48000,channels=2,format=S16LE" ! alsasink device="hw:externAud,0" sync=false async=false a1. ! queue ! mix4.sink_0 a2. ! queue ! mix4.sink_1`;

    // SP-sdiusb 50/50sdiusb 50/50sdiusb 01-10
    let stval_sfp2_50_50_p2_ex = `gst-launch-1.0 -e v4l2src device=/dev/presenter ! queue ! tee name=t1 ! video/x-raw, width=1920, height=1080, framerate=30/1 ! videorate ! video/x-raw, width=1920, height=1080, framerate=30/1 ! nvvidconv ! queue ! nvv4l2h264enc maxperf-enable=1 bitrate=${bitrate} profile=4 ! queue ! h264parse ! queue ! mux. liveadder name=mix1 ! queue ! audioconvert ! voaacenc ! mux. alsasrc device="hw:externAud,0" ! queue ! audio/x-raw ! queue ! audioresample ! "audio/x-raw,rate=48000" ! tee name=a1 ! queue ! mix1.sink_0 alsasrc device="hw:channel1,0" ! queue ! audio/x-raw ! queue ! audioresample ! "audio/x-raw,rate=48000" ! tee name=a2 ! queue ! mix1.sink_1 mpegtsmux name=mux ! filesink location='/media/${hdduuid}/record-ts/${filename}~1.ts' v4l2src device=/dev/exCAM io-mode=2 ! tee name=t2 ! queue ! image/jpeg,width=1920,height=1080,framerate=30/1 ! videorate ! image/jpeg,width=1920,height=1080,framerate=${fpsp2}/1 ! jpegparse ! nvv4l2decoder mjpeg=1 ! nvvidconv ! queue ! "video/x-raw(memory:NVMM),width=1920,height=1080,format=NV12" ! nvv4l2h264enc maxperf-enable=1 bitrate=${bitrate} profile=4 ! queue ! h264parse ! queue ! mpegtsmux ! filesink location='/media/${hdduuid}/record-ts/${filename}~2.ts' videotestsrc pattern=black ! video/x-raw,width=320,height=240 ! nvvidconv ! queue ! comp.sink_0 t1. ! video/x-raw, width=1920, height=1080, framerate=60/1 ! videorate ! video/x-raw, width=1920, height=1080, framerate=${fpsp1}/1 ! queue ! nvvidconv ! queue ! "video/x-raw(memory:NVMM),width=960,height=540,format=NV12" ! queue ! comp.sink_1 t2. ! queue ! image/jpeg,width=1920,height=1080,framerate=30/1 ! videorate ! image/jpeg,width=1920,height=1080,framerate=${fpsp2}/1 ! jpegparse ! nvv4l2decoder mjpeg=1 ! nvvidconv ! queue ! "video/x-raw(memory:NVMM),width=960,height=540,format=NV12" ! queue ! comp.sink_2 nvcompositor name=comp sink_0::width=1920 sink_0::height=1080 sink_1::xpos=0 sink_1::ypos=270 sink_1::width=960 sink_1::height=540  sink_2::xpos=960 sink_2::ypos=270 sink_2::width=960 sink_2::height=540 ! tee name=t3 ! queue ! nvvidconv ! queue ! nvv4l2h264enc maxperf-enable=1 bitrate=${bitrate} profile=4 ! queue ! h264parse ! queue ! mux3. liveadder name=mixer ! voaacenc ! queue ! mux3. a1. ! queue ! mixer.sink_0 a2. ! queue ! mixer.sink_1 flvmux name=mux3 ! rtmpsink location="rtmp://localhost/live" t3. ! nvvidconv ! nvoverlaysink liveadder name=mix ! queue ! audioconvert ! audioresample ! "audio/x-raw,rate=48000,channels=2,format=S16LE" ! alsasink device="hw:0,3" sync=false async=false a1. ! queue ! mix.sink_0 a2. ! queue ! mix.sink_1 t1. ! queue ! video/x-raw, width=1920, height=1080, framerate=60/1 ! videorate ! video/x-raw, width=1920, height=1080, framerate=1/1 ! jpegenc ! jpegparse ! multifilesink location=p1.jpg async=false t2. ! queue !  image/jpeg,width=1920,height=1080,framerate=30/1 ! videorate ! image/jpeg,width=1920,height=1080,framerate=1/1  ! jpegparse !  multifilesink location=p2.jpg async=false liveadder name=mix4 ! queue ! audioconvert ! audioresample ! "audio/x-raw,rate=48000,channels=2,format=S16LE" ! alsasink device="hw:externAud,0" sync=false async=false a1. ! queue ! mix4.sink_0 a2. ! queue ! mix4.sink_1`;

    // SBS, 5050sdiusb , 5050sdiusb 01-10
    let stval_sbsp1p2_50_50_p2_ex_yuyv = `gst-launch-1.0 -e videotestsrc pattern=black ! video/x-raw, width=320, height=240 ! nvvidconv ! queue ! tee name=t5 ! queue ! comp1.sink_0 v4l2src device=/dev/presentation ! queue ! tee name=t1 ! video/x-raw, width=1920, height=1080, framerate=60/1 ! videorate ! video/x-raw, width=1920, height=1080, framerate=${fpsp1}/1 ! nvvidconv ! queue ! "video/x-raw(memory:NVMM),width=1494,height=840,format=NV12" ! queue ! comp1.sink_1 v4l2src device=/dev/presenter ! tee name=t2 ! queue ! video/x-raw, width=1920, height=1080, framerate=30/1 ! videorate ! video/x-raw, width=1920, height=1080, framerate=${fpsp2}/1 ! nvvidconv ! queue ! "video/x-raw(memory:NVMM),width=426,height=240,format=NV12" ! queue ! comp1.sink_2 nvcompositor name=comp1 sink_0::width=1920 sink_0::height=1080 sink_1::xpos=0 sink_1::ypos=120 sink_1::width=1494 sink_1::height=840 sink_2::xpos=1494 sink_2::ypos=120 sink_2::width=426 sink_2::height=240 ! tee name=t4 ! queue ! nvvidconv ! queue ! nvv4l2h264enc maxperf-enable=1 bitrate=${bitrate} profile=4 ! queue ! h264parse ! queue ! mux. liveadder name=mix1 ! queue ! audioconvert ! voaacenc ! mux. alsasrc device="hw:externAud,0" ! queue ! audio/x-raw ! queue ! audioresample ! "audio/x-raw,rate=48000" ! tee name=a1 ! queue ! mix1.sink_0 alsasrc device="hw:channel1,0" ! queue ! audio/x-raw ! queue ! audioresample ! "audio/x-raw,rate=48000" ! tee name=a2 ! queue ! mix1.sink_1 mpegtsmux name=mux ! filesink location="/media/${hdduuid}/record-ts/${filename}.ts" videotestsrc pattern=black ! video/x-raw,width=320,height=240 ! nvvidconv ! queue ! comp.sink_0 t2. ! video/x-raw, width=1920, height=1080, framerate=30/1 ! videorate ! video/x-raw, width=1920, height=1080, framerate=30/1 ! queue ! nvvidconv ! queue ! "video/x-raw(memory:NVMM),width=960,height=540,format=NV12" ! queue ! comp.sink_1 v4l2src device=/dev/exCAM io-mode=2 ! tee name=t6 ! queue ! image/jpeg,width=1920,height=1080,framerate=30/1 ! videorate ! image/jpeg,width=1920,height=1080,framerate=${fpsp2}/1 ! jpegparse ! nvv4l2decoder mjpeg=1 ! nvvidconv ! queue ! "video/x-raw(memory:NVMM),width=960,height=540,format=NV12" ! queue ! comp.sink_2 nvcompositor name=comp sink_0::width=1920 sink_0::height=1080 sink_1::xpos=0 sink_1::ypos=270 sink_1::width=960 sink_1::height=540  sink_2::xpos=960 sink_2::ypos=270 sink_2::width=960 sink_2::height=540 ! tee name=t3 ! queue ! nvvidconv ! queue ! nvv4l2h264enc maxperf-enable=1 bitrate=${bitrate} profile=4 ! queue ! h264parse ! queue ! mux3. liveadder name=mixer ! voaacenc ! queue ! mux3. a1. ! queue ! mixer.sink_0 a2. ! queue ! mixer.sink_1 flvmux name=mux3 ! rtmpsink location="rtmp://localhost/live" t3. ! nvvidconv ! nvoverlaysink liveadder name=mix ! queue ! audioconvert ! audioresample ! "audio/x-raw,rate=48000,channels=2,format=S16LE" ! alsasink device="hw:0,3" sync=false async=false a1. ! queue ! mix.sink_0 a2. ! queue ! mix.sink_1 t5. ! queue ! comp3.sink_0 t1. ! video/x-raw, width=1920, height=1080, framerate=60/1 ! videorate ! video/x-raw, width=1920, height=1080, framerate=10/1 ! queue ! nvvidconv ! queue ! "video/x-raw(memory:NVMM),width=1920, height=1080,format=NV12" ! queue ! comp3.sink_1 t2. ! queue ! video/x-raw, width=1920, height=1080, framerate=30/1 ! videorate ! video/x-raw, width=1920, height=1080, framerate=${fpsp2}/1 ! nvvidconv ! queue ! "video/x-raw(memory:NVMM),width=426,height=240,format=NV12" ! queue ! comp3.sink_2 nvcompositor name=comp3 sink_0::width=1920 sink_0::height=1080 sink_1::xpos=0 sink_1::ypos=120 sink_1::width=1494 sink_1::height=840 sink_2::xpos=1494 sink_2::ypos=120 sink_2::width=426 sink_2::height=240 ! queue ! nvvidconv ! "video/x-raw(memory:NVMM),framerate=1/1,format=I420" ! queue ! nvjpegenc ! jpegparse ! multifilesink location=p1.jpg async=false liveadder name=mix4 ! queue ! audioconvert ! audioresample ! "audio/x-raw,rate=48000,channels=2,format=S16LE" ! alsasink device="hw:externAud,0" sync=false async=false a1. ! queue ! mix4.sink_0 a2. ! queue ! mix4.sink_1`;
    let stval_sbsp1ex_50_50_p2_ex_mjpg = `gst-launch-1.0 -e videotestsrc pattern=black ! video/x-raw,width=320,height=240 ! nvvidconv ! queue ! tee name=t5 ! queue ! comp1.sink_0 v4l2src device=/dev/presentation ! queue ! tee name=t1 ! video/x-raw, width=1920, height=1080, framerate=60/1 ! videorate ! video/x-raw, width=1920, height=1080, framerate=${fpsp1}/1 ! nvvidconv ! queue ! "video/x-raw(memory:NVMM),width=1494,height=840,format=NV12" ! queue ! comp1.sink_1 v4l2src device=/dev/exCAM io-mode=2 ! tee name=t2 ! queue ! image/jpeg,width=1920,height=1080,framerate=30/1 ! videorate ! image/jpeg,width=1920,height=1080,framerate=${fpsp2}/1 ! jpegparse ! nvv4l2decoder mjpeg=1 ! nvvidconv ! queue ! "video/x-raw(memory:NVMM),width=426,height=240,format=NV12" ! queue ! comp1.sink_2 nvcompositor name=comp1 sink_0::width=1920 sink_0::height=1080 sink_1::xpos=0 sink_1::ypos=120 sink_1::width=1494 sink_1::height=840 sink_2::xpos=1494 sink_2::ypos=120 sink_2::width=426 sink_2::height=240 ! tee name=t4 ! queue ! nvvidconv ! queue ! nvv4l2h264enc maxperf-enable=1 bitrate=${bitrate} profile=4 ! queue ! h264parse ! queue ! mux. liveadder name=mix1 ! queue ! audioconvert ! voaacenc ! mux. alsasrc device="hw:externAud,0" ! queue ! audio/x-raw ! queue ! audioresample ! "audio/x-raw,rate=48000" ! tee name=a1 ! queue ! mix1.sink_0 alsasrc device="hw:channel1,0" ! queue ! audio/x-raw ! queue ! audioresample ! "audio/x-raw,rate=48000" ! tee name=a2 ! queue ! mix1.sink_1 mpegtsmux name=mux ! filesink location="/media/${hdduuid}/record-ts/${filename}.ts" videotestsrc pattern=black ! video/x-raw,width=320,height=240 ! nvvidconv ! queue ! comp.sink_0 v4l2src device=/dev/presenter ! tee name=t6 ! video/x-raw, width=1920, height=1080, framerate=30/1 ! videorate ! video/x-raw, width=1920, height=1080, framerate=30/1 ! queue ! nvvidconv ! queue ! "video/x-raw(memory:NVMM),width=960,height=540,format=NV12" ! queue ! comp.sink_1 t2. ! queue ! image/jpeg,width=1920,height=1080,framerate=30/1 ! videorate ! image/jpeg,width=1920,height=1080,framerate=${fpsp2}/1 ! jpegparse ! nvv4l2decoder mjpeg=1 ! nvvidconv ! queue ! "video/x-raw(memory:NVMM),width=960,height=540,format=NV12" ! queue ! comp.sink_2 nvcompositor name=comp sink_0::width=1920 sink_0::height=1080 sink_1::xpos=0 sink_1::ypos=270 sink_1::width=960 sink_1::height=540  sink_2::xpos=960 sink_2::ypos=270 sink_2::width=960 sink_2::height=540 ! tee name=t3 ! queue ! nvvidconv ! queue ! nvv4l2h264enc maxperf-enable=1 bitrate=${bitrate} profile=4 ! queue ! h264parse ! queue ! mux3. liveadder name=mixer ! voaacenc ! queue ! mux3. a1. ! queue ! mixer.sink_0 a2. ! queue ! mixer.sink_1 flvmux name=mux3 ! rtmpsink location="rtmp://localhost/live" t3. ! nvvidconv ! nvoverlaysink liveadder name=mix ! queue ! audioconvert ! audioresample ! "audio/x-raw,rate=48000,channels=2,format=S16LE" ! alsasink device="hw:0,3" sync=false async=false a1. ! queue ! mix.sink_0 a2. ! queue ! mix.sink_1 t5. ! queue ! comp3.sink_0 t1. ! video/x-raw, width=1920, height=1080, framerate=60/1 ! videorate ! video/x-raw, width=1920, height=1080, framerate=10/1 ! queue ! nvvidconv ! queue ! "video/x-raw(memory:NVMM),width=1920, height=1080,format=NV12" ! queue ! comp3.sink_1 t2. ! queue ! image/jpeg,width=1920,height=1080,framerate=30/1 ! videorate ! image/jpeg,width=1920,height=1080,framerate=10/1 ! jpegparse ! nvv4l2decoder mjpeg=1 ! nvvidconv ! queue ! "video/x-raw(memory:NVMM),width=426,height=240,format=NV12" ! queue ! comp3.sink_2 nvcompositor name=comp3 sink_0::width=1920 sink_0::height=1080 sink_1::xpos=0 sink_1::ypos=120 sink_1::width=1494 sink_1::height=840 sink_2::xpos=1494 sink_2::ypos=120 sink_2::width=426 sink_2::height=240 ! queue ! nvvidconv ! "video/x-raw(memory:NVMM),framerate=1/1,format=I420" ! queue ! nvjpegenc ! jpegparse ! multifilesink location=p1.jpg async=false liveadder name=mix4 ! queue ! audioconvert ! audioresample ! "audio/x-raw,rate=48000,channels=2,format=S16LE" ! alsasink device="hw:externAud,0" sync=false async=false a1. ! queue ! mix4.sink_0 a2. ! queue ! mix4.sink_1`;

    // 50, 5050sdiusb , 5050sdiusb 01-10
    let stval_50p1p2_50_50_p2_ex_yuyv = `gst-launch-1.0 -e videotestsrc pattern=black ! video/x-raw,width=320,height=240 ! nvvidconv ! queue ! tee name=t5 ! queue ! comp1.sink_0 v4l2src device=/dev/presentation ! queue ! tee name=t1 ! video/x-raw, width=1920, height=1080, framerate=60/1 ! videorate ! video/x-raw, width=1920, height=1080, framerate=${fpsp1}/1 ! nvvidconv ! queue ! "video/x-raw(memory:NVMM),width=960,height=540,format=NV12" ! queue ! comp1.sink_1 v4l2src device=/dev/presenter ! tee name=t2 ! queue ! video/x-raw, width=1920, height=1080, framerate=30/1 ! videorate ! video/x-raw, width=1920, height=1080, framerate=${fpsp2}/1 ! nvvidconv ! queue ! "video/x-raw(memory:NVMM),width=960,height=540,format=NV12" ! queue ! comp1.sink_2 nvcompositor name=comp1 sink_0::width=1920 sink_0::height=1080 sink_1::xpos=0 sink_1::ypos=270 sink_1::width=960 sink_1::height=540 sink_2::xpos=960 sink_2::ypos=270 sink_2::width=960 sink_2::height=540 ! tee name=t4 ! queue ! nvvidconv ! queue ! nvv4l2h264enc maxperf-enable=1 bitrate=${bitrate} profile=4 ! queue ! h264parse ! queue ! mux. liveadder name=mix1 ! queue ! audioconvert ! voaacenc ! mux. alsasrc device="hw:externAud,0" ! queue ! audio/x-raw ! queue ! audioresample ! "audio/x-raw,rate=48000" ! tee name=a1 ! queue ! mix1.sink_0 alsasrc device="hw:channel1,0" ! queue ! audio/x-raw ! queue ! audioresample ! "audio/x-raw,rate=48000" ! tee name=a2 ! queue ! mix1.sink_1 mpegtsmux name=mux ! filesink location="/media/${hdduuid}/record-ts/${filename}.ts" videotestsrc pattern=black ! video/x-raw,width=320,height=240 ! nvvidconv ! queue ! comp.sink_0 t2. ! video/x-raw, width=1920, height=1080, framerate=30/1 ! videorate ! video/x-raw, width=1920, height=1080, framerate=30/1 ! queue ! nvvidconv ! queue ! "video/x-raw(memory:NVMM),width=960,height=540,format=NV12" ! queue ! comp.sink_1 v4l2src device=/dev/exCAM io-mode=2 ! queue ! image/jpeg,width=1920,height=1080,framerate=30/1 ! videorate ! image/jpeg,width=1920,height=1080,framerate=${fpsp2}/1 ! jpegparse ! nvv4l2decoder mjpeg=1 ! nvvidconv ! queue ! "video/x-raw(memory:NVMM),width=960,height=540,format=NV12" ! queue ! comp.sink_2 nvcompositor name=comp sink_0::width=1920 sink_0::height=1080 sink_1::xpos=0 sink_1::ypos=270 sink_1::width=960 sink_1::height=540  sink_2::xpos=960 sink_2::ypos=270 sink_2::width=960 sink_2::height=540 ! tee name=t3 ! queue ! nvvidconv ! queue ! nvv4l2h264enc maxperf-enable=1 bitrate=${bitrate} profile=4 ! queue ! h264parse ! queue ! mux3. liveadder name=mixer ! voaacenc ! queue ! mux3. a1. ! queue ! mixer.sink_0 a2. ! queue ! mixer.sink_1 flvmux name=mux3 ! rtmpsink location="rtmp://localhost/live" t3. ! nvvidconv ! nvoverlaysink liveadder name=mix ! queue ! audioconvert ! audioresample ! "audio/x-raw,rate=48000,channels=2,format=S16LE" ! alsasink device="hw:0,3" sync=false async=false a1. ! queue ! mix.sink_0 a2. ! queue ! mix.sink_1 t5. ! queue ! comp3.sink_0 t1. ! video/x-raw, width=1920, height=1080, framerate=60/1 ! videorate ! video/x-raw, width=1920, height=1080, framerate=10/1 ! queue ! nvvidconv ! queue ! "video/x-raw(memory:NVMM),width=1920, height=1080,format=NV12" ! queue ! comp3.sink_1 t2. ! queue ! video/x-raw, width=1920, height=1080, framerate=30/1 ! videorate ! video/x-raw, width=1920, height=1080, framerate=${fpsp2}/1 ! nvvidconv ! queue ! "video/x-raw(memory:NVMM),width=426,height=240,format=NV12" ! queue ! comp3.sink_2 nvcompositor name=comp3 sink_0::width=1920 sink_0::height=1080 sink_1::xpos=0 sink_1::ypos=270 sink_1::width=960 sink_1::height=540 sink_2::xpos=960 sink_2::ypos=270 sink_2::width=960 sink_2::height=540 ! queue ! nvvidconv ! "video/x-raw(memory:NVMM),framerate=1/1,format=I420" ! queue ! nvjpegenc ! jpegparse ! multifilesink location=p1.jpg async=false liveadder name=mix4 ! queue ! audioconvert ! audioresample ! "audio/x-raw,rate=48000,channels=2,format=S16LE" ! alsasink device="hw:externAud,0" sync=false async=false a1. ! queue ! mix4.sink_0 a2. ! queue ! mix4.sink_1`;
    let stval_50p1ex_50_50_p2_ex_mjpg = `gst-launch-1.0 -e videotestsrc pattern=black ! video/x-raw,width=320,height=240 ! nvvidconv ! queue ! tee name=t5 ! queue ! comp1.sink_0 v4l2src device=/dev/presentation ! queue ! tee name=t1 ! video/x-raw, width=1920, height=1080, framerate=60/1 ! videorate ! video/x-raw, width=1920, height=1080, framerate=${fpsp1}/1 ! nvvidconv ! queue ! "video/x-raw(memory:NVMM),width=960,height=540,format=NV12" ! queue ! comp1.sink_1 v4l2src device=/dev/exCAM io-mode=2 ! tee name=t2 ! queue ! image/jpeg,width=1920,height=1080,framerate=30/1 ! videorate ! image/jpeg,width=1920,height=1080,framerate=${fpsp2}/1 ! jpegparse ! nvv4l2decoder mjpeg=1 ! nvvidconv ! queue ! "video/x-raw(memory:NVMM),width=960,height=540,format=NV12" ! queue ! comp1.sink_2 nvcompositor name=comp1 sink_0::width=1920 sink_0::height=1080 sink_1::xpos=0 sink_1::ypos=270 sink_1::width=960 sink_1::height=540 sink_2::xpos=960 sink_2::ypos=270 sink_2::width=960 sink_2::height=540 ! tee name=t4 ! queue ! nvvidconv ! queue ! nvv4l2h264enc maxperf-enable=1 bitrate=${bitrate} profile=4 ! queue ! h264parse ! queue ! mux. liveadder name=mix1 ! queue ! audioconvert ! voaacenc ! mux. alsasrc device="hw:externAud,0" ! queue ! audio/x-raw ! queue ! audioresample ! "audio/x-raw,rate=48000" ! tee name=a1 ! queue ! mix1.sink_0 alsasrc device="hw:channel1,0" ! queue ! audio/x-raw ! queue ! audioresample ! "audio/x-raw,rate=48000" ! tee name=a2 ! queue ! mix1.sink_1 mpegtsmux name=mux ! filesink location="/media/${hdduuid}/record-ts/${filename}.ts" videotestsrc pattern=black ! video/x-raw,width=320,height=240 ! nvvidconv ! queue ! comp.sink_0 v4l2src device=/dev/presenter ! video/x-raw, width=1920, height=1080, framerate=30/1 ! videorate ! video/x-raw, width=1920, height=1080, framerate=30/1 ! queue ! nvvidconv ! queue ! "video/x-raw(memory:NVMM),width=960,height=540,format=NV12" ! queue ! comp.sink_1 t2. ! queue ! image/jpeg,width=1920,height=1080,framerate=30/1 ! videorate ! image/jpeg,width=1920,height=1080,framerate=${fpsp2}/1 ! jpegparse ! nvv4l2decoder mjpeg=1 ! nvvidconv ! queue ! "video/x-raw(memory:NVMM),width=960,height=540,format=NV12" ! queue ! comp.sink_2 nvcompositor name=comp sink_0::width=1920 sink_0::height=1080 sink_1::xpos=0 sink_1::ypos=270 sink_1::width=960 sink_1::height=540  sink_2::xpos=960 sink_2::ypos=270 sink_2::width=960 sink_2::height=540 ! tee name=t3 ! queue ! nvvidconv ! queue ! nvv4l2h264enc maxperf-enable=1 bitrate=${bitrate} profile=4 ! queue ! h264parse ! queue ! mux3. liveadder name=mixer ! voaacenc ! queue ! mux3. a1. ! queue ! mixer.sink_0 a2. ! queue ! mixer.sink_1 flvmux name=mux3 ! rtmpsink location="rtmp://localhost/live" t3. ! nvvidconv ! nvoverlaysink liveadder name=mix ! queue ! audioconvert ! audioresample ! "audio/x-raw,rate=48000,channels=2,format=S16LE" ! alsasink device="hw:0,3" sync=false async=false a1. ! queue ! mix.sink_0 a2. ! queue ! mix.sink_1 t5. ! queue ! comp3.sink_0 t1. ! video/x-raw, width=1920, height=1080, framerate=60/1 ! videorate ! video/x-raw, width=1920, height=1080, framerate=10/1 ! queue ! nvvidconv ! queue ! "video/x-raw(memory:NVMM),width=1920, height=1080,format=NV12" ! queue ! comp3.sink_1 t2. ! queue ! image/jpeg,width=1920,height=1080,framerate=30/1 ! videorate ! image/jpeg,width=1920,height=1080,framerate=10/1 ! jpegparse ! nvv4l2decoder mjpeg=1 ! nvvidconv ! queue ! "video/x-raw(memory:NVMM),width=960,height=540,format=NV12" ! queue ! comp3.sink_2 nvcompositor name=comp3 sink_0::width=1920 sink_0::height=1080 sink_1::xpos=0 sink_1::ypos=270 sink_1::width=960 sink_1::height=540 sink_2::xpos=960 sink_2::ypos=270 sink_2::width=960 sink_2::height=540 ! queue ! nvvidconv ! "video/x-raw(memory:NVMM),framerate=1/1,format=I420" ! queue ! nvjpegenc ! jpegparse ! multifilesink location=p1.jpg async=false liveadder name=mix4 ! queue ! audioconvert ! audioresample ! "audio/x-raw,rate=48000,channels=2,format=S16LE" ! alsasink device="hw:externAud,0" sync=false async=false a1. ! queue ! mix4.sink_0 a2. ! queue ! mix4.sink_1`;

    // Separate Files, SBS, SBS 240
    let stval_sf_sbs_sbs_240_yuyv = `gst-launch-1.0 -e v4l2src device=/dev/presentation ! queue ! tee name=t1 ! video/x-raw, width=1920, height=1080, framerate=60/1 ! videorate ! video/x-raw, width=1920, height=1080, framerate=${fpsp1}/1 ! nvvidconv ! queue ! nvv4l2h264enc maxperf-enable=1 bitrate=${bitrate} profile=4 ! queue ! h264parse ! queue ! mux. liveadder name=mix1 ! queue ! audioconvert ! voaacenc ! mux. alsasrc device="hw:externAud,0" ! queue ! audio/x-raw ! queue ! audioresample ! "audio/x-raw,rate=48000" ! tee name=a1 ! queue ! mix1.sink_0 alsasrc device="hw:channel1,0" ! queue ! audio/x-raw ! queue ! audioresample ! "audio/x-raw,rate=48000" ! tee name=a2 ! queue ! mix1.sink_1 mpegtsmux name=mux ! filesink location='/media/${hdduuid}/record-ts/${filename}~1.ts' v4l2src device=/dev/presenter ! tee name=t2 ! queue ! video/x-raw, width=1920, height=1080, framerate=30/1 ! videorate ! video/x-raw, width=1920, height=1080, framerate=${fpsp2}/1 ! nvvidconv ! queue ! "video/x-raw(memory:NVMM),width=1920,height=1080,format=NV12" ! nvv4l2h264enc maxperf-enable=1 bitrate=${bitrate} profile=4 ! queue ! h264parse ! queue ! mpegtsmux ! filesink location='/media/${hdduuid}/record-ts/${filename}~2.ts' videotestsrc pattern=black ! video/x-raw,width=320,height=240 ! nvvidconv ! queue ! comp.sink_0 t1. ! video/x-raw, width=1920, height=1080, framerate=60/1 ! videorate ! video/x-raw, width=1920, height=1080, framerate=${fpsp1}/1 ! queue ! nvvidconv ! queue ! "video/x-raw(memory:NVMM),width=1494, height=840,format=NV12" ! queue ! comp.sink_1 t2. ! queue ! video/x-raw, width=1920, height=1080, framerate=30/1 ! videorate ! video/x-raw, width=1920, height=1080, framerate=${fpsp2}/1 ! nvvidconv ! queue ! "video/x-raw(memory:NVMM),width=426,height=240,format=NV12" ! queue ! comp.sink_2 nvcompositor name=comp sink_0::width=1920 sink_0::height=1080 sink_1::xpos=0 sink_1::ypos=120 sink_1::width=1494 sink_1::height=840  sink_2::xpos=1494 sink_2::ypos=120 sink_2::width=426 sink_2::height=240 ! tee name=t3 ! queue ! nvvidconv ! queue ! nvv4l2h264enc maxperf-enable=1 bitrate=${bitrate} profile=4 ! queue ! h264parse ! queue ! mux3. liveadder name=mixer ! voaacenc ! queue ! mux3. a1. ! queue ! mixer.sink_0 a2. ! queue ! mixer.sink_1 flvmux name=mux3 ! rtmpsink location="rtmp://localhost/live" t3. ! nvvidconv ! nvoverlaysink liveadder name=mix ! queue ! audioconvert ! audioresample ! "audio/x-raw,rate=48000,channels=2,format=S16LE" ! alsasink device="hw:0,3" sync=false async=false a1. ! queue ! mix.sink_0 a2. ! queue ! mix.sink_1 t1. ! queue ! video/x-raw, width=1920, height=1080, framerate=60/1 ! videorate ! video/x-raw, width=1920, height=1080, framerate=1/1 ! jpegenc ! multifilesink location=p1.jpg async=false t2. ! queue ! video/x-raw, width=1920, height=1080, framerate=30/1 ! videorate ! video/x-raw, width=1920, height=1080, framerate=1/1 ! jpegenc ! multifilesink location=p2.jpg async=false liveadder name=mix4 ! queue ! audioconvert ! audioresample ! "audio/x-raw,rate=48000,channels=2,format=S16LE" ! alsasink device="hw:externAud,0" sync=false async=false a1. ! queue ! mix4.sink_0 a2. ! queue ! mix4.sink_1`;
    let stval_sf_sbs_sbs_240_mjpg = `gst-launch-1.0 -e v4l2src device=/dev/presentation ! queue ! tee name=t1 ! video/x-raw, width=1920, height=1080, framerate=60/1 ! videorate ! video/x-raw, width=1920, height=1080, framerate=${fpsp1}/1 ! nvvidconv ! queue ! nvv4l2h264enc maxperf-enable=1 bitrate=${bitrate} profile=4 ! queue ! h264parse ! queue ! mux. liveadder name=mix1 ! queue ! audioconvert ! voaacenc ! mux. alsasrc device="hw:externAud,0" ! queue ! audio/x-raw ! queue ! audioresample ! "audio/x-raw,rate=48000" ! tee name=a1 ! queue ! mix1.sink_0 alsasrc device="hw:channel1,0" ! queue ! audio/x-raw ! queue ! audioresample ! "audio/x-raw,rate=48000" ! tee name=a2 ! queue ! mix1.sink_1 mpegtsmux name=mux ! filesink location='/media/${hdduuid}/record-ts/${filename}~1.ts' v4l2src device=/dev/exCAM io-mode=2 ! tee name=t2 ! queue ! image/jpeg,width=1920,height=1080,framerate=30/1 ! videorate ! image/jpeg,width=1920,height=1080,framerate=${fpsp2}/1 ! nvv4l2decoder mjpeg=1 ! nvvidconv ! queue ! "video/x-raw(memory:NVMM),width=1920,height=1080,format=NV12" ! nvv4l2h264enc maxperf-enable=1 bitrate=${bitrate} profile=4 ! queue ! h264parse ! queue ! mpegtsmux ! filesink location='/media/${hdduuid}/record-ts/${filename}~2.ts' videotestsrc pattern=black ! video/x-raw,width=320,height=240 ! nvvidconv ! queue ! comp.sink_0 t1. ! video/x-raw, width=1920, height=1080, framerate=60/1 ! videorate ! video/x-raw, width=1920, height=1080, framerate=${fpsp1}/1 ! queue ! nvvidconv ! queue ! "video/x-raw(memory:NVMM),width=1494, height=840,format=NV12" ! queue ! comp.sink_1 t2. ! queue ! image/jpeg,width=1920,height=1080,framerate=30/1 ! videorate ! image/jpeg,width=1920,height=1080,framerate=${fpsp2}/1 ! nvv4l2decoder mjpeg=1 ! nvvidconv ! queue ! "video/x-raw(memory:NVMM),width=426,height=240,format=NV12" ! queue ! comp.sink_2 nvcompositor name=comp sink_0::width=1920 sink_0::height=1080 sink_1::xpos=0 sink_1::ypos=120 sink_1::width=1494 sink_1::height=840  sink_2::xpos=1494 sink_2::ypos=120 sink_2::width=426 sink_2::height=240 ! tee name=t3 ! queue ! nvvidconv ! queue ! nvv4l2h264enc maxperf-enable=1 bitrate=${bitrate} profile=4 ! queue ! h264parse ! queue ! mux3. liveadder name=mixer ! voaacenc ! queue ! mux3. a1. ! queue ! mixer.sink_0 a2. ! queue ! mixer.sink_1 flvmux name=mux3 ! rtmpsink location="rtmp://localhost/live" t3. ! nvvidconv ! nvoverlaysink liveadder name=mix ! queue ! audioconvert ! audioresample ! "audio/x-raw,rate=48000,channels=2,format=S16LE" ! alsasink device="hw:0,3" sync=false async=false a1. ! queue ! mix.sink_0 a2. ! queue ! mix.sink_1 t1. ! queue ! video/x-raw, width=1920, height=1080, framerate=60/1 ! videorate ! video/x-raw, width=1920, height=1080, framerate=1/1 ! jpegenc ! multifilesink location=p1.jpg async=false t2. ! queue ! image/jpeg,width=1920,height=1080,framerate=30/1 ! videorate ! image/jpeg,width=1920,height=1080,framerate=1/1 !  multifilesink location=p2.jpg async=false liveadder name=mix4 ! queue ! audioconvert ! audioresample ! "audio/x-raw,rate=48000,channels=2,format=S16LE" ! alsasink device="hw:externAud,0" sync=false async=false a1. ! queue ! mix4.sink_0 a2. ! queue ! mix4.sink_1`;


    // Separate Files, SBS, SBS 144
    let stval_sf_sbs_sbs_144_yuyv = ``;
    let stval_sf_sbs_sbs_144_mjpg = ``;

    // Separate Files, Single Feed Single Feed - presentation only

    let stval_sf_p1_p1_yuyv = `gst-launch-1.0 -e v4l2src device=/dev/presentation ! queue ! tee name=t1 ! video/x-raw, width=1920, height=1080, framerate=60/1 ! videorate ! video/x-raw, width=1920, height=1080, framerate=${fpsp1}/1 ! nvvidconv ! queue ! nvv4l2h264enc maxperf-enable=1 bitrate=${bitrate} profile=4 ! queue ! h264parse ! queue ! mux. liveadder name=mix1 ! queue ! audioconvert ! voaacenc ! mux. alsasrc device="hw:externAud,0" ! queue ! audio/x-raw ! queue ! audioresample ! "audio/x-raw,rate=48000" ! tee name=a1 ! queue ! mix1.sink_0 alsasrc device="hw:channel1,0" ! queue ! audio/x-raw ! queue ! audioresample ! "audio/x-raw,rate=48000" ! tee name=a2 ! queue ! mix1.sink_1 mpegtsmux name=mux ! filesink location='/media/${hdduuid}/record-ts/${filename}~1.ts' v4l2src device=/dev/presenter ! tee name=t2 ! queue ! video/x-raw, width=1920, height=1080, framerate=30/1 ! videorate ! video/x-raw, width=1920, height=1080, framerate=${fpsp2}/1 ! nvvidconv ! queue ! "video/x-raw(memory:NVMM),width=1920,height=1080,format=NV12" ! nvv4l2h264enc maxperf-enable=1 bitrate=${bitrate} profile=4 ! queue ! h264parse ! queue ! mpegtsmux ! filesink location='/media/${hdduuid}/record-ts/${filename}~2.ts' videotestsrc pattern=black ! video/x-raw,width=320,height=240 ! nvvidconv ! queue ! comp.sink_0 t1. ! video/x-raw, width=1920, height=1080, framerate=60/1 ! videorate ! video/x-raw, width=1920, height=1080, framerate=${fpsp1}/1 ! queue ! nvvidconv ! queue ! "video/x-raw(memory:NVMM),width=1920,height=1080,format=NV12" ! queue ! comp.sink_1 nvcompositor name=comp sink_0::width=1920 sink_0::height=1080 sink_1::xpos=0 sink_1::ypos=0 sink_1::width=1920 sink_1::height=1080 ! tee name=t3 ! queue ! nvvidconv ! queue ! nvv4l2h264enc maxperf-enable=1 bitrate=${bitrate} profile=4 ! queue ! h264parse ! queue ! mux3. liveadder name=mixer ! voaacenc ! queue ! mux3. a1. ! queue ! mixer.sink_0 a2. ! queue ! mixer.sink_1 flvmux name=mux3 ! rtmpsink location="rtmp://localhost/live" t3. ! nvvidconv ! nvoverlaysink liveadder name=mix ! queue ! audioconvert ! audioresample ! "audio/x-raw,rate=48000,channels=2,format=S16LE" ! alsasink device="hw:0,3" sync=false async=false a1. ! queue ! mix.sink_0 a2. ! queue ! mix.sink_1 t1. ! queue ! video/x-raw, width=1920, height=1080, framerate=60/1 ! videorate ! video/x-raw, width=1920, height=1080, framerate=1/1 ! jpegenc ! multifilesink location=p1.jpg async=false t2. ! queue ! video/x-raw, width=1920, height=1080, framerate=30/1 ! videorate ! video/x-raw, width=1920, height=1080, framerate=1/1 ! jpegenc ! multifilesink location=p2.jpg async=false liveadder name=mix4 ! queue ! audioconvert ! audioresample ! "audio/x-raw,rate=48000,channels=2,format=S16LE" ! alsasink device="hw:externAud,0" sync=false async=false a1. ! queue ! mix4.sink_0 a2. ! queue ! mix4.sink_1`;
    let stval_sf_p1_p1_mjpg = `gst-launch-1.0 -e v4l2src device=/dev/presentation ! queue ! tee name=t1 ! video/x-raw, width=1920, height=1080, framerate=60/1 ! videorate ! video/x-raw, width=1920, height=1080, framerate=${fpsp1}/1 ! nvvidconv ! queue ! nvv4l2h264enc maxperf-enable=1 bitrate=${bitrate} profile=4 ! queue ! h264parse ! queue ! mux. liveadder name=mix1 ! queue ! audioconvert ! voaacenc ! mux. alsasrc device="hw:externAud,0" ! queue ! audio/x-raw ! queue ! audioresample ! "audio/x-raw,rate=48000" ! tee name=a1 ! queue ! mix1.sink_0 alsasrc device="hw:channel1,0" ! queue ! audio/x-raw ! queue ! audioresample ! "audio/x-raw,rate=48000" ! tee name=a2 ! queue ! mix1.sink_1 mpegtsmux name=mux ! filesink location='/media/${hdduuid}/record-ts/${filename}~1.ts' v4l2src device=/dev/exCAM io-mode=2 ! tee name=t2 ! queue ! image/jpeg,width=1920,height=1080,framerate=30/1 ! videorate ! image/jpeg,width=1920,height=1080,framerate=${fpsp2}/1 ! nvv4l2decoder mjpeg=1 ! nvvidconv ! queue ! "video/x-raw(memory:NVMM),width=1920,height=1080,format=NV12" ! nvv4l2h264enc maxperf-enable=1 bitrate=${bitrate} profile=4 ! queue ! h264parse ! queue ! mpegtsmux ! filesink location='/media/${hdduuid}/record-ts/${filename}~2.ts' videotestsrc pattern=black ! video/x-raw,width=320,height=240 ! nvvidconv ! queue ! comp.sink_0 t1. ! video/x-raw, width=1920, height=1080, framerate=60/1 ! videorate ! video/x-raw, width=1920, height=1080, framerate=${fpsp1}/1 ! queue ! nvvidconv ! queue ! "video/x-raw(memory:NVMM),width=1920,height=1080,format=NV12" ! queue ! comp.sink_1 nvcompositor name=comp sink_0::width=1920 sink_0::height=1080 sink_1::xpos=0 sink_1::ypos=0 sink_1::width=1920 sink_1::height=1080 ! tee name=t3 ! queue ! nvvidconv ! queue ! nvv4l2h264enc maxperf-enable=1 bitrate=${bitrate} profile=4 ! queue ! h264parse ! queue ! mux3. liveadder name=mixer ! voaacenc ! queue ! mux3. a1. ! queue ! mixer.sink_0 a2. ! queue ! mixer.sink_1 flvmux name=mux3 ! rtmpsink location="rtmp://localhost/live" t3. ! nvvidconv ! nvoverlaysink liveadder name=mix ! queue ! audioconvert ! audioresample ! "audio/x-raw,rate=48000,channels=2,format=S16LE" ! alsasink device="hw:0,3" sync=false async=false a1. ! queue ! mix.sink_0 a2. ! queue ! mix.sink_1 t1. ! queue ! video/x-raw, width=1920, height=1080, framerate=60/1 ! videorate ! video/x-raw, width=1920, height=1080, framerate=1/1 ! jpegenc ! multifilesink location=p1.jpg async=false t2. ! queue !  image/jpeg,width=1920,height=1080,framerate=30/1 ! videorate ! image/jpeg,width=1920,height=1080,framerate=1/1 !  multifilesink location=p2.jpg async=false liveadder name=mix4 ! queue ! audioconvert ! audioresample ! "audio/x-raw,rate=48000,channels=2,format=S16LE" ! alsasink device="hw:externAud,0" sync=false async=false a1. ! queue ! mix4.sink_0 a2. ! queue ! mix4.sink_1`;

    // Separate Files, Single Feed Single Feed - presenter only
    let stval_sf_p2_p2_yuyv = `gst-launch-1.0 -e v4l2src device=/dev/presentation ! queue ! tee name=t1 ! video/x-raw, width=1920, height=1080, framerate=60/1 ! videorate ! video/x-raw, width=1920, height=1080, framerate=${fpsp1}/1 ! nvvidconv ! queue ! nvv4l2h264enc maxperf-enable=1 bitrate=${bitrate} profile=4 ! queue ! h264parse ! queue ! mux. liveadder name=mix1 ! queue ! audioconvert ! voaacenc ! mux. alsasrc device="hw:externAud,0" ! queue ! audio/x-raw ! queue ! audioresample ! "audio/x-raw,rate=48000" ! tee name=a1 ! queue ! mix1.sink_0 alsasrc device="hw:channel1,0" ! queue ! audio/x-raw ! queue ! audioresample ! "audio/x-raw,rate=48000" ! tee name=a2 ! queue ! mix1.sink_1 mpegtsmux name=mux ! filesink location='/media/${hdduuid}/record-ts/${filename}~1.ts' v4l2src device=/dev/presenter ! tee name=t2 ! queue ! video/x-raw, width=1920, height=1080, framerate=30/1 ! videorate ! video/x-raw, width=1920, height=1080, framerate=${fpsp2}/1 ! nvvidconv ! queue ! "video/x-raw(memory:NVMM),width=1920,height=1080,format=NV12" ! nvv4l2h264enc maxperf-enable=1 bitrate=${bitrate} profile=4 ! queue ! h264parse ! queue ! mpegtsmux ! filesink location='/media/${hdduuid}/record-ts/${filename}~2.ts' videotestsrc pattern=black ! video/x-raw,width=320,height=240 ! nvvidconv ! queue ! comp.sink_0 t2. ! video/x-raw, width=1920, height=1080, framerate=30/1 ! videorate ! video/x-raw, width=1920, height=1080, framerate=30/1 ! queue ! nvvidconv ! queue ! "video/x-raw(memory:NVMM),width=1920,height=1080,format=NV12" ! queue ! comp.sink_1 nvcompositor name=comp sink_0::width=1920 sink_0::height=1080 sink_1::xpos=0 sink_1::ypos=0 sink_1::width=1920 sink_1::height=1080 ! tee name=t3 ! queue ! nvvidconv ! queue ! nvv4l2h264enc maxperf-enable=1 bitrate=${bitrate} profile=4 ! queue ! h264parse ! queue ! mux3. liveadder name=mixer ! voaacenc ! queue ! mux3. a1. ! queue ! mixer.sink_0 a2. ! queue ! mixer.sink_1 flvmux name=mux3 ! rtmpsink location="rtmp://localhost/live" t3. ! nvvidconv ! nvoverlaysink liveadder name=mix ! queue ! audioconvert ! audioresample ! "audio/x-raw,rate=48000,channels=2,format=S16LE" ! alsasink device="hw:0,3" sync=false async=false a1. ! queue ! mix.sink_0 a2. ! queue ! mix.sink_1 t1. ! queue ! video/x-raw, width=1920, height=1080, framerate=60/1 ! videorate ! video/x-raw, width=1920, height=1080, framerate=1/1 ! jpegenc ! multifilesink location=p1.jpg async=false t2. ! queue ! video/x-raw, width=1920, height=1080, framerate=30/1 ! videorate ! video/x-raw, width=1920, height=1080, framerate=1/1 ! jpegenc ! multifilesink location=p2.jpg async=false liveadder name=mix4 ! queue ! audioconvert ! audioresample ! "audio/x-raw,rate=48000,channels=2,format=S16LE" ! alsasink device="hw:externAud,0" sync=false async=false a1. ! queue ! mix4.sink_0 a2. ! queue ! mix4.sink_1`;
    let stval_sf_p2_p2_mjpg = `gst-launch-1.0 -e v4l2src device=/dev/presentation ! queue ! tee name=t1 ! video/x-raw, width=1920, height=1080, framerate=60/1 ! videorate ! video/x-raw, width=1920, height=1080, framerate=${fpsp1}/1 ! nvvidconv ! queue ! nvv4l2h264enc maxperf-enable=1 bitrate=${bitrate} profile=4 ! queue ! h264parse ! queue ! mux. liveadder name=mix1 ! queue ! audioconvert ! voaacenc ! mux. alsasrc device="hw:externAud,0" ! queue ! audio/x-raw ! queue ! audioresample ! "audio/x-raw,rate=48000" ! tee name=a1 ! queue ! mix1.sink_0 alsasrc device="hw:channel1,0" ! queue ! audio/x-raw ! queue ! audioresample ! "audio/x-raw,rate=48000" ! tee name=a2 ! queue ! mix1.sink_1 mpegtsmux name=mux ! filesink location='/media/${hdduuid}/record-ts/${filename}~1.ts' v4l2src device=/dev/exCAM io-mode=2 ! tee name=t2 ! queue ! image/jpeg,width=1920,height=1080,framerate=30/1 ! videorate ! image/jpeg,width=1920,height=1080,framerate=${fpsp2}/1 ! nvv4l2decoder mjpeg=1 ! nvvidconv ! queue ! "video/x-raw(memory:NVMM),width=1920,height=1080,format=NV12" ! nvv4l2h264enc maxperf-enable=1 bitrate=${bitrate} profile=4 ! queue ! h264parse ! queue ! mpegtsmux ! filesink location='/media/${hdduuid}/record-ts/${filename}~2.ts' videotestsrc pattern=black ! video/x-raw,width=320,height=240 ! nvvidconv ! queue ! comp.sink_0 t2. ! queue ! image/jpeg,width=1920,height=1080,framerate=30/1 ! videorate ! image/jpeg,width=1920,height=1080,framerate=${fpsp2}/1 ! nvv4l2decoder mjpeg=1 ! nvvidconv ! queue ! "video/x-raw(memory:NVMM),width=1920,height=1080,format=NV12" ! queue ! comp.sink_1 nvcompositor name=comp sink_0::width=1920 sink_0::height=1080 sink_1::xpos=0 sink_1::ypos=0 sink_1::width=1920 sink_1::height=1080 ! tee name=t3 ! queue ! nvvidconv ! queue ! nvv4l2h264enc maxperf-enable=1 bitrate=${bitrate} profile=4 ! queue ! h264parse ! queue ! mux3. liveadder name=mixer ! voaacenc ! queue ! mux3. a1. ! queue ! mixer.sink_0 a2. ! queue ! mixer.sink_1 flvmux name=mux3 ! rtmpsink location="rtmp://localhost/live" t3. ! nvvidconv ! nvoverlaysink liveadder name=mix ! queue ! audioconvert ! audioresample ! "audio/x-raw,rate=48000,channels=2,format=S16LE" ! alsasink device="hw:0,3" sync=false async=false a1. ! queue ! mix.sink_0 a2. ! queue ! mix.sink_1 t1. ! queue ! video/x-raw, width=1920, height=1080, framerate=60/1 ! videorate ! video/x-raw, width=1920, height=1080, framerate=1/1 ! jpegenc ! multifilesink location=p1.jpg async=false t2. ! queue !  image/jpeg,width=1920,height=1080,framerate=30/1 ! videorate ! image/jpeg,width=1920,height=1080,framerate=1/1 !  multifilesink location=p2.jpg async=false liveadder name=mix4 ! queue ! audioconvert ! audioresample ! "audio/x-raw,rate=48000,channels=2,format=S16LE" ! alsasink device="hw:externAud,0" sync=false async=false a1. ! queue ! mix4.sink_0 a2. ! queue ! mix4.sink_1`;

    // SBS, SBS, SBS 240
    let stval_sbs_sbs_240_yuyv = `gst-launch-1.0 -e videotestsrc pattern=black ! video/x-raw,width=320,height=240 ! nvvidconv ! queue ! tee name=t5 ! queue ! comp1.sink_0 v4l2src device=/dev/presentation ! queue ! tee name=t1 ! video/x-raw, width=1920, height=1080, framerate=60/1 ! videorate ! video/x-raw, width=1920, height=1080, framerate=${fpsp1}/1 ! nvvidconv ! queue ! "video/x-raw(memory:NVMM),width=1494,height=840,format=NV12" ! queue ! comp1.sink_1 v4l2src device=/dev/presenter ! tee name=t2 ! queue ! video/x-raw, width=1920, height=1080, framerate=30/1 ! videorate ! video/x-raw, width=1920, height=1080, framerate=${fpsp2}/1 ! nvvidconv ! queue ! "video/x-raw(memory:NVMM),width=426,height=240,format=NV12" ! queue ! comp1.sink_2 nvcompositor name=comp1 sink_0::width=1920 sink_0::height=1080 sink_1::xpos=0 sink_1::ypos=120 sink_1::width=1494 sink_1::height=840 sink_2::xpos=1494 sink_2::ypos=120 sink_2::width=426 sink_2::height=240 ! tee name=t4 ! queue ! nvvidconv ! queue ! nvv4l2h264enc maxperf-enable=1 bitrate=${bitrate} profile=4 ! queue ! h264parse ! queue ! mux. liveadder name=mix1 ! queue ! audioconvert ! voaacenc ! mux. alsasrc device="hw:externAud,0" ! queue ! audio/x-raw ! queue ! audioresample ! "audio/x-raw,rate=48000" ! tee name=a1 ! queue ! mix1.sink_0 alsasrc device="hw:channel1,0" ! queue ! audio/x-raw ! queue ! audioresample ! "audio/x-raw,rate=48000" ! tee name=a2 ! queue ! mix1.sink_1 mpegtsmux name=mux ! filesink location="/media/${hdduuid}/record-ts/${filename}.ts" t5. ! queue ! comp.sink_0 t1. ! video/x-raw, width=1920, height=1080, framerate=60/1 ! videorate ! video/x-raw, width=1920, height=1080, framerate=${fpsp1}/1 ! queue ! nvvidconv ! queue ! "video/x-raw(memory:NVMM),width=1494, height=840,format=NV12" ! queue ! comp.sink_1 t2. ! queue ! video/x-raw, width=1920, height=1080, framerate=30/1 ! videorate ! video/x-raw, width=1920, height=1080, framerate=${fpsp2}/1 ! nvvidconv ! queue ! "video/x-raw(memory:NVMM),width=426,height=240,format=NV12" ! queue ! comp.sink_2 nvcompositor name=comp sink_0::width=1920 sink_0::height=1080 sink_1::xpos=0 sink_1::ypos=120 sink_1::width=1494 sink_1::height=840  sink_2::xpos=1494 sink_2::ypos=120 sink_2::width=426 sink_2::height=240 ! tee name=t3 ! queue ! nvvidconv ! queue ! nvv4l2h264enc maxperf-enable=1 bitrate=${bitrate} profile=4 ! queue ! h264parse ! queue ! mux3. liveadder name=mixer ! voaacenc ! queue ! mux3. a1. ! queue ! mixer.sink_0 a2. ! queue ! mixer.sink_1 flvmux name=mux3 ! rtmpsink location="rtmp://localhost/live" t3. ! nvvidconv ! nvoverlaysink liveadder name=mix ! queue ! audioconvert ! audioresample ! "audio/x-raw,rate=48000,channels=2,format=S16LE" ! alsasink device="hw:0,3" sync=false async=false a1. ! queue ! mix.sink_0 a2. ! queue ! mix.sink_1 t5. ! queue ! comp3.sink_0 t1. ! video/x-raw, width=1920, height=1080, framerate=60/1 ! videorate ! video/x-raw, width=1920, height=1080, framerate=10/1 ! queue ! nvvidconv ! queue ! "video/x-raw(memory:NVMM),width=1920, height=1080,format=NV12" ! queue ! comp3.sink_1 t2. ! queue ! video/x-raw, width=1920, height=1080, framerate=30/1 ! videorate ! video/x-raw, width=1920, height=1080, framerate=${fpsp2}/1 ! nvvidconv ! queue ! "video/x-raw(memory:NVMM),width=426,height=240,format=NV12" ! queue ! comp3.sink_2 nvcompositor name=comp3 sink_0::width=1920 sink_0::height=1080 sink_1::xpos=0 sink_1::ypos=120 sink_1::width=1494 sink_1::height=840 sink_2::xpos=1494 sink_2::ypos=120 sink_2::width=426 sink_2::height=240 ! queue ! nvvidconv ! "video/x-raw(memory:NVMM),framerate=1/1,format=I420" ! queue ! nvjpegenc ! jpegparse ! multifilesink location=p1.jpg async=false liveadder name=mix4 ! queue ! audioconvert ! audioresample ! "audio/x-raw,rate=48000,channels=2,format=S16LE" ! alsasink device="hw:externAud,0" sync=false async=false a1. ! queue ! mix4.sink_0 a2. ! queue ! mix4.sink_1`;
    let stval_sbs_sbs_240_mjpg = `gst-launch-1.0 -e videotestsrc pattern=black ! video/x-raw,width=320,height=240 ! nvvidconv ! queue ! tee name=t5 ! queue ! comp1.sink_0 v4l2src device=/dev/presentation ! queue ! tee name=t1 ! video/x-raw, width=1920, height=1080, framerate=60/1 ! videorate ! video/x-raw, width=1920, height=1080, framerate=${fpsp1}/1 ! nvvidconv ! queue ! "video/x-raw(memory:NVMM),width=1494,height=840,format=NV12" ! queue ! comp1.sink_1 v4l2src device=/dev/exCAM io-mode=2 ! tee name=t2 ! queue ! image/jpeg,width=1920,height=1080,framerate=30/1 ! videorate ! image/jpeg,width=1920,height=1080,framerate=${fpsp2}/1 ! nvv4l2decoder mjpeg=1 ! nvvidconv ! queue ! "video/x-raw(memory:NVMM),width=426,height=240,format=NV12" ! queue ! comp1.sink_2 nvcompositor name=comp1 sink_0::width=1920 sink_0::height=1080 sink_1::xpos=0 sink_1::ypos=120 sink_1::width=1494 sink_1::height=840 sink_2::xpos=1494 sink_2::ypos=120 sink_2::width=426 sink_2::height=240 ! tee name=t4 ! queue ! nvvidconv ! queue ! nvv4l2h264enc maxperf-enable=1 bitrate=${bitrate} profile=4 ! queue ! h264parse ! queue ! mux. liveadder name=mix1 ! queue ! audioconvert ! voaacenc ! mux. alsasrc device="hw:externAud,0" ! queue ! audio/x-raw ! queue ! audioresample ! "audio/x-raw,rate=48000" ! tee name=a1 ! queue ! mix1.sink_0 alsasrc device="hw:channel1,0" ! queue ! audio/x-raw ! queue ! audioresample ! "audio/x-raw,rate=48000" ! tee name=a2 ! queue ! mix1.sink_1 mpegtsmux name=mux ! filesink location="/media/${hdduuid}/record-ts/${filename}.ts" t5. ! queue ! comp.sink_0 t1. ! video/x-raw, width=1920, height=1080, framerate=60/1 ! videorate ! video/x-raw, width=1920, height=1080, framerate=${fpsp1}/1 ! queue ! nvvidconv ! queue ! "video/x-raw(memory:NVMM),width=1494, height=840,format=NV12" ! queue ! comp.sink_1 t2. ! queue ! image/jpeg,width=1920,height=1080,framerate=30/1 ! videorate ! image/jpeg,width=1920,height=1080,framerate=${fpsp2}/1 ! nvv4l2decoder mjpeg=1 ! nvvidconv ! queue ! "video/x-raw(memory:NVMM),width=426,height=240,format=NV12" ! queue ! comp.sink_2 nvcompositor name=comp sink_0::width=1920 sink_0::height=1080 sink_1::xpos=0 sink_1::ypos=120 sink_1::width=1494 sink_1::height=840  sink_2::xpos=1494 sink_2::ypos=120 sink_2::width=426 sink_2::height=240 ! tee name=t3 ! queue ! nvvidconv ! queue ! nvv4l2h264enc maxperf-enable=1 bitrate=${bitrate} profile=4 ! queue ! h264parse ! queue ! mux3. liveadder name=mixer ! voaacenc ! queue ! mux3. a1. ! queue ! mixer.sink_0 a2. ! queue ! mixer.sink_1 flvmux name=mux3 ! rtmpsink location="rtmp://localhost/live" t3. ! nvvidconv ! nvoverlaysink liveadder name=mix ! queue ! audioconvert ! audioresample ! "audio/x-raw,rate=48000,channels=2,format=S16LE" ! alsasink device="hw:0,3" sync=false async=false a1. ! queue ! mix.sink_0 a2. ! queue ! mix.sink_1 t5. ! queue ! comp3.sink_0 t1. ! video/x-raw, width=1920, height=1080, framerate=60/1 ! videorate ! video/x-raw, width=1920, height=1080, framerate=10/1 ! queue ! nvvidconv ! queue ! "video/x-raw(memory:NVMM),width=1920, height=1080,format=NV12" ! queue ! comp3.sink_1 t2. ! queue ! image/jpeg,width=1920,height=1080,framerate=30/1 ! videorate ! image/jpeg,width=1920,height=1080,framerate=10/1 ! nvv4l2decoder mjpeg=1 ! nvvidconv ! queue ! "video/x-raw(memory:NVMM),width=426,height=240,format=NV12" ! queue ! comp3.sink_2 nvcompositor name=comp3 sink_0::width=1920 sink_0::height=1080 sink_1::xpos=0 sink_1::ypos=120 sink_1::width=1494 sink_1::height=840 sink_2::xpos=1494 sink_2::ypos=120 sink_2::width=426 sink_2::height=240 ! queue ! nvvidconv ! "video/x-raw(memory:NVMM),framerate=1/1,format=I420" ! queue ! nvjpegenc ! jpegparse ! multifilesink location=p1.jpg async=false liveadder name=mix4 ! queue ! audioconvert ! audioresample ! "audio/x-raw,rate=48000,channels=2,format=S16LE" ! alsasink device="hw:externAud,0" sync=false async=false a1. ! queue ! mix4.sink_0 a2. ! queue ! mix4.sink_1`;


    // SBS, SBS, SBS 144
    let stval_sbs_sbs_144_yuyv = ``;
    let stval_sbs_sbs_144_mjpg = ``;

    // SBS, 5050 , 5050 240

    let stval_sbs_50_50_240_yuyv = `gst-launch-1.0 -e videotestsrc pattern=black ! video/x-raw, width=320, height=240 ! nvvidconv ! queue ! tee name=t5 ! queue ! comp1.sink_0 v4l2src device=/dev/presentation ! queue ! tee name=t1 ! video/x-raw, width=1920, height=1080, framerate=60/1 ! videorate ! video/x-raw, width=1920, height=1080, framerate=${fpsp1}/1 ! nvvidconv ! queue ! "video/x-raw(memory:NVMM),width=1494,height=840,format=NV12" ! queue ! comp1.sink_1 v4l2src device=/dev/presenter ! tee name=t2 ! queue ! video/x-raw, width=1920, height=1080, framerate=30/1 ! videorate ! video/x-raw, width=1920, height=1080, framerate=${fpsp2}/1 ! nvvidconv ! queue ! "video/x-raw(memory:NVMM),width=426,height=240,format=NV12" ! queue ! comp1.sink_2 nvcompositor name=comp1 sink_0::width=1920 sink_0::height=1080 sink_1::xpos=0 sink_1::ypos=120 sink_1::width=1494 sink_1::height=840 sink_2::xpos=1494 sink_2::ypos=120 sink_2::width=426 sink_2::height=240 ! tee name=t4 ! queue ! nvvidconv ! queue ! nvv4l2h264enc maxperf-enable=1 bitrate=${bitrate} profile=4 ! queue ! h264parse ! queue ! mux. liveadder name=mix1 ! queue ! audioconvert ! voaacenc ! mux. alsasrc device="hw:externAud,0" ! queue ! audio/x-raw ! queue ! audioresample ! "audio/x-raw,rate=48000" ! tee name=a1 ! queue ! mix1.sink_0 alsasrc device="hw:channel1,0" ! queue ! audio/x-raw ! queue ! audioresample ! "audio/x-raw,rate=48000" ! tee name=a2 ! queue ! mix1.sink_1 mpegtsmux name=mux ! filesink location="/media/${hdduuid}/record-ts/${filename}.ts" videotestsrc pattern=black ! video/x-raw,width=320,height=240 ! nvvidconv ! queue ! comp.sink_0 t1. ! video/x-raw, width=1920, height=1080, framerate=60/1 ! videorate ! video/x-raw, width=1920, height=1080, framerate=${fpsp1}/1 ! queue ! nvvidconv ! queue ! "video/x-raw(memory:NVMM),width=960,height=540,format=NV12" ! queue ! comp.sink_1 t2. ! queue ! video/x-raw, width=1920, height=1080, framerate=30/1 ! videorate ! video/x-raw, width=1920, height=1080, framerate=${fpsp2}/1 ! nvvidconv ! queue ! "video/x-raw(memory:NVMM),width=960,height=540,format=NV12" ! queue ! comp.sink_2 nvcompositor name=comp sink_0::width=1920 sink_0::height=1080 sink_1::xpos=0 sink_1::ypos=270 sink_1::width=960 sink_1::height=540  sink_2::xpos=960 sink_2::ypos=270 sink_2::width=960 sink_2::height=540 ! tee name=t3 ! queue ! nvvidconv ! queue ! nvv4l2h264enc maxperf-enable=1 bitrate=${bitrate} profile=4 ! queue ! h264parse ! queue ! mux3. liveadder name=mixer ! voaacenc ! queue ! mux3. a1. ! queue ! mixer.sink_0 a2. ! queue ! mixer.sink_1 flvmux name=mux3 ! rtmpsink location="rtmp://localhost/live" t3. ! nvvidconv ! nvoverlaysink liveadder name=mix ! queue ! audioconvert ! audioresample ! "audio/x-raw,rate=48000,channels=2,format=S16LE" ! alsasink device="hw:0,3" sync=false async=false a1. ! queue ! mix.sink_0 a2. ! queue ! mix.sink_1 t5. ! queue ! comp3.sink_0 t1. ! video/x-raw, width=1920, height=1080, framerate=60/1 ! videorate ! video/x-raw, width=1920, height=1080, framerate=10/1 ! queue ! nvvidconv ! queue ! "video/x-raw(memory:NVMM),width=1920, height=1080,format=NV12" ! queue ! comp3.sink_1 t2. ! queue ! video/x-raw, width=1920, height=1080, framerate=30/1 ! videorate ! video/x-raw, width=1920, height=1080, framerate=${fpsp2}/1 ! nvvidconv ! queue ! "video/x-raw(memory:NVMM),width=426,height=240,format=NV12" ! queue ! comp3.sink_2 nvcompositor name=comp3 sink_0::width=1920 sink_0::height=1080 sink_1::xpos=0 sink_1::ypos=120 sink_1::width=1494 sink_1::height=840 sink_2::xpos=1494 sink_2::ypos=120 sink_2::width=426 sink_2::height=240 ! queue ! nvvidconv ! "video/x-raw(memory:NVMM),framerate=1/1,format=I420" ! queue ! nvjpegenc ! jpegparse ! multifilesink location=p1.jpg async=false liveadder name=mix4 ! queue ! audioconvert ! audioresample ! "audio/x-raw,rate=48000,channels=2,format=S16LE" ! alsasink device="hw:externAud,0" sync=false async=false a1. ! queue ! mix4.sink_0 a2. ! queue ! mix4.sink_1`;
    let stval_sbs_50_50_240_mjpg = `gst-launch-1.0 -e videotestsrc pattern=black ! video/x-raw,width=320,height=240 ! nvvidconv ! queue ! tee name=t5 ! queue ! comp1.sink_0 v4l2src device=/dev/presentation ! queue ! tee name=t1 ! video/x-raw, width=1920, height=1080, framerate=60/1 ! videorate ! video/x-raw, width=1920, height=1080, framerate=${fpsp1}/1 ! nvvidconv ! queue ! "video/x-raw(memory:NVMM),width=1494,height=840,format=NV12" ! queue ! comp1.sink_1 v4l2src device=/dev/exCAM io-mode=2 ! tee name=t2 ! queue ! image/jpeg,width=1920,height=1080,framerate=30/1 ! videorate ! image/jpeg,width=1920,height=1080,framerate=${fpsp2}/1 ! nvv4l2decoder mjpeg=1 ! nvvidconv ! queue ! "video/x-raw(memory:NVMM),width=426,height=240,format=NV12" ! queue ! comp1.sink_2 nvcompositor name=comp1 sink_0::width=1920 sink_0::height=1080 sink_1::xpos=0 sink_1::ypos=120 sink_1::width=1494 sink_1::height=840 sink_2::xpos=1494 sink_2::ypos=120 sink_2::width=426 sink_2::height=240 ! tee name=t4 ! queue ! nvvidconv ! queue ! nvv4l2h264enc maxperf-enable=1 bitrate=${bitrate} profile=4 ! queue ! h264parse ! queue ! mux. liveadder name=mix1 ! queue ! audioconvert ! voaacenc ! mux. alsasrc device="hw:externAud,0" ! queue ! audio/x-raw ! queue ! audioresample ! "audio/x-raw,rate=48000" ! tee name=a1 ! queue ! mix1.sink_0 alsasrc device="hw:channel1,0" ! queue ! audio/x-raw ! queue ! audioresample ! "audio/x-raw,rate=48000" ! tee name=a2 ! queue ! mix1.sink_1 mpegtsmux name=mux ! filesink location="/media/${hdduuid}/record-ts/${filename}.ts" videotestsrc pattern=black ! video/x-raw,width=320,height=240 ! nvvidconv ! queue ! comp.sink_0 t1. ! video/x-raw, width=1920, height=1080, framerate=60/1 ! videorate ! video/x-raw, width=1920, height=1080, framerate=${fpsp1}/1 ! queue ! nvvidconv ! queue ! "video/x-raw(memory:NVMM),width=960,height=540,format=NV12" ! queue ! comp.sink_1 t2. ! queue ! image/jpeg,width=1920,height=1080,framerate=30/1 ! videorate ! image/jpeg,width=1920,height=1080,framerate=${fpsp2}/1 ! nvv4l2decoder mjpeg=1 ! nvvidconv ! queue ! "video/x-raw(memory:NVMM),width=960,height=540,format=NV12" ! queue ! comp.sink_2 nvcompositor name=comp sink_0::width=1920 sink_0::height=1080 sink_1::xpos=0 sink_1::ypos=270 sink_1::width=960 sink_1::height=540  sink_2::xpos=960 sink_2::ypos=270 sink_2::width=960 sink_2::height=540 ! tee name=t3 ! queue ! nvvidconv ! queue ! nvv4l2h264enc maxperf-enable=1 bitrate=${bitrate} profile=4 ! queue ! h264parse ! queue ! mux3. liveadder name=mixer ! voaacenc ! queue ! mux3. a1. ! queue ! mixer.sink_0 a2. ! queue ! mixer.sink_1 flvmux name=mux3 ! rtmpsink location="rtmp://localhost/live" t3. ! nvvidconv ! nvoverlaysink liveadder name=mix ! queue ! audioconvert ! audioresample ! "audio/x-raw,rate=48000,channels=2,format=S16LE" ! alsasink device="hw:0,3" sync=false async=false a1. ! queue ! mix.sink_0 a2. ! queue ! mix.sink_1 t5. ! queue ! comp3.sink_0 t1. ! video/x-raw, width=1920, height=1080, framerate=60/1 ! videorate ! video/x-raw, width=1920, height=1080, framerate=10/1 ! queue ! nvvidconv ! queue ! "video/x-raw(memory:NVMM),width=1920, height=1080,format=NV12" ! queue ! comp3.sink_1 t2. ! queue ! image/jpeg,width=1920,height=1080,framerate=30/1 ! videorate ! image/jpeg,width=1920,height=1080,framerate=10/1 ! nvv4l2decoder mjpeg=1 ! nvvidconv ! queue ! "video/x-raw(memory:NVMM),width=426,height=240,format=NV12" ! queue ! comp3.sink_2 nvcompositor name=comp3 sink_0::width=1920 sink_0::height=1080 sink_1::xpos=0 sink_1::ypos=120 sink_1::width=1494 sink_1::height=840 sink_2::xpos=1494 sink_2::ypos=120 sink_2::width=426 sink_2::height=240 ! queue ! nvvidconv ! "video/x-raw(memory:NVMM),framerate=1/1,format=I420" ! queue ! nvjpegenc ! jpegparse ! multifilesink location=p1.jpg async=false liveadder name=mix4 ! queue ! audioconvert ! audioresample ! "audio/x-raw,rate=48000,channels=2,format=S16LE" ! alsasink device="hw:externAud,0" sync=false async=false a1. ! queue ! mix4.sink_0 a2. ! queue ! mix4.sink_1`;


    // SBS, 5050 , 5050 144
    let stval_sbs_50_50_144_yuyv = ``;
    let stval_sbs_50_50_144_mjpg = ``;

    // SBS Single Single - presentation 240

    let stval_sbs_p1_p1_yuyv_240 = `gst-launch-1.0 -e videotestsrc pattern=black ! video/x-raw,width=320,height=240 ! nvvidconv ! queue ! tee name=t5 ! queue ! comp1.sink_0 v4l2src device=/dev/presentation ! queue ! tee name=t1 ! video/x-raw, width=1920, height=1080, framerate=60/1 ! videorate ! video/x-raw, width=1920, height=1080, framerate=${fpsp1}/1 ! nvvidconv ! queue ! "video/x-raw(memory:NVMM),width=1494,height=1080,format=NV12" ! queue ! comp1.sink_1 v4l2src device=/dev/presenter ! tee name=t2 ! queue ! video/x-raw, width=1920, height=1080, framerate=30/1 ! videorate ! video/x-raw, width=1920, height=1080, framerate=${fpsp2}/1 ! nvvidconv ! queue ! "video/x-raw(memory:NVMM),width=426,height=240,format=NV12" ! queue ! comp1.sink_2 nvcompositor name=comp1 sink_0::width=1920 sink_0::height=1080 sink_1::xpos=0 sink_1::ypos=0 sink_1::width=1494 sink_1::height=1080 sink_2::xpos=1494 sink_2::ypos=0 sink_2::width=426 sink_2::height=240 ! tee name=t4 ! queue ! nvvidconv ! queue ! nvv4l2h264enc maxperf-enable=1 bitrate=${bitrate} profile=4 ! queue ! h264parse ! queue ! mux. liveadder name=mix1 ! queue ! audioconvert ! voaacenc ! mux. alsasrc device="hw:externAud,0" ! queue ! audio/x-raw ! queue ! audioresample ! "audio/x-raw,rate=48000" ! tee name=a1 ! queue ! mix1.sink_0 alsasrc device="hw:channel1,0" ! queue ! audio/x-raw ! queue ! audioresample ! "audio/x-raw,rate=48000" ! tee name=a2 ! queue ! mix1.sink_1 mpegtsmux name=mux ! filesink location="/media/${hdduuid}/record-ts/${filename}.ts" t5. ! queue ! comp.sink_0 t1. ! video/x-raw, width=1920, height=1080, framerate=60/1 ! videorate ! video/x-raw, width=1920, height=1080, framerate=${fpsp1}/1 ! queue ! nvvidconv ! queue ! "video/x-raw(memory:NVMM),width=1920,height=1080,format=NV12" ! queue ! comp.sink_1 nvcompositor name=comp sink_0::width=1920 sink_0::height=1080 sink_1::xpos=0 sink_1::ypos=0 sink_1::width=1920 sink_1::height=1080 ! tee name=t3 ! queue ! nvvidconv ! queue ! nvv4l2h264enc maxperf-enable=1 bitrate=${bitrate} profile=4 ! queue ! h264parse ! queue ! mux3. liveadder name=mixer ! voaacenc ! queue ! mux3. a1. ! queue ! mixer.sink_0 a2. ! queue ! mixer.sink_1 flvmux name=mux3 ! rtmpsink location="rtmp://localhost/live" t3. ! nvvidconv ! nvoverlaysink liveadder name=mix ! queue ! audioconvert ! audioresample ! "audio/x-raw,rate=48000,channels=2,format=S16LE" ! alsasink device="hw:0,3" sync=false async=false a1. ! queue ! mix.sink_0 a2. ! queue ! mix.sink_1 t5. ! queue ! comp3.sink_0 t1. ! video/x-raw, width=1920, height=1080, framerate=60/1 ! videorate ! video/x-raw, width=1920, height=1080, framerate=10/1 ! queue ! nvvidconv ! queue ! "video/x-raw(memory:NVMM),width=1920, height=1080,format=NV12" ! queue ! comp3.sink_1 t2. ! queue ! video/x-raw, width=1920, height=1080, framerate=30/1 ! videorate ! video/x-raw, width=1920, height=1080, framerate=${fpsp2}/1 ! nvvidconv ! queue ! "video/x-raw(memory:NVMM),width=426,height=240,format=NV12" ! queue ! comp3.sink_2 nvcompositor name=comp3 sink_0::width=1920 sink_0::height=1080 sink_1::xpos=0 sink_1::ypos=0 sink_1::width=1494 sink_1::height=1080 sink_2::xpos=1494 sink_2::ypos=0 sink_2::width=426 sink_2::height=240 ! queue ! nvvidconv ! "video/x-raw(memory:NVMM),framerate=1/1,format=I420" ! queue ! nvjpegenc ! jpegparse ! multifilesink location=p1.jpg async=false liveadder name=mix4 ! queue ! audioconvert ! audioresample ! "audio/x-raw,rate=48000,channels=2,format=S16LE" ! alsasink device="hw:externAud,0" sync=false async=false a1. ! queue ! mix4.sink_0 a2. ! queue ! mix4.sink_1`;
    let stval_sbs_p1_p1_mjpg_240 = `gst-launch-1.0 -e videotestsrc pattern=black ! video/x-raw,width=320,height=240 ! nvvidconv ! queue ! tee name=t5 ! queue ! comp1.sink_0 v4l2src device=/dev/presentation ! queue ! tee name=t1 ! video/x-raw, width=1920, height=1080, framerate=60/1 ! videorate ! video/x-raw, width=1920, height=1080, framerate=${fpsp1}/1 ! nvvidconv ! queue ! "video/x-raw(memory:NVMM),width=1494,height=1080,format=NV12" ! queue ! comp1.sink_1 v4l2src device=/dev/exCAM io-mode=2 ! tee name=t2 ! queue ! image/jpeg,width=1920,height=1080,framerate=30/1 ! videorate ! image/jpeg,width=1920,height=1080,framerate=${fpsp2}/1 ! nvv4l2decoder mjpeg=1 ! nvvidconv ! queue ! "video/x-raw(memory:NVMM),width=426,height=240,format=NV12" ! queue ! comp1.sink_2 nvcompositor name=comp1 sink_0::width=1920 sink_0::height=1080 sink_1::xpos=0 sink_1::ypos=120 sink_1::width=1494 sink_1::height=840 sink_2::xpos=1494 sink_2::ypos=120 sink_2::width=426 sink_2::height=240 ! tee name=t4 ! queue ! nvvidconv ! queue ! nvv4l2h264enc maxperf-enable=1 bitrate=${bitrate} profile=4 ! queue ! h264parse ! queue ! mux. liveadder name=mix1 ! queue ! audioconvert ! voaacenc ! mux. alsasrc device="hw:externAud,0" ! queue ! audio/x-raw ! queue ! audioresample ! "audio/x-raw,rate=48000" ! tee name=a1 ! queue ! mix1.sink_0 alsasrc device="hw:channel1,0" ! queue ! audio/x-raw ! queue ! audioresample ! "audio/x-raw,rate=48000" ! tee name=a2 ! queue ! mix1.sink_1 mpegtsmux name=mux ! filesink location="/media/${hdduuid}/record-ts/${filename}.ts" t5. ! queue ! comp.sink_0 t1. ! video/x-raw, width=1920, height=1080, framerate=60/1 ! videorate ! video/x-raw, width=1920, height=1080, framerate=${fpsp1}/1 ! queue ! nvvidconv ! queue ! "video/x-raw(memory:NVMM),width=1920,height=1080,format=NV12" ! queue ! comp.sink_1 nvcompositor name=comp sink_0::width=1920 sink_0::height=1080 sink_1::xpos=0 sink_1::ypos=0 sink_1::width=1920 sink_1::height=1080 ! tee name=t3 ! queue ! nvvidconv ! queue ! nvv4l2h264enc maxperf-enable=1 bitrate=${bitrate} profile=4 ! queue ! h264parse ! queue ! mux3. liveadder name=mixer ! voaacenc ! queue ! mux3. a1. ! queue ! mixer.sink_0 a2. ! queue ! mixer.sink_1 flvmux name=mux3 ! rtmpsink location="rtmp://localhost/live" t3. ! nvvidconv ! nvoverlaysink liveadder name=mix ! queue ! audioconvert ! audioresample ! "audio/x-raw,rate=48000,channels=2,format=S16LE" ! alsasink device="hw:0,3" sync=false async=false a1. ! queue ! mix.sink_0 a2. ! queue ! mix.sink_1  t5. ! queue ! comp3.sink_0 t1. ! video/x-raw, width=1920, height=1080, framerate=60/1 ! videorate ! video/x-raw, width=1920, height=1080, framerate=10/1 ! queue ! nvvidconv ! queue ! "video/x-raw(memory:NVMM),width=1920, height=1080,format=NV12" ! queue ! comp3.sink_1 t2. ! queue ! image/jpeg,width=1920,height=1080,framerate=30/1 ! videorate ! image/jpeg,width=1920,height=1080,framerate=10/1 ! nvv4l2decoder mjpeg=1 ! nvvidconv ! queue ! "video/x-raw(memory:NVMM),width=426,height=240,format=NV12" ! queue ! comp3.sink_2 nvcompositor name=comp3 sink_0::width=1920 sink_0::height=1080 sink_1::xpos=0 sink_1::ypos=120 sink_1::width=1494 sink_1::height=840 sink_2::xpos=1494 sink_2::ypos=120 sink_2::width=426 sink_2::height=240 ! queue ! nvvidconv ! "video/x-raw(memory:NVMM),framerate=1/1,format=I420" ! queue ! nvjpegenc ! jpegparse ! multifilesink location=p1.jpg async=false liveadder name=mix4 ! queue ! audioconvert ! audioresample ! "audio/x-raw,rate=48000,channels=2,format=S16LE" ! alsasink device="hw:externAud,0" sync=false async=false a1. ! queue ! mix4.sink_0 a2. ! queue ! mix4.sink_1`;


    // SBS Single Single - presentation 144
    let stval_sbs_p1_p1_yuyv_144 = ``;
    let stval_sbs_p1_p1_mjpg_144 = ``;

    // SBS Single Single - presenter 240

    let stval_sbs_p2_p2_yuyv_240 = `gst-launch-1.0 -e videotestsrc pattern=black ! video/x-raw,width=320,height=240 ! nvvidconv ! queue ! tee name=t5 ! queue ! comp1.sink_0 v4l2src device=/dev/presentation ! queue ! tee name=t1 ! video/x-raw, width=1920, height=1080, framerate=60/1 ! videorate ! video/x-raw, width=1920, height=1080, framerate=${fpsp1}/1 ! nvvidconv ! queue ! "video/x-raw(memory:NVMM),width=1494,height=840,format=NV12" ! queue ! comp1.sink_1 v4l2src device=/dev/presenter ! tee name=t2 ! queue ! video/x-raw, width=1920, height=1080, framerate=30/1 ! videorate ! video/x-raw, width=1920, height=1080, framerate=${fpsp2}/1 ! nvvidconv ! queue ! "video/x-raw(memory:NVMM),width=426,height=240,format=NV12" ! queue ! comp1.sink_2 nvcompositor name=comp1 sink_0::width=1920 sink_0::height=1080 sink_1::xpos=0 sink_1::ypos=120 sink_1::width=1494 sink_1::height=840 sink_2::xpos=1494 sink_2::ypos=120 sink_2::width=426 sink_2::height=240 ! tee name=t4 ! queue ! nvvidconv ! queue ! nvv4l2h264enc maxperf-enable=1 bitrate=${bitrate} profile=4 ! queue ! h264parse ! queue ! mux. liveadder name=mix1 ! queue ! audioconvert ! voaacenc ! mux. alsasrc device="hw:externAud,0" ! queue ! audio/x-raw ! queue ! audioresample ! "audio/x-raw,rate=48000" ! tee name=a1 ! queue ! mix1.sink_0 alsasrc device="hw:channel1,0" ! queue ! audio/x-raw ! queue ! audioresample ! "audio/x-raw,rate=48000" ! tee name=a2 ! queue ! mix1.sink_1 mpegtsmux name=mux ! filesink location="/media/${hdduuid}/record-ts/${filename}.ts" t5. ! queue ! comp.sink_0 t2. ! video/x-raw, width=1920, height=1080, framerate=30/1 ! videorate ! video/x-raw, width=1920, height=1080, framerate=30/1 ! queue ! nvvidconv ! queue ! "video/x-raw(memory:NVMM),width=1920,height=1080,format=NV12" ! queue ! comp.sink_1 nvcompositor name=comp sink_0::width=1920 sink_0::height=1080 sink_1::xpos=0 sink_1::ypos=0 sink_1::width=1920 sink_1::height=1080 ! tee name=t3 ! queue ! nvvidconv ! queue ! nvv4l2h264enc maxperf-enable=1 bitrate=${bitrate} profile=4 ! queue ! h264parse ! queue ! mux3. liveadder name=mixer ! voaacenc ! queue ! mux3. a1. ! queue ! mixer.sink_0 a2. ! queue ! mixer.sink_1 flvmux name=mux3 ! rtmpsink location="rtmp://localhost/live" t3. ! nvvidconv ! nvoverlaysink liveadder name=mix ! queue ! audioconvert ! audioresample ! "audio/x-raw,rate=48000,channels=2,format=S16LE" ! alsasink device="hw:0,3" sync=false async=false a1. ! queue ! mix.sink_0 a2. ! queue ! mix.sink_1 t5. ! queue ! comp3.sink_0 t1. ! video/x-raw, width=1920, height=1080, framerate=60/1 ! videorate ! video/x-raw, width=1920, height=1080, framerate=10/1 ! queue ! nvvidconv ! queue ! "video/x-raw(memory:NVMM),width=1920, height=1080,format=NV12" ! queue ! comp3.sink_1 t2. ! queue ! video/x-raw, width=1920, height=1080, framerate=30/1 ! videorate ! video/x-raw, width=1920, height=1080, framerate=${fpsp2}/1 ! nvvidconv ! queue ! "video/x-raw(memory:NVMM),width=426,height=240,format=NV12" ! queue ! comp3.sink_2 nvcompositor name=comp3 sink_0::width=1920 sink_0::height=1080 sink_1::xpos=0 sink_1::ypos=120 sink_1::width=1494 sink_1::height=840 sink_2::xpos=1494 sink_2::ypos=120 sink_2::width=426 sink_2::height=240 ! queue ! nvvidconv ! "video/x-raw(memory:NVMM),framerate=1/1,format=I420" ! queue ! nvjpegenc ! jpegparse ! multifilesink location=p1.jpg async=false liveadder name=mix4 ! queue ! audioconvert ! audioresample ! "audio/x-raw,rate=48000,channels=2,format=S16LE" ! alsasink device="hw:externAud,0" sync=false async=false a1. ! queue ! mix4.sink_0 a2. ! queue ! mix4.sink_1`;
    let stval_sbs_p2_p2_mjpg_240 = `gst-launch-1.0 -e videotestsrc pattern=black ! video/x-raw,width=320,height=240 ! nvvidconv ! queue ! tee name=t5 ! queue ! comp1.sink_0 v4l2src device=/dev/presentation ! queue ! tee name=t1 ! video/x-raw, width=1920, height=1080, framerate=60/1 ! videorate ! video/x-raw, width=1920, height=1080, framerate=${fpsp1}/1 ! nvvidconv ! queue ! "video/x-raw(memory:NVMM),width=1494,height=840,format=NV12" ! queue ! comp1.sink_1 v4l2src device=/dev/exCAM io-mode=2 ! tee name=t2 ! queue ! image/jpeg,width=1920,height=1080,framerate=30/1 ! videorate ! image/jpeg,width=1920,height=1080,framerate=${fpsp2}/1 ! nvv4l2decoder mjpeg=1 ! nvvidconv ! queue ! "video/x-raw(memory:NVMM),width=426,height=240,format=NV12" ! queue ! comp1.sink_2 nvcompositor name=comp1 sink_0::width=1920 sink_0::height=1080 sink_1::xpos=0 sink_1::ypos=120 sink_1::width=1494 sink_1::height=840 sink_2::xpos=1494 sink_2::ypos=120 sink_2::width=426 sink_2::height=240 ! tee name=t4 ! queue ! nvvidconv ! queue ! nvv4l2h264enc maxperf-enable=1 bitrate=${bitrate} profile=4 ! queue ! h264parse ! queue ! mux. liveadder name=mix1 ! queue ! audioconvert ! voaacenc ! mux. alsasrc device="hw:externAud,0" ! queue ! audio/x-raw ! queue ! audioresample ! "audio/x-raw,rate=48000" ! tee name=a1 ! queue ! mix1.sink_0 alsasrc device="hw:channel1,0" ! queue ! audio/x-raw ! queue ! audioresample ! "audio/x-raw,rate=48000" ! tee name=a2 ! queue ! mix1.sink_1 mpegtsmux name=mux ! filesink location="/media/${hdduuid}/record-ts/${filename}.ts" t5. ! queue ! comp.sink_0 t2. ! queue ! image/jpeg,width=1920,height=1080,framerate=30/1 ! videorate ! image/jpeg,width=1920,height=1080,framerate=${fpsp2}/1 ! nvv4l2decoder mjpeg=1 ! nvvidconv ! queue ! "video/x-raw(memory:NVMM),width=1920,height=1080,format=NV12" ! queue ! comp.sink_1 nvcompositor name=comp sink_0::width=1920 sink_0::height=1080 sink_1::xpos=0 sink_1::ypos=0 sink_1::width=1920 sink_1::height=1080 ! tee name=t3 ! queue ! nvvidconv ! queue ! nvv4l2h264enc maxperf-enable=1 bitrate=${bitrate} profile=4 ! queue ! h264parse ! queue ! mux3. liveadder name=mixer ! voaacenc ! queue ! mux3. a1. ! queue ! mixer.sink_0 a2. ! queue ! mixer.sink_1 flvmux name=mux3 ! rtmpsink location="rtmp://localhost/live" t3. ! nvvidconv ! nvoverlaysink liveadder name=mix ! queue ! audioconvert ! audioresample ! "audio/x-raw,rate=48000,channels=2,format=S16LE" ! alsasink device="hw:0,3" sync=false async=false a1. ! queue ! mix.sink_0 a2. ! queue ! mix.sink_1 t5. ! queue ! comp3.sink_0 t1. ! video/x-raw, width=1920, height=1080, framerate=60/1 ! videorate ! video/x-raw, width=1920, height=1080, framerate=10/1 ! queue ! nvvidconv ! queue ! "video/x-raw(memory:NVMM),width=1920, height=1080,format=NV12" ! queue ! comp3.sink_1 t2. ! queue ! image/jpeg,width=1920,height=1080,framerate=30/1 ! videorate ! image/jpeg,width=1920,height=1080,framerate=10/1 ! nvv4l2decoder mjpeg=1 ! nvvidconv ! queue ! "video/x-raw(memory:NVMM),width=426,height=240,format=NV12" ! queue ! comp3.sink_2 nvcompositor name=comp3 sink_0::width=1920 sink_0::height=1080 sink_1::xpos=0 sink_1::ypos=120 sink_1::width=1494 sink_1::height=840 sink_2::xpos=1494 sink_2::ypos=120 sink_2::width=426 sink_2::height=240 ! queue ! nvvidconv ! "video/x-raw(memory:NVMM),framerate=1/1,format=I420" ! queue ! nvjpegenc ! jpegparse ! multifilesink location=p1.jpg async=false liveadder name=mix4 ! queue ! audioconvert ! audioresample ! "audio/x-raw,rate=48000,channels=2,format=S16LE" ! alsasink device="hw:externAud,0" sync=false async=false a1. ! queue ! mix4.sink_0 a2. ! queue ! mix4.sink_1`;


    // SBS Single Single - presenter 144
    let stval_sbs_p2_p2_yuyv_144 = ``;
    let stval_sbs_p2_p2_mjpg_144 = ``;

    // 5050,SBS,SBS 240

    let stval_50_sbs_sbs_yuyv_240 = `gst-launch-1.0 -e videotestsrc pattern=black ! video/x-raw,width=320,height=240 ! nvvidconv ! queue ! tee name=t5 ! queue ! comp1.sink_0 v4l2src device=/dev/presentation ! queue ! tee name=t1 ! video/x-raw, width=1920, height=1080, framerate=60/1 ! videorate ! video/x-raw, width=1920, height=1080, framerate=${fpsp1}/1 ! nvvidconv ! queue ! "video/x-raw(memory:NVMM),width=960,height=540,format=NV12" ! queue ! comp1.sink_1 v4l2src device=/dev/presenter ! tee name=t2 ! queue ! video/x-raw, width=1920, height=1080, framerate=30/1 ! videorate ! video/x-raw, width=1920, height=1080, framerate=${fpsp2}/1 ! nvvidconv ! queue ! "video/x-raw(memory:NVMM),width=960,height=540,format=NV12" ! queue ! comp1.sink_2 nvcompositor name=comp1 sink_0::width=1920 sink_0::height=1080 sink_1::xpos=0 sink_1::ypos=270 sink_1::width=960 sink_1::height=540 sink_2::xpos=960 sink_2::ypos=270 sink_2::width=960 sink_2::height=540 ! tee name=t4 ! queue ! nvvidconv ! queue ! nvv4l2h264enc maxperf-enable=1 bitrate=${bitrate} profile=4 ! queue ! h264parse ! queue ! mux. liveadder name=mix1 ! queue ! audioconvert ! voaacenc ! mux. alsasrc device="hw:externAud,0" ! queue ! audio/x-raw ! queue ! audioresample ! "audio/x-raw,rate=48000" ! tee name=a1 ! queue ! mix1.sink_0 alsasrc device="hw:channel1,0" ! queue ! audio/x-raw ! queue ! audioresample ! "audio/x-raw,rate=48000" ! tee name=a2 ! queue ! mix1.sink_1 mpegtsmux name=mux ! filesink location="/media/${hdduuid}/record-ts/${filename}.ts" t5. ! queue ! comp.sink_0 t1. ! video/x-raw, width=1920, height=1080, framerate=60/1 ! videorate ! video/x-raw, width=1920, height=1080, framerate=${fpsp1}/1 ! queue ! nvvidconv ! queue ! "video/x-raw(memory:NVMM),width=1494, height=840,format=NV12" ! queue ! comp.sink_1 t2. ! queue ! video/x-raw, width=1920, height=1080, framerate=30/1 ! videorate ! video/x-raw, width=1920, height=1080, framerate=${fpsp2}/1 ! nvvidconv ! queue ! "video/x-raw(memory:NVMM),width=426,height=240,format=NV12" ! queue ! comp.sink_2 nvcompositor name=comp sink_0::width=1920 sink_0::height=1080 sink_1::xpos=0 sink_1::ypos=120 sink_1::width=1494 sink_1::height=840  sink_2::xpos=1494 sink_2::ypos=120 sink_2::width=426 sink_2::height=240 ! tee name=t3 ! queue ! nvvidconv ! queue ! nvv4l2h264enc maxperf-enable=1 bitrate=${bitrate} profile=4 ! queue ! h264parse ! queue ! mux3. liveadder name=mixer ! voaacenc ! queue ! mux3. a1. ! queue ! mixer.sink_0 a2. ! queue ! mixer.sink_1 flvmux name=mux3 ! rtmpsink location="rtmp://localhost/live" t3. ! nvvidconv ! nvoverlaysink liveadder name=mix ! queue ! audioconvert ! audioresample ! "audio/x-raw,rate=48000,channels=2,format=S16LE" ! alsasink device="hw:0,3" sync=false async=false a1. ! queue ! mix.sink_0 a2. ! queue ! mix.sink_1 t5. ! queue ! comp3.sink_0 t1. ! video/x-raw, width=1920, height=1080, framerate=60/1 ! videorate ! video/x-raw, width=1920, height=1080, framerate=10/1 ! queue ! nvvidconv ! queue ! "video/x-raw(memory:NVMM),width=1920, height=1080,format=NV12" ! queue ! comp3.sink_1 t2. ! queue ! video/x-raw, width=1920, height=1080, framerate=30/1 ! videorate ! video/x-raw, width=1920, height=1080, framerate=${fpsp2}/1 ! nvvidconv ! queue ! "video/x-raw(memory:NVMM),width=426,height=240,format=NV12" ! queue ! comp3.sink_2 nvcompositor name=comp3 sink_0::width=1920 sink_0::height=1080 sink_1::xpos=0 sink_1::ypos=270 sink_1::width=960 sink_1::height=540 sink_2::xpos=960 sink_2::ypos=0 sink_2::width=960 sink_2::height=540 ! queue ! nvvidconv ! "video/x-raw(memory:NVMM),framerate=1/1,format=I420" ! queue ! nvjpegenc ! jpegparse ! multifilesink location=p1.jpg async=false liveadder name=mix4 ! queue ! audioconvert ! audioresample ! "audio/x-raw,rate=48000,channels=2,format=S16LE" ! alsasink device="hw:externAud,0" sync=false async=false a1. ! queue ! mix4.sink_0 a2. ! queue ! mix4.sink_1`;
    let stval_50_sbs_sbs_mjpg_240 = `gst-launch-1.0 -e videotestsrc pattern=black ! video/x-raw,width=320,height=240 ! nvvidconv ! queue ! tee name=t5 ! queue ! comp1.sink_0 v4l2src device=/dev/presentation ! queue ! tee name=t1 ! video/x-raw, width=1920, height=1080, framerate=60/1 ! videorate ! video/x-raw, width=1920, height=1080, framerate=${fpsp1}/1 ! nvvidconv ! queue ! "video/x-raw(memory:NVMM),width=960,height=540,format=NV12" ! queue ! comp1.sink_1 v4l2src device=/dev/exCAM io-mode=2 ! tee name=t2 ! queue ! image/jpeg,width=1920,height=1080,framerate=30/1 ! videorate ! image/jpeg,width=1920,height=1080,framerate=${fpsp2}/1 ! nvv4l2decoder mjpeg=1 ! nvvidconv ! queue ! "video/x-raw(memory:NVMM),width=960,height=540,format=NV12" ! queue ! comp1.sink_2 nvcompositor name=comp1 sink_0::width=1920 sink_0::height=1080 sink_1::xpos=0 sink_1::ypos=270 sink_1::width=960 sink_1::height=540 sink_2::xpos=960 sink_2::ypos=270 sink_2::width=960 sink_2::height=540 ! tee name=t4 ! queue ! nvvidconv ! queue ! nvv4l2h264enc maxperf-enable=1 bitrate=${bitrate} profile=4 ! queue ! h264parse ! queue ! mux. liveadder name=mix1 ! queue ! audioconvert ! voaacenc ! mux. alsasrc device="hw:externAud,0" ! queue ! audio/x-raw ! queue ! audioresample ! "audio/x-raw,rate=48000" ! tee name=a1 ! queue ! mix1.sink_0 alsasrc device="hw:channel1,0" ! queue ! audio/x-raw ! queue ! audioresample ! "audio/x-raw,rate=48000" ! tee name=a2 ! queue ! mix1.sink_1 mpegtsmux name=mux ! filesink location="/media/${hdduuid}/record-ts/${filename}.ts" t5. ! queue ! comp.sink_0 t1. ! video/x-raw, width=1920, height=1080, framerate=60/1 ! videorate ! video/x-raw, width=1920, height=1080, framerate=${fpsp1}/1 ! queue ! nvvidconv ! queue ! "video/x-raw(memory:NVMM),width=1494, height=840,format=NV12" ! queue ! comp.sink_1 t2. ! queue ! image/jpeg,width=1920,height=1080,framerate=30/1 ! videorate ! image/jpeg,width=1920,height=1080,framerate=${fpsp2}/1 ! nvv4l2decoder mjpeg=1 ! nvvidconv ! queue ! "video/x-raw(memory:NVMM),width=426,height=240,format=NV12" ! queue ! comp.sink_2 nvcompositor name=comp sink_0::width=1920 sink_0::height=1080 sink_1::xpos=0 sink_1::ypos=120 sink_1::width=1494 sink_1::height=840  sink_2::xpos=1494 sink_2::ypos=120 sink_2::width=426 sink_2::height=240 ! tee name=t3 ! queue ! nvvidconv ! queue ! nvv4l2h264enc maxperf-enable=1 bitrate=${bitrate} profile=4 ! queue ! h264parse ! queue ! mux3. liveadder name=mixer ! voaacenc ! queue ! mux3. a1. ! queue ! mixer.sink_0 a2. ! queue ! mixer.sink_1 flvmux name=mux3 ! rtmpsink location="rtmp://localhost/live" t3. ! nvvidconv ! nvoverlaysink liveadder name=mix ! queue ! audioconvert ! audioresample ! "audio/x-raw,rate=48000,channels=2,format=S16LE" ! alsasink device="hw:0,3" sync=false async=false a1. ! queue ! mix.sink_0 a2. ! queue ! mix.sink_1 t5. ! queue ! comp3.sink_0 t1. ! video/x-raw, width=1920, height=1080, framerate=60/1 ! videorate ! video/x-raw, width=1920, height=1080, framerate=10/1 ! queue ! nvvidconv ! queue ! "video/x-raw(memory:NVMM),width=1920, height=1080,format=NV12" ! queue ! comp3.sink_1 t2. ! queue ! image/jpeg,width=1920,height=1080,framerate=30/1 ! videorate ! image/jpeg,width=1920,height=1080,framerate=10/1 ! nvv4l2decoder mjpeg=1 ! nvvidconv ! queue ! "video/x-raw(memory:NVMM),width=960,height=540,format=NV12" ! queue ! comp3.sink_2 nvcompositor name=comp3 sink_0::width=1920 sink_0::height=1080 sink_1::xpos=0 sink_1::ypos=270 sink_1::width=960 sink_1::height=540 sink_2::xpos=960 sink_2::ypos=270 sink_2::width=960 sink_2::height=540 ! queue ! nvvidconv ! "video/x-raw(memory:NVMM),framerate=1/1,format=I420" ! queue ! nvjpegenc ! jpegparse ! multifilesink location=p1.jpg async=false liveadder name=mix4 ! queue ! audioconvert ! audioresample ! "audio/x-raw,rate=48000,channels=2,format=S16LE" ! alsasink device="hw:externAud,0" sync=false async=false a1. ! queue ! mix4.sink_0 a2. ! queue ! mix4.sink_1`;


    // 5050,SBS,SBS 144
    let stval_50_sbs_sbs_yuyv_144 = ``;
    let stval_50_sbs_sbs_mjpg_144 = ``;

    // 5050, 5050 , 5050 
    let stval_50_50_50_yuyv = `gst-launch-1.0 -e videotestsrc pattern=black ! video/x-raw,width=320,height=240 ! nvvidconv ! queue ! tee name=t5 ! queue ! comp1.sink_0 v4l2src device=/dev/presentation ! queue ! tee name=t1 ! video/x-raw, width=1920, height=1080, framerate=60/1 ! videorate ! video/x-raw, width=1920, height=1080, framerate=${fpsp1}/1 ! nvvidconv ! queue ! "video/x-raw(memory:NVMM),width=960,height=540,format=NV12" ! queue ! comp1.sink_1 v4l2src device=/dev/presenter ! tee name=t2 ! queue ! video/x-raw, width=1920, height=1080, framerate=30/1 ! videorate ! video/x-raw, width=1920, height=1080, framerate=${fpsp2}/1 ! nvvidconv ! queue ! "video/x-raw(memory:NVMM),width=960,height=540,format=NV12" ! queue ! comp1.sink_2 nvcompositor name=comp1 sink_0::width=1920 sink_0::height=1080 sink_1::xpos=0 sink_1::ypos=270 sink_1::width=960 sink_1::height=540 sink_2::xpos=960 sink_2::ypos=270 sink_2::width=960 sink_2::height=540 ! tee name=t4 ! queue ! nvvidconv ! queue ! nvv4l2h264enc maxperf-enable=1 bitrate=${bitrate} profile=4 ! queue ! h264parse ! queue ! mux. liveadder name=mix1 ! queue ! audioconvert ! voaacenc ! mux. alsasrc device="hw:externAud,0" ! queue ! audio/x-raw ! queue ! audioresample ! "audio/x-raw,rate=48000" ! tee name=a1 ! queue ! mix1.sink_0 alsasrc device="hw:channel1,0" ! queue ! audio/x-raw ! queue ! audioresample ! "audio/x-raw,rate=48000" ! tee name=a2 ! queue ! mix1.sink_1 mpegtsmux name=mux ! filesink location="/media/${hdduuid}/record-ts/${filename}.ts" videotestsrc pattern=black ! video/x-raw,width=320,height=240 ! nvvidconv ! queue ! comp.sink_0 t1. ! video/x-raw, width=1920, height=1080, framerate=60/1 ! videorate ! video/x-raw, width=1920, height=1080, framerate=${fpsp1}/1 ! queue ! nvvidconv ! queue ! "video/x-raw(memory:NVMM),width=960,height=540,format=NV12" ! queue ! comp.sink_1 t2. ! queue ! video/x-raw, width=1920, height=1080, framerate=30/1 ! videorate ! video/x-raw, width=1920, height=1080, framerate=${fpsp2}/1 ! nvvidconv ! queue ! "video/x-raw(memory:NVMM),width=960,height=540,format=NV12" ! queue ! comp.sink_2 nvcompositor name=comp sink_0::width=1920 sink_0::height=1080 sink_1::xpos=0 sink_1::ypos=270 sink_1::width=960 sink_1::height=540  sink_2::xpos=960 sink_2::ypos=270 sink_2::width=960 sink_2::height=540 ! tee name=t3 ! queue ! nvvidconv ! queue ! nvv4l2h264enc maxperf-enable=1 bitrate=${bitrate} profile=4 ! queue ! h264parse ! queue ! mux3. liveadder name=mixer ! voaacenc ! queue ! mux3. a1. ! queue ! mixer.sink_0 a2. ! queue ! mixer.sink_1 flvmux name=mux3 ! rtmpsink location="rtmp://localhost/live" t3. ! nvvidconv ! nvoverlaysink liveadder name=mix ! queue ! audioconvert ! audioresample ! "audio/x-raw,rate=48000,channels=2,format=S16LE" ! alsasink device="hw:0,3" sync=false async=false a1. ! queue ! mix.sink_0 a2. ! queue ! mix.sink_1 t5. ! queue ! comp3.sink_0 t1. ! video/x-raw, width=1920, height=1080, framerate=60/1 ! videorate ! video/x-raw, width=1920, height=1080, framerate=10/1 ! queue ! nvvidconv ! queue ! "video/x-raw(memory:NVMM),width=1920, height=1080,format=NV12" ! queue ! comp3.sink_1 t2. ! queue ! video/x-raw, width=1920, height=1080, framerate=30/1 ! videorate ! video/x-raw, width=1920, height=1080, framerate=${fpsp2}/1 ! nvvidconv ! queue ! "video/x-raw(memory:NVMM),width=426,height=240,format=NV12" ! queue ! comp3.sink_2 nvcompositor name=comp3 sink_0::width=1920 sink_0::height=1080 sink_1::xpos=0 sink_1::ypos=270 sink_1::width=960 sink_1::height=540 sink_2::xpos=960 sink_2::ypos=0 sink_2::width=960 sink_2::height=540 ! queue ! nvvidconv ! "video/x-raw(memory:NVMM),framerate=1/1,format=I420" ! queue ! nvjpegenc ! jpegparse ! multifilesink location=p1.jpg async=false liveadder name=mix4 ! queue ! audioconvert ! audioresample ! "audio/x-raw,rate=48000,channels=2,format=S16LE" ! alsasink device="hw:externAud,0" sync=false async=false a1. ! queue ! mix4.sink_0 a2. ! queue ! mix4.sink_1`;
    let stval_50_50_50_mjpg = `gst-launch-1.0 -e videotestsrc pattern=black ! video/x-raw,width=320,height=240 ! nvvidconv ! queue ! tee name=t5 ! queue ! comp1.sink_0 v4l2src device=/dev/presentation ! queue ! tee name=t1 ! video/x-raw, width=1920, height=1080, framerate=60/1 ! videorate ! video/x-raw, width=1920, height=1080, framerate=${fpsp1}/1 ! nvvidconv ! queue ! "video/x-raw(memory:NVMM),width=960,height=540,format=NV12" ! queue ! comp1.sink_1 v4l2src device=/dev/exCAM io-mode=2 ! tee name=t2 ! queue ! image/jpeg,width=1920,height=1080,framerate=30/1 ! videorate ! image/jpeg,width=1920,height=1080,framerate=${fpsp2}/1 ! nvv4l2decoder mjpeg=1 ! nvvidconv ! queue ! "video/x-raw(memory:NVMM),width=960,height=540,format=NV12" ! queue ! comp1.sink_2 nvcompositor name=comp1 sink_0::width=1920 sink_0::height=1080 sink_1::xpos=0 sink_1::ypos=270 sink_1::width=960 sink_1::height=540 sink_2::xpos=960 sink_2::ypos=270 sink_2::width=960 sink_2::height=540 ! tee name=t4 ! queue ! nvvidconv ! queue ! nvv4l2h264enc maxperf-enable=1 bitrate=${bitrate} profile=4 ! queue ! h264parse ! queue ! mux. liveadder name=mix1 ! queue ! audioconvert ! voaacenc ! mux. alsasrc device="hw:externAud,0" ! queue ! audio/x-raw ! queue ! audioresample ! "audio/x-raw,rate=48000" ! tee name=a1 ! queue ! mix1.sink_0 alsasrc device="hw:channel1,0" ! queue ! audio/x-raw ! queue ! audioresample ! "audio/x-raw,rate=48000" ! tee name=a2 ! queue ! mix1.sink_1 mpegtsmux name=mux ! filesink location="/media/${hdduuid}/record-ts/${filename}.ts" videotestsrc pattern=black ! video/x-raw,width=320,height=240 ! nvvidconv ! queue ! comp.sink_0 t1. ! video/x-raw, width=1920, height=1080, framerate=60/1 ! videorate ! video/x-raw, width=1920, height=1080, framerate=${fpsp1}/1 ! queue ! nvvidconv ! queue ! "video/x-raw(memory:NVMM),width=960,height=540,format=NV12" ! queue ! comp.sink_1 t2. ! queue ! image/jpeg,width=1920,height=1080,framerate=30/1 ! videorate ! image/jpeg,width=1920,height=1080,framerate=${fpsp2}/1 ! nvv4l2decoder mjpeg=1 ! nvvidconv ! queue ! "video/x-raw(memory:NVMM),width=960,height=540,format=NV12" ! queue ! comp.sink_2 nvcompositor name=comp sink_0::width=1920 sink_0::height=1080 sink_1::xpos=0 sink_1::ypos=270 sink_1::width=960 sink_1::height=540  sink_2::xpos=960 sink_2::ypos=270 sink_2::width=960 sink_2::height=540 ! tee name=t3 ! queue ! nvvidconv ! queue ! nvv4l2h264enc maxperf-enable=1 bitrate=${bitrate} profile=4 ! queue ! h264parse ! queue ! mux3. liveadder name=mixer ! voaacenc ! queue ! mux3. a1. ! queue ! mixer.sink_0 a2. ! queue ! mixer.sink_1 flvmux name=mux3 ! rtmpsink location="rtmp://localhost/live" t3. ! nvvidconv ! nvoverlaysink liveadder name=mix ! queue ! audioconvert ! audioresample ! "audio/x-raw,rate=48000,channels=2,format=S16LE" ! alsasink device="hw:0,3" sync=false async=false a1. ! queue ! mix.sink_0 a2. ! queue ! mix.sink_1 t5. ! queue ! comp3.sink_0 t1. ! video/x-raw, width=1920, height=1080, framerate=60/1 ! videorate ! video/x-raw, width=1920, height=1080, framerate=10/1 ! queue ! nvvidconv ! queue ! "video/x-raw(memory:NVMM),width=1920, height=1080,format=NV12" ! queue ! comp3.sink_1 t2. ! queue ! image/jpeg,width=1920,height=1080,framerate=30/1 ! videorate ! image/jpeg,width=1920,height=1080,framerate=10/1 ! nvv4l2decoder mjpeg=1 ! nvvidconv ! queue ! "video/x-raw(memory:NVMM),width=960,height=540,format=NV12" ! queue ! comp3.sink_2 nvcompositor name=comp3 sink_0::width=1920 sink_0::height=1080 sink_1::xpos=0 sink_1::ypos=270 sink_1::width=960 sink_1::height=540 sink_2::xpos=960 sink_2::ypos=270 sink_2::width=960 sink_2::height=540 ! queue ! nvvidconv ! "video/x-raw(memory:NVMM),framerate=1/1,format=I420" ! queue ! nvjpegenc ! jpegparse ! multifilesink location=p1.jpg async=false liveadder name=mix4 ! queue ! audioconvert ! audioresample ! "audio/x-raw,rate=48000,channels=2,format=S16LE" ! alsasink device="hw:externAud,0" sync=false async=false a1. ! queue ! mix4.sink_0 a2. ! queue ! mix4.sink_1`;

    // 5050 Single Single - presentation
    let stval_50_p1_p1_yuyv = `gst-launch-1.0 -e videotestsrc pattern=black ! video/x-raw,width=320,height=240 ! nvvidconv ! queue ! tee name=t5 ! queue ! comp1.sink_0 v4l2src device=/dev/presentation ! queue ! tee name=t1 ! video/x-raw, width=1920, height=1080, framerate=60/1 ! videorate ! video/x-raw, width=1920, height=1080, framerate=${fpsp1}/1 ! nvvidconv ! queue ! "video/x-raw(memory:NVMM),width=960,height=540,format=NV12" ! queue ! comp1.sink_1 v4l2src device=/dev/presenter ! tee name=t2 ! queue ! video/x-raw, width=1920, height=1080, framerate=30/1 ! videorate ! video/x-raw, width=1920, height=1080, framerate=${fpsp2}/1 ! nvvidconv ! queue ! "video/x-raw(memory:NVMM),width=960,height=540,format=NV12" ! queue ! comp1.sink_2 nvcompositor name=comp1 sink_0::width=1920 sink_0::height=1080 sink_1::xpos=0 sink_1::ypos=270 sink_1::width=960 sink_1::height=540 sink_2::xpos=960 sink_2::ypos=270 sink_2::width=960 sink_2::height=540 ! tee name=t4 ! queue ! nvvidconv ! queue ! nvv4l2h264enc maxperf-enable=1 bitrate=${bitrate} profile=4 ! queue ! h264parse ! queue ! mux. liveadder name=mix1 ! queue ! audioconvert ! voaacenc ! mux. alsasrc device="hw:externAud,0" ! queue ! audio/x-raw ! queue ! audioresample ! "audio/x-raw,rate=48000" ! tee name=a1 ! queue ! mix1.sink_0 alsasrc device="hw:channel1,0" ! queue ! audio/x-raw ! queue ! audioresample ! "audio/x-raw,rate=48000" ! tee name=a2 ! queue ! mix1.sink_1 mpegtsmux name=mux ! filesink location="/media/${hdduuid}/record-ts/${filename}.ts" t5. ! queue ! comp.sink_0 t1. ! video/x-raw, width=1920, height=1080, framerate=60/1 ! videorate ! video/x-raw, width=1920, height=1080, framerate=${fpsp1}/1 ! queue ! nvvidconv ! queue ! "video/x-raw(memory:NVMM),width=1920,height=1080,format=NV12" ! queue ! comp.sink_1 nvcompositor name=comp sink_0::width=1920 sink_0::height=1080 sink_1::xpos=0 sink_1::ypos=0 sink_1::width=1920 sink_1::height=1080 ! tee name=t3 ! queue ! nvvidconv ! queue ! nvv4l2h264enc maxperf-enable=1 bitrate=${bitrate} profile=4 ! queue ! h264parse ! queue ! mux3. liveadder name=mixer ! voaacenc ! queue ! mux3. a1. ! queue ! mixer.sink_0 a2. ! queue ! mixer.sink_1 flvmux name=mux3 ! rtmpsink location="rtmp://localhost/live" t3. ! nvvidconv ! nvoverlaysink liveadder name=mix ! queue ! audioconvert ! audioresample ! "audio/x-raw,rate=48000,channels=2,format=S16LE" ! alsasink device="hw:0,3" sync=false async=false a1. ! queue ! mix.sink_0 a2. ! queue ! mix.sink_1 t5. ! queue ! comp3.sink_0 t1. ! video/x-raw, width=1920, height=1080, framerate=60/1 ! videorate ! video/x-raw, width=1920, height=1080, framerate=10/1 ! queue ! nvvidconv ! queue ! "video/x-raw(memory:NVMM),width=1920, height=1080,format=NV12" ! queue ! comp3.sink_1 t2. ! queue ! video/x-raw, width=1920, height=1080, framerate=30/1 ! videorate ! video/x-raw, width=1920, height=1080, framerate=${fpsp2}/1 ! nvvidconv ! queue ! "video/x-raw(memory:NVMM),width=426,height=240,format=NV12" ! queue ! comp3.sink_2 nvcompositor name=comp3 sink_0::width=1920 sink_0::height=1080 sink_1::xpos=0 sink_1::ypos=270 sink_1::width=960 sink_1::height=540 sink_2::xpos=960 sink_2::ypos=0 sink_2::width=960 sink_2::height=540 ! queue ! nvvidconv ! "video/x-raw(memory:NVMM),framerate=1/1,format=I420" ! queue ! nvjpegenc ! jpegparse ! multifilesink location=p1.jpg async=false liveadder name=mix4 ! queue ! audioconvert ! audioresample ! "audio/x-raw,rate=48000,channels=2,format=S16LE" ! alsasink device="hw:externAud,0" sync=false async=false a1. ! queue ! mix4.sink_0 a2. ! queue ! mix4.sink_1`;
    let stval_50_p1_p1_mjpg = `gst-launch-1.0 -e videotestsrc pattern=black ! video/x-raw,width=320,height=240 ! nvvidconv ! queue ! tee name=t5 ! queue ! comp1.sink_0 v4l2src device=/dev/presentation ! queue ! tee name=t1 ! video/x-raw, width=1920, height=1080, framerate=60/1 ! videorate ! video/x-raw, width=1920, height=1080, framerate=${fpsp1}/1 ! nvvidconv ! queue ! "video/x-raw(memory:NVMM),width=960,height=540,format=NV12" ! queue ! comp1.sink_1 v4l2src device=/dev/exCAM io-mode=2 ! tee name=t2 ! queue ! image/jpeg,width=1920,height=1080,framerate=30/1 ! videorate ! image/jpeg,width=1920,height=1080,framerate=${fpsp2}/1 ! nvv4l2decoder mjpeg=1 ! nvvidconv ! queue ! "video/x-raw(memory:NVMM),width=960,height=540,format=NV12" ! queue ! comp1.sink_2 nvcompositor name=comp1 sink_0::width=1920 sink_0::height=1080 sink_1::xpos=0 sink_1::ypos=270 sink_1::width=960 sink_1::height=540 sink_2::xpos=960 sink_2::ypos=270 sink_2::width=960 sink_2::height=540 ! tee name=t4 ! queue ! nvvidconv ! queue ! nvv4l2h264enc maxperf-enable=1 bitrate=${bitrate} profile=4 ! queue ! h264parse ! queue ! mux. liveadder name=mix1 ! queue ! audioconvert ! voaacenc ! mux. alsasrc device="hw:externAud,0" ! queue ! audio/x-raw ! queue ! audioresample ! "audio/x-raw,rate=48000" ! tee name=a1 ! queue ! mix1.sink_0 alsasrc device="hw:channel1,0" ! queue ! audio/x-raw ! queue ! audioresample ! "audio/x-raw,rate=48000" ! tee name=a2 ! queue ! mix1.sink_1 mpegtsmux name=mux ! filesink location="/media/${hdduuid}/record-ts/${filename}.ts" t5. ! queue ! comp.sink_0 t1. ! video/x-raw, width=1920, height=1080, framerate=60/1 ! videorate ! video/x-raw, width=1920, height=1080, framerate=${fpsp1}/1 ! queue ! nvvidconv ! queue ! "video/x-raw(memory:NVMM),width=1920,height=1080,format=NV12" ! queue ! comp.sink_1 nvcompositor name=comp sink_0::width=1920 sink_0::height=1080 sink_1::xpos=0 sink_1::ypos=0 sink_1::width=1920 sink_1::height=1080 ! tee name=t3 ! queue ! nvvidconv ! queue ! nvv4l2h264enc maxperf-enable=1 bitrate=${bitrate} profile=4 ! queue ! h264parse ! queue ! mux3. liveadder name=mixer ! voaacenc ! queue ! mux3. a1. ! queue ! mixer.sink_0 a2. ! queue ! mixer.sink_1 flvmux name=mux3 ! rtmpsink location="rtmp://localhost/live" t3. ! nvvidconv ! nvoverlaysink liveadder name=mix ! queue ! audioconvert ! audioresample ! "audio/x-raw,rate=48000,channels=2,format=S16LE" ! alsasink device="hw:0,3" sync=false async=false a1. ! queue ! mix.sink_0 a2. ! queue ! mix.sink_1 t5. ! queue ! comp3.sink_0 t1. ! video/x-raw, width=1920, height=1080, framerate=60/1 ! videorate ! video/x-raw, width=1920, height=1080, framerate=10/1 ! queue ! nvvidconv ! queue ! "video/x-raw(memory:NVMM),width=1920, height=1080,format=NV12" ! queue ! comp3.sink_1 t2. ! queue ! image/jpeg,width=1920,height=1080,framerate=30/1 ! videorate ! image/jpeg,width=1920,height=1080,framerate=10/1 ! nvv4l2decoder mjpeg=1 ! nvvidconv ! queue ! "video/x-raw(memory:NVMM),width=960,height=540,format=NV12" ! queue ! comp3.sink_2 nvcompositor name=comp3 sink_0::width=1920 sink_0::height=1080 sink_1::xpos=0 sink_1::ypos=270 sink_1::width=960 sink_1::height=540 sink_2::xpos=960 sink_2::ypos=270 sink_2::width=960 sink_2::height=540 ! queue ! nvvidconv ! "video/x-raw(memory:NVMM),framerate=1/1,format=I420" ! queue ! nvjpegenc ! jpegparse ! multifilesink location=p1.jpg async=false liveadder name=mix4 ! queue ! audioconvert ! audioresample ! "audio/x-raw,rate=48000,channels=2,format=S16LE" ! alsasink device="hw:externAud,0" sync=false async=false a1. ! queue ! mix4.sink_0 a2. ! queue ! mix4.sink_1`;

    // 5050 Single Single - presenter
    let stval_50_p2_p2_yuyv = `gst-launch-1.0 -e videotestsrc pattern=black ! video/x-raw,width=320,height=240 ! nvvidconv ! queue ! tee name=t5 ! queue ! comp1.sink_0 v4l2src device=/dev/presentation ! queue ! tee name=t1 ! video/x-raw, width=1920, height=1080, framerate=60/1 ! videorate ! video/x-raw, width=1920, height=1080, framerate=${fpsp1}/1 ! nvvidconv ! queue ! "video/x-raw(memory:NVMM),width=960,height=540,format=NV12" ! queue ! comp1.sink_1 v4l2src device=/dev/presenter ! tee name=t2 ! queue ! video/x-raw, width=1920, height=1080, framerate=30/1 ! videorate ! video/x-raw, width=1920, height=1080, framerate=${fpsp2}/1 ! nvvidconv ! queue ! "video/x-raw(memory:NVMM),width=960,height=540,format=NV12" ! queue ! comp1.sink_2 nvcompositor name=comp1 sink_0::width=1920 sink_0::height=1080 sink_1::xpos=0 sink_1::ypos=270 sink_1::width=960 sink_1::height=540 sink_2::xpos=960 sink_2::ypos=270 sink_2::width=960 sink_2::height=540 ! tee name=t4 ! queue ! nvvidconv ! queue ! nvv4l2h264enc maxperf-enable=1 bitrate=${bitrate} profile=4 ! queue ! h264parse ! queue ! mux. liveadder name=mix1 ! queue ! audioconvert ! voaacenc ! mux. alsasrc device="hw:externAud,0" ! queue ! audio/x-raw ! queue ! audioresample ! "audio/x-raw,rate=48000" ! tee name=a1 ! queue ! mix1.sink_0 alsasrc device="hw:channel1,0" ! queue ! audio/x-raw ! queue ! audioresample ! "audio/x-raw,rate=48000" ! tee name=a2 ! queue ! mix1.sink_1 mpegtsmux name=mux ! filesink location="/media/${hdduuid}/record-ts/${filename}.ts" t5. ! queue ! comp.sink_0 t2. ! video/x-raw, width=1920, height=1080, framerate=30/1 ! videorate ! video/x-raw, width=1920, height=1080, framerate=30/1 ! queue ! nvvidconv ! queue ! "video/x-raw(memory:NVMM),width=1920,height=1080,format=NV12" ! queue ! comp.sink_1 nvcompositor name=comp sink_0::width=1920 sink_0::height=1080 sink_1::xpos=0 sink_1::ypos=0 sink_1::width=1920 sink_1::height=1080 ! tee name=t3 ! queue ! nvvidconv ! queue ! nvv4l2h264enc maxperf-enable=1 bitrate=${bitrate} profile=4 ! queue ! h264parse ! queue ! mux3. liveadder name=mixer ! voaacenc ! queue ! mux3. a1. ! queue ! mixer.sink_0 a2. ! queue ! mixer.sink_1 flvmux name=mux3 ! rtmpsink location="rtmp://localhost/live" t3. ! nvvidconv ! nvoverlaysink liveadder name=mix ! queue ! audioconvert ! audioresample ! "audio/x-raw,rate=48000,channels=2,format=S16LE" ! alsasink device="hw:0,3" sync=false async=false a1. ! queue ! mix.sink_0 a2. ! queue ! mix.sink_1 t5. ! queue ! comp3.sink_0 t1. ! video/x-raw, width=1920, height=1080, framerate=60/1 ! videorate ! video/x-raw, width=1920, height=1080, framerate=10/1 ! queue ! nvvidconv ! queue ! "video/x-raw(memory:NVMM),width=1920, height=1080,format=NV12" ! queue ! comp3.sink_1 t2. ! queue ! video/x-raw, width=1920, height=1080, framerate=30/1 ! videorate ! video/x-raw, width=1920, height=1080, framerate=${fpsp2}/1 ! nvvidconv ! queue ! "video/x-raw(memory:NVMM),width=426,height=240,format=NV12" ! queue ! comp3.sink_2 nvcompositor name=comp3 sink_0::width=1920 sink_0::height=1080 sink_1::xpos=0 sink_1::ypos=270 sink_1::width=960 sink_1::height=540 sink_2::xpos=960 sink_2::ypos=0 sink_2::width=960 sink_2::height=540 ! queue ! nvvidconv ! "video/x-raw(memory:NVMM),framerate=1/1,format=I420" ! queue ! nvjpegenc ! jpegparse ! multifilesink location=p1.jpg async=false liveadder name=mix4 ! queue ! audioconvert ! audioresample ! "audio/x-raw,rate=48000,channels=2,format=S16LE" ! alsasink device="hw:externAud,0" sync=false async=false a1. ! queue ! mix4.sink_0 a2. ! queue ! mix4.sink_1`;
    let stval_50_p2_p2_mjpg = `gst-launch-1.0 -e videotestsrc pattern=black ! video/x-raw,width=320,height=240 ! nvvidconv ! queue ! tee name=t5 ! queue ! comp1.sink_0 v4l2src device=/dev/presentation ! queue ! tee name=t1 ! video/x-raw, width=1920, height=1080, framerate=60/1 ! videorate ! video/x-raw, width=1920, height=1080, framerate=${fpsp1}/1 ! nvvidconv ! queue ! "video/x-raw(memory:NVMM),width=960,height=540,format=NV12" ! queue ! comp1.sink_1 v4l2src device=/dev/exCAM io-mode=2 ! tee name=t2 ! queue ! image/jpeg,width=1920,height=1080,framerate=30/1 ! videorate ! image/jpeg,width=1920,height=1080,framerate=${fpsp2}/1 ! nvv4l2decoder mjpeg=1 ! nvvidconv ! queue ! "video/x-raw(memory:NVMM),width=960,height=540,format=NV12" ! queue ! comp1.sink_2 nvcompositor name=comp1 sink_0::width=1920 sink_0::height=1080 sink_1::xpos=0 sink_1::ypos=270 sink_1::width=960 sink_1::height=540 sink_2::xpos=960 sink_2::ypos=270 sink_2::width=960 sink_2::height=540 ! tee name=t4 ! queue ! nvvidconv ! queue ! nvv4l2h264enc maxperf-enable=1 bitrate=${bitrate} profile=4 ! queue ! h264parse ! queue ! mux. liveadder name=mix1 ! queue ! audioconvert ! voaacenc ! mux. alsasrc device="hw:externAud,0" ! queue ! audio/x-raw ! queue ! audioresample ! "audio/x-raw,rate=48000" ! tee name=a1 ! queue ! mix1.sink_0 alsasrc device="hw:channel1,0" ! queue ! audio/x-raw ! queue ! audioresample ! "audio/x-raw,rate=48000" ! tee name=a2 ! queue ! mix1.sink_1 mpegtsmux name=mux ! filesink location="/media/${hdduuid}/record-ts/${filename}.ts" t5. ! queue ! comp.sink_0 t2. ! queue ! image/jpeg,width=1920,height=1080,framerate=30/1 ! videorate ! image/jpeg,width=1920,height=1080,framerate=${fpsp2}/1 ! nvv4l2decoder mjpeg=1 ! nvvidconv ! queue ! "video/x-raw(memory:NVMM),width=1920,height=1080,format=NV12" ! queue ! comp.sink_1 nvcompositor name=comp sink_0::width=1920 sink_0::height=1080 sink_1::xpos=0 sink_1::ypos=0 sink_1::width=1920 sink_1::height=1080 ! tee name=t3 ! queue ! nvvidconv ! queue ! nvv4l2h264enc maxperf-enable=1 bitrate=${bitrate} profile=4 ! queue ! h264parse ! queue ! mux3. liveadder name=mixer ! voaacenc ! queue ! mux3. a1. ! queue ! mixer.sink_0 a2. ! queue ! mixer.sink_1 flvmux name=mux3 ! rtmpsink location="rtmp://localhost/live" t3. ! nvvidconv ! nvoverlaysink liveadder name=mix ! queue ! audioconvert ! audioresample ! "audio/x-raw,rate=48000,channels=2,format=S16LE" ! alsasink device="hw:0,3" sync=false async=false a1. ! queue ! mix.sink_0 a2. ! queue ! mix.sink_1 t5. ! queue ! comp3.sink_0 t1. ! video/x-raw, width=1920, height=1080, framerate=60/1 ! videorate ! video/x-raw, width=1920, height=1080, framerate=10/1 ! queue ! nvvidconv ! queue ! "video/x-raw(memory:NVMM),width=1920, height=1080,format=NV12" ! queue ! comp3.sink_1 t2. ! queue ! image/jpeg,width=1920,height=1080,framerate=30/1 ! videorate ! image/jpeg,width=1920,height=1080,framerate=10/1 ! nvv4l2decoder mjpeg=1 ! nvvidconv ! queue ! "video/x-raw(memory:NVMM),width=960,height=540,format=NV12" ! queue ! comp3.sink_2 nvcompositor name=comp3 sink_0::width=1920 sink_0::height=1080 sink_1::xpos=0 sink_1::ypos=270 sink_1::width=960 sink_1::height=540 sink_2::xpos=960 sink_2::ypos=270 sink_2::width=960 sink_2::height=540 ! queue ! nvvidconv ! "video/x-raw(memory:NVMM),framerate=1/1,format=I420" ! queue ! nvjpegenc ! jpegparse ! multifilesink location=p1.jpg async=false liveadder name=mix4 ! queue ! audioconvert ! audioresample ! "audio/x-raw,rate=48000,channels=2,format=S16LE" ! alsasink device="hw:externAud,0" sync=false async=false a1. ! queue ! mix4.sink_0 a2. ! queue ! mix4.sink_1`;


    // single, Single Feed Single Feed - Presentation
    let stval_si_p1_p1_yuyv = `gst-launch-1.0 -e v4l2src device=/dev/presentation ! queue ! tee name=t1 ! video/x-raw, width=1920, height=1080, framerate=60/1 ! videorate ! video/x-raw, width=1920, height=1080, framerate=${fpsp1}/1 ! nvvidconv ! queue ! nvv4l2h264enc maxperf-enable=1 bitrate=${bitrate} profile=4 ! queue ! h264parse ! queue ! mux. liveadder name=mix1 ! queue ! audioconvert ! voaacenc ! mux. alsasrc device="hw:externAud,0" ! queue ! audio/x-raw ! queue ! audioresample ! "audio/x-raw,rate=48000" ! tee name=a1 ! queue ! mix1.sink_0 alsasrc device="hw:channel1,0" ! queue ! audio/x-raw ! queue ! audioresample ! "audio/x-raw,rate=48000" ! tee name=a2 ! queue ! mix1.sink_1 mpegtsmux name=mux ! filesink location='/media/${hdduuid}/record-ts/${filename}.ts' videotestsrc pattern=black ! video/x-raw,width=320,height=240 ! nvvidconv ! queue ! comp.sink_0 t1. ! video/x-raw, width=1920, height=1080, framerate=60/1 ! videorate ! video/x-raw, width=1920, height=1080, framerate=${fpsp1}/1 ! queue ! nvvidconv ! queue ! "video/x-raw(memory:NVMM),width=1920,height=1080,format=NV12" ! queue ! comp.sink_1 nvcompositor name=comp sink_0::width=1920 sink_0::height=1080 sink_1::xpos=0 sink_1::ypos=0 sink_1::width=1920 sink_1::height=1080 ! tee name=t3 ! queue ! nvvidconv ! queue ! nvv4l2h264enc maxperf-enable=1 bitrate=${bitrate} profile=4 ! queue ! h264parse ! queue ! mux3. liveadder name=mixer ! voaacenc ! queue ! mux3. a1. ! queue ! mixer.sink_0 a2. ! queue ! mixer.sink_1 flvmux name=mux3 ! rtmpsink location="rtmp://localhost/live" t3. ! nvvidconv ! nvoverlaysink liveadder name=mix ! queue ! audioconvert ! audioresample ! "audio/x-raw,rate=48000,channels=2,format=S16LE" ! alsasink device="hw:0,3" sync=false async=false a1. ! queue ! mix.sink_0 a2. ! queue ! mix.sink_1 t1. ! queue ! video/x-raw, width=1920, height=1080, framerate=60/1 ! videorate ! video/x-raw, width=1920, height=1080, framerate=1/2 ! jpegenc ! multifilesink location=p1.jpg async=false liveadder name=mix4 ! queue ! audioconvert ! audioresample ! "audio/x-raw,rate=48000,channels=2,format=S16LE" ! alsasink device="hw:externAud,0" sync=false async=false a1. ! queue ! mix4.sink_0 a2. ! queue ! mix4.sink_1`;
    let stval_si_p1_p1_mjpg = `gst-launch-1.0 -e v4l2src device=/dev/presentation ! queue ! tee name=t1 ! video/x-raw, width=1920, height=1080, framerate=60/1 ! videorate ! video/x-raw, width=1920, height=1080, framerate=${fpsp1}/1 ! nvvidconv ! queue ! nvv4l2h264enc maxperf-enable=1 bitrate=${bitrate} profile=4 ! queue ! h264parse ! queue ! mux. liveadder name=mix1 ! queue ! audioconvert ! voaacenc ! mux. alsasrc device="hw:externAud,0" ! queue ! audio/x-raw ! queue ! audioresample ! "audio/x-raw,rate=48000" ! tee name=a1 ! queue ! mix1.sink_0 alsasrc device="hw:channel1,0" ! queue ! audio/x-raw ! queue ! audioresample ! "audio/x-raw,rate=48000" ! tee name=a2 ! queue ! mix1.sink_1 mpegtsmux name=mux ! filesink location='/media/${hdduuid}/record-ts/${filename}.ts' videotestsrc pattern=black ! video/x-raw,width=320,height=240 ! nvvidconv ! queue ! comp.sink_0 t1. ! video/x-raw, width=1920, height=1080, framerate=60/1 ! videorate ! video/x-raw, width=1920, height=1080, framerate=${fpsp1}/1 ! queue ! nvvidconv ! queue ! "video/x-raw(memory:NVMM),width=1920,height=1080,format=NV12" ! queue ! comp.sink_1 nvcompositor name=comp sink_0::width=1920 sink_0::height=1080 sink_1::xpos=0 sink_1::ypos=0 sink_1::width=1920 sink_1::height=1080 ! tee name=t3 ! queue ! nvvidconv ! queue ! nvv4l2h264enc maxperf-enable=1 bitrate=${bitrate} profile=4 ! queue ! h264parse ! queue ! mux3. liveadder name=mixer ! voaacenc ! queue ! mux3. a1. ! queue ! mixer.sink_0 a2. ! queue ! mixer.sink_1 flvmux name=mux3 ! rtmpsink location="rtmp://localhost/live" t3. ! nvvidconv ! nvoverlaysink liveadder name=mix ! queue ! audioconvert ! audioresample ! "audio/x-raw,rate=48000,channels=2,format=S16LE" ! alsasink device="hw:0,3" sync=false async=false a1. ! queue ! mix.sink_0 a2. ! queue ! mix.sink_1 t1. ! queue ! video/x-raw, width=1920, height=1080, framerate=60/1 ! videorate ! video/x-raw, width=1920, height=1080, framerate=1/2 ! jpegenc ! multifilesink location=p1.jpg async=false liveadder name=mix4 ! queue ! audioconvert ! audioresample ! "audio/x-raw,rate=48000,channels=2,format=S16LE" ! alsasink device="hw:externAud,0" sync=false async=false a1. ! queue ! mix4.sink_0 a2. ! queue ! mix4.sink_1`;

    // single, Single Feed Single Feed - Presenter
    let stval_si_p2_p2_yuyv = `gst-launch-1.0 -e v4l2src device=/dev/presenter ! tee name=t2 ! queue ! video/x-raw, width=1920, height=1080, framerate=30/1 ! videorate ! video/x-raw, width=1920, height=1080, framerate=${fpsp2}/1 ! nvvidconv ! queue ! "video/x-raw(memory:NVMM),width=1920,height=1080,format=NV12" ! nvv4l2h264enc maxperf-enable=1 bitrate=${bitrate} profile=4 ! queue ! h264parse ! mux. liveadder name=mix1 ! queue ! audioconvert ! voaacenc ! mux. alsasrc device="hw:externAud,0" ! queue ! audio/x-raw ! queue ! audioresample ! "audio/x-raw,rate=48000" ! tee name=a1 ! queue ! mix1.sink_0 alsasrc device="hw:channel1,0" ! queue ! audio/x-raw ! queue ! audioresample ! "audio/x-raw,rate=48000" ! tee name=a2 ! queue ! mix1.sink_1 mpegtsmux name=mux ! filesink location='/media/${hdduuid}/record-ts/${filename}.ts' videotestsrc pattern=black ! video/x-raw,width=320,height=240 ! nvvidconv ! queue ! comp.sink_0 t2. ! video/x-raw, width=1920, height=1080, framerate=30/1 ! videorate ! video/x-raw, width=1920, height=1080, framerate=30/1 ! queue ! nvvidconv ! queue ! "video/x-raw(memory:NVMM),width=1920,height=1080,format=NV12" ! queue ! comp.sink_1 nvcompositor name=comp sink_0::width=1920 sink_0::height=1080 sink_1::xpos=0 sink_1::ypos=0 sink_1::width=1920 sink_1::height=1080 ! tee name=t3 ! queue ! nvvidconv ! queue ! nvv4l2h264enc maxperf-enable=1 bitrate=${bitrate} profile=4 ! queue ! h264parse ! queue ! mux3. liveadder name=mixer ! voaacenc ! queue ! mux3. a1. ! queue ! mixer.sink_0 a2. ! queue ! mixer.sink_1 flvmux name=mux3 ! rtmpsink location="rtmp://localhost/live" t3. ! nvvidconv ! nvoverlaysink liveadder name=mix ! queue ! audioconvert ! audioresample ! "audio/x-raw,rate=48000,channels=2,format=S16LE" ! alsasink device="hw:0,3" sync=false async=false a1. ! queue ! mix.sink_0 a2. ! queue ! mix.sink_1 t2. ! queue ! video/x-raw, width=1920, height=1080, framerate=30/1 ! videorate ! video/x-raw, width=1920, height=1080, framerate=1/2 ! jpegenc ! multifilesink location=p1.jpg async=false liveadder name=mix4 ! queue ! audioconvert ! audioresample ! "audio/x-raw,rate=48000,channels=2,format=S16LE" ! alsasink device="hw:externAud,0" sync=false async=false a1. ! queue ! mix4.sink_0 a2. ! queue ! mix4.sink_1`;
    let stval_si_p2_p2_mjpg = `gst-launch-1.0 -e v4l2src device=/dev/exCAM io-mode=2 ! tee name=t2 ! queue ! image/jpeg,width=1920,height=1080,framerate=30/1 ! videorate ! image/jpeg,width=1920,height=1080,framerate=${fpsp2}/1 ! nvv4l2decoder mjpeg=1 ! nvvidconv ! queue ! "video/x-raw(memory:NVMM),width=1920,height=1080,format=NV12" ! nvv4l2h264enc maxperf-enable=1 bitrate=${bitrate} profile=4 ! queue ! h264parse ! mux. liveadder name=mix1 ! queue ! audioconvert ! voaacenc ! mux. alsasrc device="hw:externAud,0" ! queue ! audio/x-raw ! queue ! audioresample ! "audio/x-raw,rate=48000" ! tee name=a1 ! queue ! mix1.sink_0 alsasrc device="hw:channel1,0" ! queue ! audio/x-raw ! queue ! audioresample ! "audio/x-raw,rate=48000" ! tee name=a2 ! queue ! mix1.sink_1 mpegtsmux name=mux ! filesink location='/media/${hdduuid}/record-ts/${filename}.ts' videotestsrc pattern=black ! video/x-raw,width=320,height=240 ! nvvidconv ! queue ! comp.sink_0 t2. ! queue ! image/jpeg,width=1920,height=1080,framerate=30/1 ! videorate ! image/jpeg,width=1920,height=1080,framerate=${fpsp2}/1 ! nvv4l2decoder mjpeg=1 ! nvvidconv ! queue ! "video/x-raw(memory:NVMM),width=1920,height=1080,format=NV12" ! queue ! comp.sink_1 nvcompositor name=comp sink_0::width=1920 sink_0::height=1080 sink_1::xpos=0 sink_1::ypos=0 sink_1::width=1920 sink_1::height=1080 ! tee name=t3 ! queue ! nvvidconv ! queue ! nvv4l2h264enc maxperf-enable=1 bitrate=${bitrate} profile=4 ! queue ! h264parse ! queue ! mux3. liveadder name=mixer ! voaacenc ! queue ! mux3. a1. ! queue ! mixer.sink_0 a2. ! queue ! mixer.sink_1 flvmux name=mux3 ! rtmpsink location="rtmp://localhost/live" t3. ! nvvidconv ! nvoverlaysink liveadder name=mix ! queue ! audioconvert ! audioresample ! "audio/x-raw,rate=48000,channels=2,format=S16LE" ! alsasink device="hw:0,3" sync=false async=false a1. ! queue ! mix.sink_0 a2. ! queue ! mix.sink_1 t2. ! queue !  image/jpeg,width=1920,height=1080,framerate=30/1 ! videorate ! image/jpeg,width=1920,height=1080,framerate=1/2 ! multifilesink location=p1.jpg async=false liveadder name=mix4 ! queue ! audioconvert ! audioresample ! "audio/x-raw,rate=48000,channels=2,format=S16LE" ! alsasink device="hw:externAud,0" sync=false async=false a1. ! queue ! mix4.sink_0 a2. ! queue ! mix4.sink_1`;



    // Network Camera PipeLines

    // separate files(presentation/rtsp) 50/50(livestream=presentation/rtsp) 50/50(zoom=presentation/rtsp)

    let stval_sfp1rt_50_50_p1_rt = `gst-launch-1.0 -e v4l2src device=/dev/presentation ! queue ! tee name=t1 ! video/x-raw, width=1920, height=1080, framerate=60/1 ! videorate ! video/x-raw, width=1920, height=1080, framerate=${fpsp1}/1 ! nvvidconv ! queue ! nvv4l2h264enc maxperf-enable=1 bitrate=${bitrate} profile=4 ! queue ! h264parse ! queue ! mux. liveadder name=mix1 ! queue ! audioconvert ! voaacenc ! mux. alsasrc device="hw:externAud,0" ! queue ! audio/x-raw ! queue ! audioresample ! "audio/x-raw,rate=48000" ! tee name=a1 ! queue ! mix1.sink_0 alsasrc device="hw:channel1,0" ! queue ! audio/x-raw ! queue ! audioresample ! "audio/x-raw,rate=48000" ! tee name=a2 ! queue ! mix1.sink_1 mpegtsmux name=mux ! filesink location='/media/${hdduuid}/record-ts/${filename}~1.ts' sync=false async=false rtspsrc location=${rtsplink} latency=0 ! application/x-rtp, media=video, encoding-name=H264 ! rtph264depay ! tee name=t2 ! queue ! h264parse ! queue ! nvv4l2decoder ! nvvidconv ! queue ! "video/x-raw(memory:NVMM),width=1920,height=1080,format=NV12" ! videorate ! "video/x-raw(memory:NVMM),width=1920,height=1080,format=NV12,framerate=${fpsp2}/1" ! nvv4l2h264enc ! queue ! h264parse ! mpegtsmux ! filesink location='/media/${hdduuid}/record-ts/${filename}~2.ts' videotestsrc pattern=black ! video/x-raw,width=320,height=240 ! nvvidconv ! queue ! comp.sink_0 t1. ! video/x-raw, width=1920, height=1080, framerate=60/1 ! videorate ! video/x-raw, width=1920, height=1080, framerate=${fpsp1}/1 ! queue ! nvvidconv ! queue ! "video/x-raw(memory:NVMM),width=960,height=540,format=NV12" ! queue ! comp.sink_1 t2. ! queue ! h264parse ! queue ! nvv4l2decoder ! nvvidconv ! queue ! "video/x-raw(memory:NVMM),width=960,height=540,format=NV12" ! queue ! comp.sink_2 nvcompositor name=comp sink_0::width=1920 sink_0::height=1080 sink_1::xpos=0 sink_1::ypos=270 sink_1::width=960 sink_1::height=540 sink_2::xpos=960 sink_2::ypos=270 sink_2::width=960 sink_2::height=540 ! tee name=t3 ! queue ! nvvidconv ! queue ! nvv4l2h264enc maxperf-enable=1 bitrate=${bitrate} profile=4 ! queue ! h264parse ! queue ! mux3. liveadder name=mixer ! voaacenc ! queue ! mux3. a1. ! queue ! mixer.sink_0 a2. ! queue ! mixer.sink_1 flvmux name=mux3 ! rtmpsink location="rtmp://localhost/live" videotestsrc pattern=black ! video/x-raw,width=320,height=240 ! nvvidconv ! queue ! comp2.sink_0 t1. ! video/x-raw, width=1920, height=1080, framerate=60/1 ! videorate ! video/x-raw, width=1920, height=1080, framerate=${fpsp1}/1 ! queue ! nvvidconv ! queue ! "video/x-raw(memory:NVMM),width=960,height=540,format=NV12" ! queue ! comp2.sink_1 t2. ! queue ! h264parse ! queue ! nvv4l2decoder ! nvvidconv ! queue ! "video/x-raw(memory:NVMM),width=960,height=540,format=NV12" ! queue ! comp2.sink_2 nvcompositor name=comp2 sink_0::width=1920 sink_0::height=1080 sink_1::xpos=0 sink_1::ypos=270 sink_1::width=960 sink_1::height=540 sink_2::xpos=960 sink_2::ypos=270 sink_2::width=960 sink_2::height=540 ! nvvidconv ! nvoverlaysink liveadder name=mix ! queue ! audioconvert ! audioresample ! "audio/x-raw,rate=48000,channels=2,format=S16LE" ! alsasink device="hw:0,3" sync=false async=false a1. ! queue ! mix.sink_0 a2. ! queue ! mix.sink_1 t1. ! queue ! video/x-raw, width=1920, height=1080, framerate=60/1 ! videorate ! video/x-raw, width=1920, height=1080, framerate=1/2 ! jpegenc ! multifilesink location=p1.jpg async=false t2. ! h264parse ! queue ! nvv4l2decoder ! nvvidconv ! queue ! "video/x-raw(memory:NVMM),width=1920,height=1080,format=NV12" ! nvvidconv ! "video/x-raw(memory:NVMM),format=I420" ! videorate ! "video/x-raw(memory:NVMM),framerate=1/1" ! nvjpegenc ! jpegparse ! queue ! multifilesink location=p2.jpg async=false liveadder name=mix4 ! queue ! audioconvert ! audioresample ! "audio/x-raw,rate=48000,channels=2,format=S16LE" ! alsasink device="hw:externAud,0" sync=false async=false a1. ! queue ! mix4.sink_0 a2. ! queue ! mix4.sink_1`

    // separate files(presentation/usbcam) 50/50(livestream=rtsp/usb) 50/50(zoom=rtsp/usb)
    let stval_sfp1ex_50_50_rt_ex = `gst-launch-1.0 -e v4l2src device=/dev/presentation ! queue ! tee name=t1 ! video/x-raw, width=1920, height=1080, framerate=60/1 ! videorate ! video/x-raw, width=1920, height=1080, framerate=${fpsp1}/1 ! nvvidconv ! queue ! nvv4l2h264enc maxperf-enable=1 bitrate=${bitrate} profile=4 ! queue ! h264parse ! queue ! mux. liveadder name=mix1 ! queue ! audioconvert ! voaacenc ! mux. alsasrc device="hw:externAud,0" ! queue ! audio/x-raw ! queue ! audioresample ! "audio/x-raw,rate=48000" ! tee name=a1 ! queue ! mix1.sink_0 alsasrc device="hw:channel1,0" ! queue ! audio/x-raw ! queue ! audioresample ! "audio/x-raw,rate=48000" ! tee name=a2 ! queue ! mix1.sink_1 mpegtsmux name=mux ! filesink location='/media/${hdduuid}/record-ts/${filename}~1.ts' v4l2src device=/dev/exCAM io-mode=2 ! tee name=t2 ! queue ! image/jpeg,width=1920,height=1080,framerate=30/1 ! videorate ! image/jpeg,width=1920,height=1080,framerate=${fpsp2}/1 ! jpegparse ! nvv4l2decoder mjpeg=1 ! nvvidconv ! queue ! "video/x-raw(memory:NVMM),width=1920,height=1080,format=NV12" ! nvv4l2h264enc maxperf-enable=1 bitrate=${bitrate} profile=4 ! queue ! h264parse ! queue ! mpegtsmux ! filesink location='/media/${hdduuid}/record-ts/${filename}~2.ts' videotestsrc pattern=black ! video/x-raw,width=320,height=240 ! nvvidconv ! queue ! comp.sink_0 rtspsrc location=${rtsplink} latency=0 ! application/x-rtp, media=video, encoding-name=H264 ! rtph264depay ! tee name=t5 ! queue ! h264parse ! queue ! nvv4l2decoder ! nvvidconv ! queue ! "video/x-raw(memory:NVMM),width=960,height=540,format=NV12" ! queue ! comp.sink_1 t2. ! queue ! image/jpeg,width=1920,height=1080,framerate=30/1 ! videorate ! image/jpeg,width=1920,height=1080,framerate=${fpsp2}/1 ! jpegparse ! nvv4l2decoder mjpeg=1 ! nvvidconv ! queue ! "video/x-raw(memory:NVMM),width=960,height=540,format=NV12" ! queue ! comp.sink_2 nvcompositor name=comp sink_0::width=1920 sink_0::height=1080 sink_1::xpos=0 sink_1::ypos=270 sink_1::width=960 sink_1::height=540  sink_2::xpos=960 sink_2::ypos=270 sink_2::width=960 sink_2::height=540 ! tee name=t3 ! queue ! nvvidconv ! queue ! nvv4l2h264enc maxperf-enable=1 bitrate=${bitrate} profile=4 ! queue ! h264parse ! queue ! mux3. liveadder name=mixer ! voaacenc ! queue ! mux3. a1. ! queue ! mixer.sink_0 a2. ! queue ! mixer.sink_1 flvmux name=mux3 ! rtmpsink location="rtmp://localhost/live" t3. ! nvvidconv ! nvoverlaysink liveadder name=mix ! queue ! audioconvert ! alsasink device="hw:0,3" a1. ! queue ! mix.sink_0 a2. ! queue ! mix.sink_1 t1. ! queue ! video/x-raw, width=1920, height=1080, framerate=60/1 ! videorate ! video/x-raw, width=1920, height=1080, framerate=1/2 ! jpegenc ! jpegparse ! multifilesink location=p1.jpg async=false t2. ! queue ! image/jpeg,width=1920,height=1080,framerate=30/1 ! videorate ! image/jpeg,width=1920,height=1080,framerate=1/2 ! jpegparse ! multifilesink location=p2.jpg async=false liveadder name=mix4 ! queue ! audioconvert ! audioresample ! "audio/x-raw,rate=48000,channels=2,format=S16LE" ! alsasink device="hw:externAud,0" sync=false async=false a1. ! queue ! mix4.sink_0 a2. ! queue ! mix4.sink_1`


    // separate files(presentation/rtsp) SBS(livestream=rtsp/usb) SBS(zoom=rtsp/usb) one
    let stval_sfp1rt_sbsrtex_sbsrtex = `gst-launch-1.0 -e v4l2src device=/dev/presentation ! queue ! tee name=t1 ! video/x-raw, width=1920, height=1080, framerate=60/1 ! videorate ! video/x-raw, width=1920, height=1080, framerate=${fpsp1}/1 ! nvvidconv ! queue ! nvv4l2h264enc maxperf-enable=1 bitrate=${bitrate} profile=4 ! queue ! h264parse ! queue ! mux. liveadder name=mix1 ! queue ! audioconvert ! voaacenc ! mux. alsasrc device="hw:externAud,0" ! queue ! audio/x-raw ! queue ! audioresample ! "audio/x-raw,rate=48000" ! tee name=a1 ! queue ! mix1.sink_0 alsasrc device="hw:channel1,0" ! queue ! audio/x-raw ! queue ! audioresample ! "audio/x-raw,rate=48000" ! tee name=a2 ! queue ! mix1.sink_1 mpegtsmux name=mux ! filesink location='/media/${hdduuid}/record-ts/${filename}~1.ts' sync=false async=false rtspsrc location=${rtsplink} latency=0 ! application/x-rtp, media=video, encoding-name=H264 ! rtph264depay ! tee name=t2 ! queue ! h264parse ! queue ! nvv4l2decoder ! nvvidconv ! queue ! "video/x-raw(memory:NVMM),width=1920,height=1080,format=NV12" ! videorate ! "video/x-raw(memory:NVMM),width=1920,height=1080,format=NV12,framerate=${fpsp2}/1" ! nvv4l2h264enc ! queue ! h264parse ! mpegtsmux ! filesink location='/media/${hdduuid}/record-ts/${filename}~2.ts' videotestsrc pattern=black ! video/x-raw,width=320,height=240 ! nvvidconv ! queue ! comp.sink_0 t2. ! queue ! h264parse ! queue ! nvv4l2decoder ! nvvidconv ! queue ! "video/x-raw(memory:NVMM),width=1494,height=840,format=NV12" ! queue ! comp.sink_1 v4l2src device=/dev/exCAM io-mode=2 ! queue ! image/jpeg,width=1920,height=1080,framerate=30/1 ! videorate ! image/jpeg,width=1920,height=1080,framerate=${fpsp2}/1 ! jpegparse ! nvv4l2decoder mjpeg=1 ! nvvidconv ! queue ! "video/x-raw(memory:NVMM),width=426,height=240,format=NV12" ! queue ! comp.sink_2 nvcompositor name=comp sink_0::width=1920 sink_0::height=1080 sink_1::xpos=0 sink_1::ypos=120 sink_1::width=1494 sink_1::height=840 sink_2::xpos=1494 sink_2::ypos=120 sink_2::width=426 sink_2::height=240 ! tee name=t3 ! queue ! nvvidconv ! queue ! nvv4l2h264enc maxperf-enable=1 bitrate=${bitrate} profile=4 ! queue ! h264parse ! queue ! mux3. liveadder name=mixer ! voaacenc ! queue ! mux3. a1. ! queue ! mixer.sink_0 a2. ! queue ! mixer.sink_1 flvmux name=mux3 ! rtmpsink location="rtmp://localhost/live" t3. ! nvvidconv ! nvoverlaysink liveadder name=mix ! queue ! audioconvert ! audioresample ! "audio/x-raw,rate=48000,format=S16LE,layout=interleaved,channels=2" ! alsasink device="hw:0,3" sync=false async=false a1. ! queue ! mix.sink_0 a2. ! queue ! mix.sink_1 t1. ! queue ! video/x-raw, width=1920, height=1080, framerate=60/1 ! videorate ! video/x-raw, width=1920, height=1080, framerate=1/2 ! jpegenc ! jpegparse ! multifilesink location=p1.jpg async=false t2. ! h264parse ! queue ! nvv4l2decoder ! nvvidconv ! queue ! "video/x-raw(memory:NVMM),width=1920,height=1080,format=NV12" ! nvvidconv ! "video/x-raw(memory:NVMM),format=I420" ! videorate ! "video/x-raw(memory:NVMM),framerate=1/1" ! nvjpegenc ! jpegparse ! queue ! multifilesink location=p2.jpg async=false liveadder name=mix4 ! queue ! audioconvert ! audioresample ! "audio/x-raw,rate=48000,channels=2,format=S16LE" ! alsasink device="hw:externAud,0" sync=false async=false a1. ! queue ! mix4.sink_0 a2. ! queue ! mix4.sink_1`


    // 50-50(presentation/rtsp) SBS(livestream=rtsp/usb) SBS(zoom=rtsp/usb) one
    let stval_50p1rt_sbsrtex_sbsrtex = `gst-launch-1.0 -e videotestsrc pattern=black ! video/x-raw,width=320,height=240 ! nvvidconv ! queue ! tee name=t5 ! queue ! comp1.sink_0 v4l2src device=/dev/presentation ! queue ! tee name=t1 ! video/x-raw, width=1920, height=1080, framerate=60/1 ! videorate ! video/x-raw, width=1920, height=1080, framerate=${fpsp1}/1 ! nvvidconv ! queue ! "video/x-raw(memory:NVMM),width=960,height=540,format=NV12" ! queue ! comp1.sink_1 rtspsrc location=${rtsplink} latency=0 ! application/x-rtp, media=video, encoding-name=H264 ! rtph264depay ! tee name=t2 ! queue ! h264parse ! queue ! nvv4l2decoder ! nvvidconv ! queue ! "video/x-raw(memory:NVMM),width=1920,height=1080,format=NV12" ! videorate ! "video/x-raw(memory:NVMM),width=1920,height=1080,format=NV12,framerate=${fpsp1}/1" ! nvvidconv ! queue ! "video/x-raw(memory:NVMM),width=960,height=540,format=NV12" ! queue ! comp1.sink_2 nvcompositor name=comp1 sink_0::width=1920 sink_0::height=1080 sink_1::xpos=0 sink_1::ypos=270 sink_1::width=960 sink_1::height=540 sink_2::xpos=960 sink_2::ypos=270 sink_2::width=960 sink_2::height=540 ! tee name=t4 ! queue ! nvvidconv ! queue ! nvv4l2h264enc maxperf-enable=1 bitrate=${bitrate} profile=4 ! queue ! h264parse ! queue ! mux. liveadder name=mix1 ! queue ! audioconvert ! voaacenc ! mux. alsasrc device="hw:externAud,0" ! queue ! audio/x-raw ! queue ! audioresample ! "audio/x-raw,rate=48000" ! tee name=a1 ! queue ! mix1.sink_0 alsasrc device="hw:channel1,0" ! queue ! audio/x-raw ! queue ! audioresample ! "audio/x-raw,rate=48000" ! tee name=a2 ! queue ! mix1.sink_1 mpegtsmux name=mux ! filesink location="/media/${hdduuid}/record-ts/${filename}.ts" videotestsrc pattern=black ! video/x-raw,width=320,height=240 ! nvvidconv ! queue ! comp.sink_0 t2. ! queue ! h264parse ! queue ! nvv4l2decoder ! nvvidconv ! queue ! "video/x-raw(memory:NVMM),width=1494,height=840,format=NV12" ! queue ! comp.sink_1 v4l2src device=/dev/exCAM io-mode=2 ! queue ! image/jpeg,width=1920,height=1080,framerate=30/1 ! videorate ! image/jpeg,width=1920,height=1080,framerate=${fpsp2}/1 ! jpegparse ! nvv4l2decoder mjpeg=1 ! nvvidconv ! queue ! "video/x-raw(memory:NVMM),width=426,height=240,format=NV12" ! queue ! comp.sink_2 nvcompositor name=comp sink_0::width=1920 sink_0::height=1080 sink_1::xpos=0 sink_1::ypos=120 sink_1::width=1494 sink_1::height=840 sink_2::xpos=1494 sink_2::ypos=120 sink_2::width=426 sink_2::height=240 ! tee name=t3 ! queue ! nvvidconv ! queue ! nvv4l2h264enc maxperf-enable=1 bitrate=${bitrate} profile=4 ! queue ! h264parse ! queue ! mux3. liveadder name=mixer ! voaacenc ! queue ! mux3. a1. ! queue ! mixer.sink_0 a2. ! queue ! mixer.sink_1 flvmux name=mux3 ! rtmpsink location="rtmp://localhost/live" t3. ! nvvidconv ! nvoverlaysink liveadder name=mix ! queue ! audioconvert ! audioresample ! "audio/x-raw,rate=48000,format=S16LE,layout=interleaved,channels=2" ! alsasink device="hw:0,3" sync=false async=false a1. ! queue ! mix.sink_0 a2. ! queue ! mix.sink_1 t5. ! queue ! comp3.sink_0 t1. ! video/x-raw, width=1920, height=1080, framerate=60/1 ! videorate ! video/x-raw, width=1920, height=1080, framerate=10/1 ! queue ! nvvidconv ! queue ! "video/x-raw(memory:NVMM),width=1920, height=1080,format=NV12" ! queue ! comp3.sink_1 t2. ! queue ! h264parse ! queue ! nvv4l2decoder ! nvvidconv ! queue ! "video/x-raw(memory:NVMM),width=1920,height=1080,format=NV12" ! videorate ! "video/x-raw(memory:NVMM),width=1920,height=1080,format=NV12,framerate=${fpsp1}/1" ! nvvidconv ! queue ! "video/x-raw(memory:NVMM),width=960,height=540,format=NV12" ! queue ! comp3.sink_2 nvcompositor name=comp3 sink_0::width=1920 sink_0::height=1080 sink_1::xpos=0 sink_1::ypos=270 sink_1::width=960 sink_1::height=540 sink_2::xpos=960 sink_2::ypos=270 sink_2::width=960 sink_2::height=540 ! queue ! nvvidconv ! "video/x-raw(memory:NVMM),framerate=1/1,format=I420" ! queue ! nvjpegenc ! jpegparse ! multifilesink location=p1.jpg async=false liveadder name=mix4 ! queue ! audioconvert ! audioresample ! "audio/x-raw,rate=48000,channels=2,format=S16LE" ! alsasink device="hw:externAud,0" sync=false async=false a1. ! queue ! mix4.sink_0 a2. ! queue ! mix4.sink_1`

    // separate files(presentation/rtsp) livestream=rtsp zoom=rtsp
    let stval_sfp1rt_rt_rt = `gst-launch-1.0 -e v4l2src device=/dev/presentation ! queue ! tee name=t1 ! video/x-raw, width=1920, height=1080, framerate=60/1 ! videorate ! video/x-raw, width=1920, height=1080, framerate=${fpsp1}/1 ! nvvidconv ! queue ! nvv4l2h264enc maxperf-enable=1 bitrate=${bitrate} profile=4 ! queue ! h264parse ! queue ! mux. liveadder name=mix1 ! queue ! audioconvert ! voaacenc ! mux. alsasrc device="hw:externAud,0" ! queue ! audio/x-raw ! queue ! audioresample ! "audio/x-raw,rate=48000" ! tee name=a1 ! queue ! mix1.sink_0 alsasrc device="hw:channel1,0" ! queue ! audio/x-raw ! queue ! audioresample ! "audio/x-raw,rate=48000" ! tee name=a2 ! queue ! mix1.sink_1 mpegtsmux name=mux ! filesink location='/media/${hdduuid}/record-ts/${filename}~1.ts' rtspsrc location=${rtsplink} latency=0 ! application/x-rtp, media=video, encoding-name=H264 ! rtph264depay ! tee name=t2 ! queue ! h264parse ! queue ! nvv4l2decoder ! nvvidconv ! queue ! "video/x-raw(memory:NVMM),width=1920,height=1080,format=NV12" ! videorate ! "video/x-raw(memory:NVMM),width=1920,height=1080,format=NV12,framerate=${fpsp2}/1" ! nvv4l2h264enc ! queue ! h264parse ! mpegtsmux ! filesink location='/media/${hdduuid}/record-ts/${filename}~2.ts' videotestsrc pattern=black ! video/x-raw,width=320,height=240 ! nvvidconv ! queue ! comp.sink_0 t2. ! queue ! h264parse ! queue ! nvv4l2decoder ! nvvidconv ! queue ! "video/x-raw(memory:NVMM),width=1920,height=1080,format=NV12" ! queue ! comp.sink_1 nvcompositor name=comp sink_0::width=1920 sink_0::height=1080 sink_1::xpos=0 sink_1::ypos=0 sink_1::width=1920 sink_1::height=1080 ! tee name=t3 ! queue ! nvvidconv ! queue ! nvv4l2h264enc maxperf-enable=1 bitrate=${bitrate} profile=4 ! queue ! h264parse ! queue ! mux3. liveadder name=mixer ! voaacenc ! queue ! mux3. a1. ! queue ! mixer.sink_0 a2. ! queue ! mixer.sink_1 flvmux name=mux3 ! rtmpsink location="rtmp://localhost/live" t3. ! nvvidconv ! nvoverlaysink liveadder name=mix ! queue ! audioconvert ! audioresample ! "audio/x-raw,rate=48000,format=S16LE,layout=interleaved,channels=2" ! alsasink device="hw:0,3" sync=false async=false a1. ! queue ! mix.sink_0 a2. ! queue ! mix.sink_1 t1. ! queue ! video/x-raw, width=1920, height=1080, framerate=60/1 ! videorate ! video/x-raw, width=1920, height=1080, framerate=1/2 ! jpegenc ! jpegparse ! multifilesink location=p1.jpg async=false t2. ! h264parse ! queue ! nvv4l2decoder ! nvvidconv ! queue ! "video/x-raw(memory:NVMM),width=1920,height=1080,format=NV12" ! nvvidconv ! "video/x-raw(memory:NVMM),format=I420" ! videorate ! "video/x-raw(memory:NVMM),framerate=1/1" ! nvjpegenc ! jpegparse ! queue ! multifilesink location=p2.jpg async=false liveadder name=mix4 ! queue ! audioconvert ! audioresample ! "audio/x-raw,rate=48000,channels=2,format=S16LE" ! alsasink device="hw:externAud,0" sync=false async=false a1. ! queue ! mix4.sink_0 a2. ! queue ! mix4.sink_1`

    // separate files(usb/rtsp) livestream=rtsp zoom=rtsp
    let stval_sfexrt_rt_rt = `gst-launch-1.0 -e v4l2src device=/dev/exCAM io-mode=2 ! tee name=t1 ! queue ! image/jpeg,width=1920,height=1080,framerate=30/1 ! videorate ! image/jpeg,width=1920,height=1080,framerate=${fpsp2}/1 ! jpegparse ! nvv4l2decoder mjpeg=1 ! nvvidconv ! queue ! "video/x-raw(memory:NVMM),width=1920,height=1080,format=NV12" ! nvv4l2h264enc maxperf-enable=1 bitrate=${bitrate} profile=4 ! queue ! h264parse ! queue ! mux. liveadder name=mix1 ! queue ! audioconvert ! voaacenc ! mux. alsasrc device="hw:externAud,0" ! queue ! audio/x-raw ! queue ! audioresample ! "audio/x-raw,rate=48000" ! tee name=a1 ! queue ! mix1.sink_0 alsasrc device="hw:channel1,0" ! queue ! audio/x-raw ! queue ! audioresample ! "audio/x-raw,rate=48000" ! tee name=a2 ! queue ! mix1.sink_1 mpegtsmux name=mux ! filesink location='/media/${hdduuid}/record-ts/${filename}~1.ts' rtspsrc location=${rtsplink} latency=0 ! application/x-rtp, media=video, encoding-name=H264 ! rtph264depay ! tee name=t2 ! queue ! h264parse ! queue ! mpegtsmux ! filesink location='/media/${hdduuid}/record-ts/${filename}~2.ts' videotestsrc pattern=black ! video/x-raw,width=320,height=240 ! nvvidconv ! queue ! comp.sink_0 t2. ! queue ! h264parse ! queue ! nvv4l2decoder ! nvvidconv ! queue ! "video/x-raw(memory:NVMM),width=1920,height=1080,format=NV12" ! queue ! comp.sink_1 nvcompositor name=comp sink_0::width=1920 sink_0::height=1080 sink_1::xpos=0 sink_1::ypos=0 sink_1::width=1920 sink_1::height=1080 ! tee name=t3 ! queue ! nvvidconv ! queue ! nvv4l2h264enc maxperf-enable=1 bitrate=${bitrate} profile=4 ! queue ! h264parse ! queue ! mux3. liveadder name=mixer ! voaacenc ! queue ! mux3. a1. ! queue ! mixer.sink_0 a2. ! queue ! mixer.sink_1 flvmux name=mux3 ! rtmpsink location="rtmp://localhost/live" t3. ! nvvidconv ! nvoverlaysink liveadder name=mix ! queue ! audioconvert ! audioresample ! "audio/x-raw,rate=48000,format=S16LE,layout=interleaved,channels=2" ! alsasink device="hw:0,3" sync=false async=false a1. ! queue ! mix.sink_0 a2. ! queue ! mix.sink_1 t1. ! queue ! image/jpeg,width=1920,height=1080,framerate=30/1 ! videorate ! image/jpeg,width=1920,height=1080,framerate=1/2 ! jpegparse ! multifilesink location=p1.jpg async=false t2. ! h264parse ! queue ! nvv4l2decoder ! nvvidconv ! queue ! "video/x-raw(memory:NVMM),width=1920,height=1080,format=NV12" ! nvvidconv ! "video/x-raw(memory:NVMM),format=I420" ! videorate ! "video/x-raw(memory:NVMM),framerate=1/1" ! nvjpegenc ! jpegparse ! queue ! multifilesink location=p2.jpg async=false liveadder name=mix4 ! queue ! audioconvert ! audioresample ! "audio/x-raw,rate=48000,channels=2,format=S16LE" ! alsasink device="hw:externAud,0" sync=false async=false a1. ! queue ! mix4.sink_0 a2. ! queue ! mix4.sink_1`

    // 50-50 pres rtsp 5050 rtsp rtsp ok

    let stval_50p1rt_rt_rt = `gst-launch-1.0 -e videotestsrc pattern=black ! video/x-raw,width=320,height=240 ! nvvidconv ! queue ! tee name=t5 ! queue ! comp1.sink_0 v4l2src device=/dev/presentation ! queue ! tee name=t1 ! video/x-raw, width=1920, height=1080, framerate=60/1 ! videorate ! video/x-raw, width=1920, height=1080, framerate=${fpsp1}/1 ! nvvidconv ! queue ! "video/x-raw(memory:NVMM),width=960,height=540,format=NV12" ! queue ! comp1.sink_1 rtspsrc location=${rtsplink} latency=0 ! application/x-rtp, media=video, encoding-name=H264 ! rtph264depay ! tee name=t2 ! queue ! h264parse ! queue ! nvv4l2decoder ! nvvidconv ! queue ! "video/x-raw(memory:NVMM),width=1920,height=1080,format=NV12" ! videorate ! "video/x-raw(memory:NVMM),width=1920,height=1080,format=NV12,framerate=${fpsp1}/1" ! nvvidconv ! queue ! "video/x-raw(memory:NVMM),width=960,height=540,format=NV12" ! queue ! comp1.sink_2 nvcompositor name=comp1 sink_0::width=1920 sink_0::height=1080 sink_1::xpos=0 sink_1::ypos=270 sink_1::width=960 sink_1::height=540 sink_2::xpos=960 sink_2::ypos=270 sink_2::width=960 sink_2::height=540 ! tee name=t4 ! queue ! nvvidconv ! queue ! nvv4l2h264enc maxperf-enable=1 bitrate=${bitrate} profile=4 ! queue ! h264parse ! queue ! mux. liveadder name=mix1 ! queue ! audioconvert ! voaacenc ! mux. alsasrc device="hw:externAud,0" ! queue ! audio/x-raw ! queue ! audioresample ! "audio/x-raw,rate=48000" ! tee name=a1 ! queue ! mix1.sink_0 alsasrc device="hw:channel1,0" ! queue ! audio/x-raw ! queue ! audioresample ! "audio/x-raw,rate=48000" ! tee name=a2 ! queue ! mix1.sink_1 mpegtsmux name=mux ! filesink location="/media/${hdduuid}/record-ts/${filename}.ts" videotestsrc pattern=black ! video/x-raw,width=320,height=240 ! nvvidconv ! queue ! comp.sink_0 t2. ! queue ! h264parse ! queue ! nvv4l2decoder ! nvvidconv ! queue ! "video/x-raw(memory:NVMM),width=1920,height=1080,format=NV12" ! queue ! comp.sink_1 nvcompositor name=comp sink_0::width=1920 sink_0::height=1080 sink_1::xpos=0 sink_1::ypos=0 sink_1::width=1920 sink_1::height=1080 ! tee name=t3 ! queue ! nvvidconv ! queue ! nvv4l2h264enc maxperf-enable=1 bitrate=${bitrate} profile=4 ! queue ! h264parse ! queue ! mux3. liveadder name=mixer ! voaacenc ! queue ! mux3. a1. ! queue ! mixer.sink_0 a2. ! queue ! mixer.sink_1 flvmux name=mux3 ! rtmpsink location="rtmp://localhost/live" t3. ! nvvidconv ! nvoverlaysink liveadder name=mix ! queue ! audioconvert ! audioresample ! "audio/x-raw,rate=48000,format=S16LE,layout=interleaved,channels=2" ! alsasink device="hw:0,3" sync=false async=false a1. ! queue ! mix.sink_0 a2. ! queue ! mix.sink_1 t1. ! queue ! video/x-raw, width=1920, height=1080, framerate=60/1 ! videorate ! video/x-raw, width=1920, height=1080, framerate=1/2 ! jpegenc ! jpegparse ! multifilesink location=p1.jpg async=false t2. ! h264parse ! queue ! nvv4l2decoder ! nvvidconv ! queue ! "video/x-raw(memory:NVMM),width=1920,height=1080,format=NV12" ! nvvidconv ! "video/x-raw(memory:NVMM),format=I420" ! videorate ! "video/x-raw(memory:NVMM),framerate=1/1" ! nvjpegenc ! jpegparse ! queue ! multifilesink location=p2.jpg async=false liveadder name=mix4 ! queue ! audioconvert ! audioresample ! "audio/x-raw,rate=48000,channels=2,format=S16LE" ! alsasink device="hw:externAud,0" sync=false async=false a1. ! queue ! mix4.sink_0 a2. ! queue ! mix4.sink_1`


    // SBS pres rtsp sbs rtsp rtsp top presbig ok

    let stval_sbsp1rt_rt_rt_top = `gst-launch-1.0 -e videotestsrc pattern=black ! video/x-raw,width=320,height=240 ! nvvidconv ! queue ! tee name=t5 ! queue ! comp1.sink_0 v4l2src device=/dev/presentation ! queue ! tee name=t1 ! video/x-raw, width=1920, height=1080, framerate=60/1 ! videorate ! video/x-raw, width=1920, height=1080, framerate=${fpsp1}/1 ! nvvidconv ! queue ! "video/x-raw(memory:NVMM),width=1494,height=840,format=NV12" ! queue ! comp1.sink_1 rtspsrc location=${rtsplink} latency=0 ! application/x-rtp, media=video, encoding-name=H264 ! rtph264depay ! tee name=t2 ! queue ! h264parse ! queue ! nvv4l2decoder ! nvvidconv ! queue ! "video/x-raw(memory:NVMM),width=1920,height=1080,format=NV12" ! videorate ! "video/x-raw(memory:NVMM),width=1920,height=1080,format=NV12,framerate=${fpsp1}/1" ! nvvidconv ! queue ! "video/x-raw(memory:NVMM),width=426,height=240,format=NV12" ! queue ! comp1.sink_2 nvcompositor name=comp1 sink_0::width=1920 sink_0::height=1080 sink_1::xpos=0 sink_1::ypos=120 sink_1::width=1494 sink_1::height=840 sink_2::xpos=1494 sink_2::ypos=120 sink_2::width=426 sink_2::height=240 ! tee name=t4 ! queue ! nvvidconv ! queue ! nvv4l2h264enc maxperf-enable=1 bitrate=${bitrate} profile=4 ! queue ! h264parse ! queue ! mux. liveadder name=mix1 ! queue ! audioconvert ! voaacenc ! mux. alsasrc device="hw:externAud,0" ! queue ! audio/x-raw ! queue ! audioresample ! "audio/x-raw,rate=48000" ! tee name=a1 ! queue ! mix1.sink_0 alsasrc device="hw:channel1,0" ! queue ! audio/x-raw ! queue ! audioresample ! "audio/x-raw,rate=48000" ! tee name=a2 ! queue ! mix1.sink_1 mpegtsmux name=mux ! filesink location="/media/${hdduuid}/record-ts/${filename}.ts" videotestsrc pattern=black ! video/x-raw,width=320,height=240 ! nvvidconv ! queue ! comp.sink_0 t2. ! queue ! h264parse ! queue ! nvv4l2decoder ! nvvidconv ! queue ! "video/x-raw(memory:NVMM),width=1920,height=1080,format=NV12" ! queue ! comp.sink_1 nvcompositor name=comp sink_0::width=1920 sink_0::height=1080 sink_1::xpos=0 sink_1::ypos=0 sink_1::width=1920 sink_1::height=1080 ! tee name=t3 ! queue ! nvvidconv ! queue ! nvv4l2h264enc maxperf-enable=1 bitrate=${bitrate} profile=4 ! queue ! h264parse ! queue ! mux3. liveadder name=mixer ! voaacenc ! queue ! mux3. a1. ! queue ! mixer.sink_0 a2. ! queue ! mixer.sink_1 flvmux name=mux3 ! rtmpsink location="rtmp://localhost/live" t3. ! nvvidconv ! nvoverlaysink liveadder name=mix ! queue ! audioconvert ! audioresample ! "audio/x-raw,rate=48000,format=S16LE,layout=interleaved,channels=2" ! alsasink device="hw:0,3" sync=false async=false a1. ! queue ! mix.sink_0 a2. ! queue ! mix.sink_1 t1. ! queue ! video/x-raw, width=1920, height=1080, framerate=60/1 ! videorate ! video/x-raw, width=1920, height=1080, framerate=1/2 ! jpegenc ! jpegparse ! multifilesink location=p1.jpg async=false t2. ! h264parse ! queue ! nvv4l2decoder ! nvvidconv ! queue ! "video/x-raw(memory:NVMM),width=1920,height=1080,format=NV12" ! nvvidconv ! "video/x-raw(memory:NVMM),format=I420" ! videorate ! "video/x-raw(memory:NVMM),framerate=1/1" ! nvjpegenc ! jpegparse ! queue ! multifilesink location=p2.jpg async=false liveadder name=mix4 ! queue ! audioconvert ! audioresample ! "audio/x-raw,rate=48000,channels=2,format=S16LE" ! alsasink device="hw:externAud,0" sync=false async=false a1. ! queue ! mix4.sink_0 a2. ! queue ! mix4.sink_1`

    // SBS pres rtsp sbs rtsp rtsp middle presbig ok

    let stval_sbsp1rt_rt_rt_mid = `gst-launch-1.0 -e videotestsrc pattern=black ! video/x-raw,width=320,height=240 ! nvvidconv ! queue ! tee name=t5 ! queue ! comp1.sink_0 v4l2src device=/dev/presentation ! queue ! tee name=t1 ! video/x-raw, width=1920, height=1080, framerate=60/1 ! videorate ! video/x-raw, width=1920, height=1080, framerate=${fpsp1}/1 ! nvvidconv ! queue ! "video/x-raw(memory:NVMM),width=1494,height=840,format=NV12" ! queue ! comp1.sink_1 rtspsrc location=${rtsplink} latency=0 ! application/x-rtp, media=video, encoding-name=H264 ! rtph264depay ! tee name=t2 ! queue ! h264parse ! queue ! nvv4l2decoder ! nvvidconv ! queue ! "video/x-raw(memory:NVMM),width=1920,height=1080,format=NV12" ! videorate ! "video/x-raw(memory:NVMM),width=1920,height=1080,format=NV12,framerate=${fpsp1}/1" ! nvvidconv ! queue ! "video/x-raw(memory:NVMM),width=426,height=240,format=NV12" ! queue ! comp1.sink_2 nvcompositor name=comp1 sink_0::width=1920 sink_0::height=1080 sink_1::xpos=0 sink_1::ypos=120 sink_1::width=1494 sink_1::height=840 sink_2::xpos=1494 sink_2::ypos=400 sink_2::width=426 sink_2::height=240 ! tee name=t4 ! queue ! nvvidconv ! queue ! nvv4l2h264enc maxperf-enable=1 bitrate=${bitrate} profile=4 ! queue ! h264parse ! queue ! mux. liveadder name=mix1 ! queue ! audioconvert ! voaacenc ! mux. alsasrc device="hw:externAud,0" ! queue ! audio/x-raw ! queue ! audioresample ! "audio/x-raw,rate=48000" ! tee name=a1 ! queue ! mix1.sink_0 alsasrc device="hw:channel1,0" ! queue ! audio/x-raw ! queue ! audioresample ! "audio/x-raw,rate=48000" ! tee name=a2 ! queue ! mix1.sink_1 mpegtsmux name=mux ! filesink location="/media/${hdduuid}/record-ts/${filename}.ts" videotestsrc pattern=black ! video/x-raw,width=320,height=240 ! nvvidconv ! queue ! comp.sink_0 t2. ! queue ! h264parse ! queue ! nvv4l2decoder ! nvvidconv ! queue ! "video/x-raw(memory:NVMM),width=1920,height=1080,format=NV12" ! queue ! comp.sink_1 nvcompositor name=comp sink_0::width=1920 sink_0::height=1080 sink_1::xpos=0 sink_1::ypos=0 sink_1::width=1920 sink_1::height=1080 ! tee name=t3 ! queue ! nvvidconv ! queue ! nvv4l2h264enc maxperf-enable=1 bitrate=${bitrate} profile=4 ! queue ! h264parse ! queue ! mux3. liveadder name=mixer ! voaacenc ! queue ! mux3. a1. ! queue ! mixer.sink_0 a2. ! queue ! mixer.sink_1 flvmux name=mux3 ! rtmpsink location="rtmp://localhost/live" t3. ! nvvidconv ! nvoverlaysink liveadder name=mix ! queue ! audioconvert ! audioresample ! "audio/x-raw,rate=48000,format=S16LE,layout=interleaved,channels=2" ! alsasink device="hw:0,3" sync=false async=false a1. ! queue ! mix.sink_0 a2. ! queue ! mix.sink_1 t1. ! queue ! video/x-raw, width=1920, height=1080, framerate=60/1 ! videorate ! video/x-raw, width=1920, height=1080, framerate=1/2 ! jpegenc ! jpegparse ! multifilesink location=p1.jpg async=false t2. ! h264parse ! queue ! nvv4l2decoder ! nvvidconv ! queue ! "video/x-raw(memory:NVMM),width=1920,height=1080,format=NV12" ! nvvidconv ! "video/x-raw(memory:NVMM),format=I420" ! videorate ! "video/x-raw(memory:NVMM),framerate=1/1" ! nvjpegenc ! jpegparse ! queue ! multifilesink location=p2.jpg async=false liveadder name=mix4 ! queue ! audioconvert ! audioresample ! "audio/x-raw,rate=48000,channels=2,format=S16LE" ! alsasink device="hw:externAud,0" sync=false async=false a1. ! queue ! mix4.sink_0 a2. ! queue ! mix4.sink_1`


    // SBS pres rtsp sbs rtsp rtsp bottom presbig ok

    let stval_sbsp1rt_rt_rt_bot = `gst-launch-1.0 -e videotestsrc pattern=black ! video/x-raw,width=320,height=240 ! nvvidconv ! queue ! tee name=t5 ! queue ! comp1.sink_0 v4l2src device=/dev/presentation ! queue ! tee name=t1 ! video/x-raw, width=1920, height=1080, framerate=60/1 ! videorate ! video/x-raw, width=1920, height=1080, framerate=${fpsp1}/1 ! nvvidconv ! queue ! "video/x-raw(memory:NVMM),width=1494,height=840,format=NV12" ! queue ! comp1.sink_1 rtspsrc location=${rtsplink} latency=0 ! application/x-rtp, media=video, encoding-name=H264 ! rtph264depay ! tee name=t2 ! queue ! h264parse ! queue ! nvv4l2decoder ! nvvidconv ! queue ! "video/x-raw(memory:NVMM),width=1920,height=1080,format=NV12" ! videorate ! "video/x-raw(memory:NVMM),width=1920,height=1080,format=NV12,framerate=${fpsp1}/1" ! nvvidconv ! queue ! "video/x-raw(memory:NVMM),width=426,height=240,format=NV12" ! queue ! comp1.sink_2 nvcompositor name=comp1 sink_0::width=1920 sink_0::height=1080 sink_1::xpos=0 sink_1::ypos=120 sink_1::width=1494 sink_1::height=840 sink_2::xpos=1494 sink_2::ypos=720 sink_2::width=426 sink_2::height=240 ! tee name=t4 ! queue ! nvvidconv ! queue ! nvv4l2h264enc maxperf-enable=1 bitrate=${bitrate} profile=4 ! queue ! h264parse ! queue ! mux. liveadder name=mix1 ! queue ! audioconvert ! voaacenc ! mux. alsasrc device="hw:externAud,0" ! queue ! audio/x-raw ! queue ! audioresample ! "audio/x-raw,rate=48000" ! tee name=a1 ! queue ! mix1.sink_0 alsasrc device="hw:channel1,0" ! queue ! audio/x-raw ! queue ! audioresample ! "audio/x-raw,rate=48000" ! tee name=a2 ! queue ! mix1.sink_1 mpegtsmux name=mux ! filesink location="/media/${hdduuid}/record-ts/${filename}.ts" videotestsrc pattern=black ! video/x-raw,width=320,height=240 ! nvvidconv ! queue ! comp.sink_0 t2. ! queue ! h264parse ! queue ! nvv4l2decoder ! nvvidconv ! queue ! "video/x-raw(memory:NVMM),width=1920,height=1080,format=NV12" ! queue ! comp.sink_1 nvcompositor name=comp sink_0::width=1920 sink_0::height=1080 sink_1::xpos=0 sink_1::ypos=0 sink_1::width=1920 sink_1::height=1080 ! tee name=t3 ! queue ! nvvidconv ! queue ! nvv4l2h264enc maxperf-enable=1 bitrate=${bitrate} profile=4 ! queue ! h264parse ! queue ! mux3. liveadder name=mixer ! voaacenc ! queue ! mux3. a1. ! queue ! mixer.sink_0 a2. ! queue ! mixer.sink_1 flvmux name=mux3 ! rtmpsink location="rtmp://localhost/live" t3. ! nvvidconv ! nvoverlaysink liveadder name=mix ! queue ! audioconvert ! audioresample ! "audio/x-raw,rate=48000,format=S16LE,layout=interleaved,channels=2" ! alsasink device="hw:0,3" sync=false async=false a1. ! queue ! mix.sink_0 a2. ! queue ! mix.sink_1 t1. ! queue ! video/x-raw, width=1920, height=1080, framerate=60/1 ! videorate ! video/x-raw, width=1920, height=1080, framerate=1/2 ! jpegenc ! jpegparse ! multifilesink location=p1.jpg async=false t2. ! h264parse ! queue ! nvv4l2decoder ! nvvidconv ! queue ! "video/x-raw(memory:NVMM),width=1920,height=1080,format=NV12" ! nvvidconv ! "video/x-raw(memory:NVMM),format=I420" ! videorate ! "video/x-raw(memory:NVMM),framerate=1/1" ! nvjpegenc ! jpegparse ! queue ! multifilesink location=p2.jpg async=false liveadder name=mix4 ! queue ! audioconvert ! audioresample ! "audio/x-raw,rate=48000,channels=2,format=S16LE" ! alsasink device="hw:externAud,0" sync=false async=false a1. ! queue ! mix4.sink_0 a2. ! queue ! mix4.sink_1`

    //camera big///////////////

    // SBS pres rtsp sbs rtsp rtsp top cambig ok

    let stval_sbsrtp1_rt_rt_top = `gst-launch-1.0 -e videotestsrc pattern=black ! video/x-raw,width=320,height=240 ! nvvidconv ! queue ! tee name=t5 ! queue ! comp1.sink_0 v4l2src device=/dev/presentation ! queue ! tee name=t1 ! video/x-raw, width=1920, height=1080, framerate=60/1 ! videorate ! video/x-raw, width=1920, height=1080, framerate=${fpsp1}/1 ! nvvidconv ! queue ! "video/x-raw(memory:NVMM),width=426,height=240,format=NV12" ! queue ! comp1.sink_2 rtspsrc location=${rtsplink} latency=0 ! application/x-rtp, media=video, encoding-name=H264 ! rtph264depay ! tee name=t2 ! queue ! h264parse ! queue ! nvv4l2decoder ! nvvidconv ! queue ! "video/x-raw(memory:NVMM),width=1920,height=1080,format=NV12" ! videorate ! "video/x-raw(memory:NVMM),width=1920,height=1080,format=NV12,framerate=${fpsp1}/1" ! nvvidconv ! queue ! "video/x-raw(memory:NVMM),width=1494,height=840,format=NV12" ! queue ! comp1.sink_1 nvcompositor name=comp1 sink_0::width=1920 sink_0::height=1080 sink_1::xpos=0 sink_1::ypos=120 sink_1::width=1494 sink_1::height=840 sink_2::xpos=1494 sink_2::ypos=120 sink_2::width=426 sink_2::height=240 ! tee name=t4 ! queue ! nvvidconv ! queue ! nvv4l2h264enc maxperf-enable=1 bitrate=${bitrate} profile=4 ! queue ! h264parse ! queue ! mux. liveadder name=mix1 ! queue ! audioconvert ! voaacenc ! mux. alsasrc device="hw:externAud,0" ! queue ! audio/x-raw ! queue ! audioresample ! "audio/x-raw,rate=48000" ! tee name=a1 ! queue ! mix1.sink_0 alsasrc device="hw:channel1,0" ! queue ! audio/x-raw ! queue ! audioresample ! "audio/x-raw,rate=48000" ! tee name=a2 ! queue ! mix1.sink_1 mpegtsmux name=mux ! filesink location="/media/${hdduuid}/record-ts/${filename}.ts" videotestsrc pattern=black ! video/x-raw,width=320,height=240 ! nvvidconv ! queue ! comp.sink_0 t2. ! queue ! h264parse ! queue ! nvv4l2decoder ! nvvidconv ! queue ! "video/x-raw(memory:NVMM),width=1920,height=1080,format=NV12" ! queue ! comp.sink_1 nvcompositor name=comp sink_0::width=1920 sink_0::height=1080 sink_1::xpos=0 sink_1::ypos=0 sink_1::width=1920 sink_1::height=1080 ! tee name=t3 ! queue ! nvvidconv ! queue ! nvv4l2h264enc maxperf-enable=1 bitrate=${bitrate} profile=4 ! queue ! h264parse ! queue ! mux3. liveadder name=mixer ! voaacenc ! queue ! mux3. a1. ! queue ! mixer.sink_0 a2. ! queue ! mixer.sink_1 flvmux name=mux3 ! rtmpsink location="rtmp://localhost/live" t3. ! nvvidconv ! nvoverlaysink liveadder name=mix ! queue ! audioconvert ! audioresample ! "audio/x-raw,rate=48000,format=S16LE,layout=interleaved,channels=2" ! alsasink device="hw:0,3" sync=false async=false a1. ! queue ! mix.sink_0 a2. ! queue ! mix.sink_1 t1. ! queue ! video/x-raw, width=1920, height=1080, framerate=60/1 ! videorate ! video/x-raw, width=1920, height=1080, framerate=1/2 ! jpegenc ! jpegparse ! multifilesink location=p1.jpg async=false t2. ! h264parse ! queue ! nvv4l2decoder ! nvvidconv ! queue ! "video/x-raw(memory:NVMM),width=1920,height=1080,format=NV12" ! nvvidconv ! "video/x-raw(memory:NVMM),format=I420" ! videorate ! "video/x-raw(memory:NVMM),framerate=1/1" ! nvjpegenc ! jpegparse ! queue ! multifilesink location=p2.jpg async=false liveadder name=mix4 ! queue ! audioconvert ! audioresample ! "audio/x-raw,rate=48000,channels=2,format=S16LE" ! alsasink device="hw:externAud,0" sync=false async=false a1. ! queue ! mix4.sink_0 a2. ! queue ! mix4.sink_1`

    // SBS pres rtsp sbs rtsp rtsp middle cambig ok

    let stval_sbsrtp1_rt_rt_mid = `gst-launch-1.0 -e videotestsrc pattern=black ! video/x-raw,width=320,height=240 ! nvvidconv ! queue ! tee name=t5 ! queue ! comp1.sink_0 v4l2src device=/dev/presentation ! queue ! tee name=t1 ! video/x-raw, width=1920, height=1080, framerate=60/1 ! videorate ! video/x-raw, width=1920, height=1080, framerate=${fpsp1}/1 ! nvvidconv ! queue ! "video/x-raw(memory:NVMM),width=426,height=240,format=NV12" ! queue ! comp1.sink_2 rtspsrc location=${rtsplink} latency=0 ! application/x-rtp, media=video, encoding-name=H264 ! rtph264depay ! tee name=t2 ! queue ! h264parse ! queue ! nvv4l2decoder ! nvvidconv ! queue ! "video/x-raw(memory:NVMM),width=1920,height=1080,format=NV12" ! videorate ! "video/x-raw(memory:NVMM),width=1920,height=1080,format=NV12,framerate=${fpsp1}/1" ! nvvidconv ! queue ! "video/x-raw(memory:NVMM),width=1494,height=840,format=NV12" ! queue ! comp1.sink_1 nvcompositor name=comp1 sink_0::width=1920 sink_0::height=1080 sink_1::xpos=0 sink_1::ypos=120 sink_1::width=1494 sink_1::height=840 sink_2::xpos=1494 sink_2::ypos=400 sink_2::width=426 sink_2::height=240 ! tee name=t4 ! queue ! nvvidconv ! queue ! nvv4l2h264enc maxperf-enable=1 bitrate=${bitrate} profile=4 ! queue ! h264parse ! queue ! mux. liveadder name=mix1 ! queue ! audioconvert ! voaacenc ! mux. alsasrc device="hw:externAud,0" ! queue ! audio/x-raw ! queue ! audioresample ! "audio/x-raw,rate=48000" ! tee name=a1 ! queue ! mix1.sink_0 alsasrc device="hw:channel1,0" ! queue ! audio/x-raw ! queue ! audioresample ! "audio/x-raw,rate=48000" ! tee name=a2 ! queue ! mix1.sink_1 mpegtsmux name=mux ! filesink location="/media/${hdduuid}/record-ts/${filename}.ts" videotestsrc pattern=black ! video/x-raw,width=320,height=240 ! nvvidconv ! queue ! comp.sink_0 t2. ! queue ! h264parse ! queue ! nvv4l2decoder ! nvvidconv ! queue ! "video/x-raw(memory:NVMM),width=1920,height=1080,format=NV12" ! queue ! comp.sink_1 nvcompositor name=comp sink_0::width=1920 sink_0::height=1080 sink_1::xpos=0 sink_1::ypos=0 sink_1::width=1920 sink_1::height=1080 ! tee name=t3 ! queue ! nvvidconv ! queue ! nvv4l2h264enc maxperf-enable=1 bitrate=${bitrate} profile=4 ! queue ! h264parse ! queue ! mux3. liveadder name=mixer ! voaacenc ! queue ! mux3. a1. ! queue ! mixer.sink_0 a2. ! queue ! mixer.sink_1 flvmux name=mux3 ! rtmpsink location="rtmp://localhost/live" t3. ! nvvidconv ! nvoverlaysink liveadder name=mix ! queue ! audioconvert ! audioresample ! "audio/x-raw,rate=48000,format=S16LE,layout=interleaved,channels=2" ! alsasink device="hw:0,3" sync=false async=false a1. ! queue ! mix.sink_0 a2. ! queue ! mix.sink_1 t1. ! queue ! video/x-raw, width=1920, height=1080, framerate=60/1 ! videorate ! video/x-raw, width=1920, height=1080, framerate=1/2 ! jpegenc ! jpegparse ! multifilesink location=p1.jpg async=false t2. ! h264parse ! queue ! nvv4l2decoder ! nvvidconv ! queue ! "video/x-raw(memory:NVMM),width=1920,height=1080,format=NV12" ! nvvidconv ! "video/x-raw(memory:NVMM),format=I420" ! videorate ! "video/x-raw(memory:NVMM),framerate=1/1" ! nvjpegenc ! jpegparse ! queue ! multifilesink location=p2.jpg async=false liveadder name=mix4 ! queue ! audioconvert ! audioresample ! "audio/x-raw,rate=48000,channels=2,format=S16LE" ! alsasink device="hw:externAud,0" sync=false async=false a1. ! queue ! mix4.sink_0 a2. ! queue ! mix4.sink_1`



    // SBS pres rtsp sbs rtsp rtsp bottom cambig ok

    let stval_sbsrtp1_rt_rt_bot = `gst-launch-1.0 -e videotestsrc pattern=black ! video/x-raw,width=320,height=240 ! nvvidconv ! queue ! tee name=t5 ! queue ! comp1.sink_0 v4l2src device=/dev/presentation ! queue ! tee name=t1 ! video/x-raw, width=1920, height=1080, framerate=60/1 ! videorate ! video/x-raw, width=1920, height=1080, framerate=${fpsp1}/1 ! nvvidconv ! queue ! "video/x-raw(memory:NVMM),width=426,height=240,format=NV12" ! queue ! comp1.sink_2 rtspsrc location=${rtsplink} latency=0 ! application/x-rtp, media=video, encoding-name=H264 ! rtph264depay ! tee name=t2 ! queue ! h264parse ! queue ! nvv4l2decoder ! nvvidconv ! queue ! "video/x-raw(memory:NVMM),width=1920,height=1080,format=NV12" ! videorate ! "video/x-raw(memory:NVMM),width=1920,height=1080,format=NV12,framerate=${fpsp1}/1" ! nvvidconv ! queue ! "video/x-raw(memory:NVMM),width=1494,height=840,format=NV12" ! queue ! comp1.sink_1 nvcompositor name=comp1 sink_0::width=1920 sink_0::height=1080 sink_1::xpos=0 sink_1::ypos=120 sink_1::width=1494 sink_1::height=840 sink_2::xpos=1494 sink_2::ypos=720 sink_2::width=426 sink_2::height=240 ! tee name=t4 ! queue ! nvvidconv ! queue ! nvv4l2h264enc maxperf-enable=1 bitrate=${bitrate} profile=4 ! queue ! h264parse ! queue ! mux. liveadder name=mix1 ! queue ! audioconvert ! voaacenc ! mux. alsasrc device="hw:externAud,0" ! queue ! audio/x-raw ! queue ! audioresample ! "audio/x-raw,rate=48000" ! tee name=a1 ! queue ! mix1.sink_0 alsasrc device="hw:channel1,0" ! queue ! audio/x-raw ! queue ! audioresample ! "audio/x-raw,rate=48000" ! tee name=a2 ! queue ! mix1.sink_1 mpegtsmux name=mux ! filesink location="/media/${hdduuid}/record-ts/${filename}.ts" videotestsrc pattern=black ! video/x-raw,width=320,height=240 ! nvvidconv ! queue ! comp.sink_0 t2. ! queue ! h264parse ! queue ! nvv4l2decoder ! nvvidconv ! queue ! "video/x-raw(memory:NVMM),width=1920,height=1080,format=NV12" ! queue ! comp.sink_1 nvcompositor name=comp sink_0::width=1920 sink_0::height=1080 sink_1::xpos=0 sink_1::ypos=0 sink_1::width=1920 sink_1::height=1080 ! tee name=t3 ! queue ! nvvidconv ! queue ! nvv4l2h264enc maxperf-enable=1 bitrate=${bitrate} profile=4 ! queue ! h264parse ! queue ! mux3. liveadder name=mixer ! voaacenc ! queue ! mux3. a1. ! queue ! mixer.sink_0 a2. ! queue ! mixer.sink_1 flvmux name=mux3 ! rtmpsink location="rtmp://localhost/live" t3. ! nvvidconv ! nvoverlaysink liveadder name=mix ! queue ! audioconvert ! audioresample ! "audio/x-raw,rate=48000,format=S16LE,layout=interleaved,channels=2" ! alsasink device="hw:0,3" sync=false async=false a1. ! queue ! mix.sink_0 a2. ! queue ! mix.sink_1 t1. ! queue ! video/x-raw, width=1920, height=1080, framerate=60/1 ! videorate ! video/x-raw, width=1920, height=1080, framerate=1/2 ! jpegenc ! jpegparse ! multifilesink location=p1.jpg async=false t2. ! h264parse ! queue ! nvv4l2decoder ! nvvidconv ! queue ! "video/x-raw(memory:NVMM),width=1920,height=1080,format=NV12" ! nvvidconv ! "video/x-raw(memory:NVMM),format=I420" ! videorate ! "video/x-raw(memory:NVMM),framerate=1/1" ! nvjpegenc ! jpegparse ! queue ! multifilesink location=p2.jpg async=false liveadder name=mix4 ! queue ! audioconvert ! audioresample ! "audio/x-raw,rate=48000,channels=2,format=S16LE" ! alsasink device="hw:externAud,0" sync=false async=false a1. ! queue ! mix4.sink_0 a2. ! queue ! mix4.sink_1`

    // SINGLE FILE RTSP RTSP RTSP

    let stval_sirt_rt_rt = `gst-launch-1.0 -e rtspsrc location=${rtsplink} latency=0 ! application/x-rtp, media=video, encoding-name=H264 ! rtph264depay ! tee name=t2 ! queue ! h264parse ! queue ! nvv4l2decoder ! nvvidconv ! queue ! "video/x-raw(memory:NVMM),width=1920,height=1080,format=NV12" ! videorate ! "video/x-raw(memory:NVMM),width=1920,height=1080,format=NV12,framerate=${fpsp2}/1" ! nvv4l2h264enc maxperf-enable=1 bitrate=${bitrate} profile=4 ! queue ! h264parse ! queue ! mux.video_0 liveadder name=mix1 ! queue ! audioconvert ! voaacenc ! mux.audio_0 alsasrc device="hw:externAud,0" ! queue ! audio/x-raw ! queue ! audioresample ! "audio/x-raw,rate=48000" ! tee name=a1 ! queue ! mix1.sink_0 alsasrc device="hw:channel1,0" ! queue ! audio/x-raw ! queue ! audioresample ! "audio/x-raw,rate=48000" ! tee name=a2 ! queue ! mix1.sink_1 mp4mux name=mux ! filesink location='/media/${hdduuid}/record/${filename}.mp4' videotestsrc pattern=black ! video/x-raw,width=320,height=240 ! nvvidconv ! queue ! comp.sink_0 t2. ! queue ! h264parse ! queue ! nvv4l2decoder ! nvvidconv ! queue ! "video/x-raw(memory:NVMM),width=1920,height=1080,format=NV12" ! queue ! comp.sink_1 nvcompositor name=comp sink_0::width=1920 sink_0::height=1080 sink_1::xpos=0 sink_1::ypos=0 sink_1::width=1920 sink_1::height=1080 ! tee name=t3 ! queue ! nvvidconv ! queue ! nvv4l2h264enc maxperf-enable=1 bitrate=${bitrate} profile=4 ! queue ! h264parse ! queue ! mux3. liveadder name=mixer ! voaacenc ! queue ! mux3. a1. ! queue ! mixer.sink_0 a2. ! queue ! mixer.sink_1 flvmux name=mux3 ! rtmpsink location="rtmp://localhost/live" t3. ! nvvidconv ! nvoverlaysink liveadder name=mix ! queue ! audioconvert ! audioresample ! "audio/x-raw,rate=48000,format=S16LE,layout=interleaved,channels=2" ! alsasink device="hw:0,3" sync=false async=false a1. ! queue ! mix.sink_0 a2. ! queue ! mix.sink_1 t2. ! h264parse ! queue ! nvv4l2decoder ! nvvidconv ! queue ! "video/x-raw(memory:NVMM),width=1920,height=1080,format=NV12" ! nvvidconv ! "video/x-raw(memory:NVMM),format=I420" ! videorate ! "video/x-raw(memory:NVMM),framerate=1/1" ! nvjpegenc ! jpegparse ! queue ! multifilesink location=p1.jpg async=false liveadder name=mix4 ! queue ! audioconvert ! audioresample ! "audio/x-raw,rate=48000,channels=2,format=S16LE" ! alsasink device="hw:externAud,0" sync=false async=false a1. ! queue ! mix4.sink_0 a2. ! queue ! mix4.sink_1`

    // single file rtsp, usb/rtsp sbs, usb/rtsp sbs

    let stval_sirt_rtusb_rtusb_sbs = `gst-launch-1.0 -e rtspsrc location=${rtsplink} latency=0 ! application/x-rtp, media=video, encoding-name=H264 ! rtph264depay ! tee name=t2 ! queue ! h264parse ! queue ! nvv4l2decoder ! nvvidconv ! queue ! "video/x-raw(memory:NVMM),width=1920,height=1080,format=NV12" ! videorate ! "video/x-raw(memory:NVMM),width=1920,height=1080,format=NV12,framerate=${fpsp2}/1" ! nvv4l2h264enc maxperf-enable=1 bitrate=${bitrate} profile=4 ! queue ! h264parse ! queue ! mux.video_0 liveadder name=mix1 ! queue ! audioconvert ! voaacenc ! mux.audio_0 alsasrc device="hw:externAud,0" ! queue ! audio/x-raw ! queue ! audioresample ! "audio/x-raw,rate=48000" ! tee name=a1 ! queue ! mix1.sink_0 alsasrc device="hw:channel1,0" ! queue ! audio/x-raw ! queue ! audioresample ! "audio/x-raw,rate=48000" ! tee name=a2 ! queue ! mix1.sink_1 mp4mux name=mux ! filesink location='/media/${hdduuid}/record/${filename}.mp4' videotestsrc pattern=black ! video/x-raw,width=320,height=240 ! nvvidconv ! queue ! comp.sink_0 t2. ! queue ! h264parse ! queue ! nvv4l2decoder ! nvvidconv ! queue ! "video/x-raw(memory:NVMM),width=1494,height=840,format=NV12" ! queue ! comp.sink_1 v4l2src device=/dev/exCAM io-mode=2 ! queue ! image/jpeg,width=1920,height=1080,framerate=30/1 ! videorate ! image/jpeg,width=1920,height=1080,framerate=${fpsp2}/1 ! jpegparse ! nvv4l2decoder mjpeg=1 ! nvvidconv ! queue ! "video/x-raw(memory:NVMM),width=426,height=240,format=NV12" ! queue ! comp.sink_2 nvcompositor name=comp sink_0::width=1920 sink_0::height=1080 sink_1::xpos=0 sink_1::ypos=120 sink_1::width=1494 sink_1::height=840 sink_2::xpos=1494 sink_2::ypos=120 sink_2::width=426 sink_2::height=240 ! tee name=t3 ! queue ! nvvidconv ! queue ! nvv4l2h264enc maxperf-enable=1 bitrate=${bitrate} profile=4 ! queue ! h264parse ! queue ! mux3. liveadder name=mixer ! voaacenc ! queue ! mux3. a1. ! queue ! mixer.sink_0 a2. ! queue ! mixer.sink_1 flvmux name=mux3 ! rtmpsink location="rtmp://localhost/live" t3. ! nvvidconv ! nvoverlaysink liveadder name=mix ! queue ! audioconvert ! audioresample ! "audio/x-raw,rate=48000,format=S16LE,layout=interleaved,channels=2" ! alsasink device="hw:0,3" sync=false async=false a1. ! queue ! mix.sink_0 a2. ! queue ! mix.sink_1 t2. ! h264parse ! queue ! nvv4l2decoder ! nvvidconv ! queue ! "video/x-raw(memory:NVMM),width=1920,height=1080,format=NV12" ! nvvidconv ! "video/x-raw(memory:NVMM),format=I420" ! videorate ! "video/x-raw(memory:NVMM),framerate=1/1" ! nvjpegenc ! jpegparse ! queue ! multifilesink location=p1.jpg async=false liveadder name=mix4 ! queue ! audioconvert ! audioresample ! "audio/x-raw,rate=48000,channels=2,format=S16LE" ! alsasink device="hw:externAud,0" sync=false async=false a1. ! queue ! mix4.sink_0 a2. ! queue ! mix4.sink_1`


    // Dual RTSP

    // separate files(presentation/rtsp) SBS(livestream=rtsp/rtsp2) SBS(zoom=rtsp/rtsp2) okk

    let stval_sfp1rt_rt1rt2_rt1rt2_sbs = `gst-launch-1.0 -e v4l2src device=/dev/presentation ! queue ! tee name=t1 ! video/x-raw, width=1920, height=1080, framerate=60/1 ! videorate ! video/x-raw, width=1920, height=1080, framerate=${fpsp2}/1 ! nvvidconv ! queue ! nvv4l2h264enc maxperf-enable=1 bitrate=${bitrate} profile=4 ! queue ! h264parse ! queue ! mpegtsmux ! filesink location='/media/${hdduuid}/record-ts/${filename}~1.ts' rtspsrc location=${rtsplink} latency=0 ! application/x-rtp, media=video, encoding-name=H264 ! rtph264depay ! tee name=t2 ! queue ! h264parse ! queue ! nvv4l2decoder ! nvvidconv ! queue ! "video/x-raw(memory:NVMM),width=1920,height=1080,format=NV12" ! videorate ! "video/x-raw(memory:NVMM),width=1920,height=1080,format=NV12,framerate=${fpsp2}/1" ! nvv4l2h264enc ! queue ! h264parse ! mux. liveadder name=mix1 ! queue ! audioconvert ! voaacenc ! mux. alsasrc device="hw:externAud,0" ! queue ! audio/x-raw ! queue ! audioresample ! "audio/x-raw,rate=48000" ! tee name=a1 ! queue ! mix1.sink_0 alsasrc device="hw:channel1,0" ! queue ! audio/x-raw ! queue ! audioresample ! "audio/x-raw,rate=48000" ! tee name=a2 ! queue ! mix1.sink_1 mpegtsmux name=mux ! filesink location='/media/${hdduuid}/record-ts/${filename}~2.ts' videotestsrc pattern=black ! video/x-raw,width=320,height=240 ! nvvidconv ! queue ! comp.sink_0 t2. ! queue ! h264parse ! queue ! nvv4l2decoder ! nvvidconv ! queue ! "video/x-raw(memory:NVMM),width=1494,height=840,format=NV12" ! queue ! comp.sink_1 rtspsrc location=${rtsplink2} latency=0 ! application/x-rtp, media=video, encoding-name=H264 ! rtph264depay ! queue ! h264parse ! queue ! nvv4l2decoder ! nvvidconv ! queue ! "video/x-raw(memory:NVMM),width=426,height=240,format=NV12" ! queue ! comp.sink_2 nvcompositor name=comp sink_0::width=1920 sink_0::height=1080 sink_1::xpos=0 sink_1::ypos=120 sink_1::width=1494 sink_1::height=840 sink_2::xpos=1494 sink_2::ypos=120 sink_2::width=426 sink_2::height=240 ! tee name=t3 ! queue ! nvvidconv ! queue ! nvv4l2h264enc maxperf-enable=1 bitrate=${bitrate} profile=4 ! queue ! h264parse ! queue ! mux3. liveadder name=mixer ! voaacenc ! queue ! mux3. a1. ! queue ! mixer.sink_0 a2. ! queue ! mixer.sink_1 flvmux name=mux3 ! rtmpsink location="rtmp://localhost/live" t3. ! nvvidconv ! nvoverlaysink liveadder name=mix ! queue ! audioconvert ! audioresample ! "audio/x-raw,rate=48000,format=S16LE,layout=interleaved,channels=2" ! alsasink device="hw:0,3" sync=false async=false a1. ! queue ! mix.sink_0 a2. ! queue ! mix.sink_1 t1. ! queue ! video/x-raw, width=1920, height=1080, framerate=60/1 ! videorate ! video/x-raw, width=1920, height=1080, framerate=1/2 ! jpegenc ! jpegparse ! multifilesink location=p1.jpg async=false t2. ! h264parse ! queue ! nvv4l2decoder ! nvvidconv ! queue ! "video/x-raw(memory:NVMM),width=1920,height=1080,format=NV12" ! nvvidconv ! "video/x-raw(memory:NVMM),format=I420" ! videorate ! "video/x-raw(memory:NVMM),framerate=1/1" ! nvjpegenc ! jpegparse ! queue ! multifilesink location=p2.jpg async=false liveadder name=mix4 ! queue ! audioconvert ! audioresample ! "audio/x-raw,rate=48000,channels=2,format=S16LE" ! alsasink device="hw:externAud,0" sync=false async=false a1. ! queue ! mix4.sink_0 a2. ! queue ! mix4.sink_1`

    // separate files(presentation/rtsp) 50/50(livestream=rtsp/rtsp2) 50/50(zoom=rtsp/rtsp2) okk

    let stval_sfp1rt_rt1rt2_rt1rt2_50 = `gst-launch-1.0 -e v4l2src device=/dev/presentation ! queue ! tee name=t1 ! video/x-raw, width=1920, height=1080, framerate=60/1 ! videorate ! video/x-raw, width=1920, height=1080, framerate=${fpsp2}/1 ! nvvidconv ! queue ! nvv4l2h264enc maxperf-enable=1 bitrate=${bitrate} profile=4 ! queue ! h264parse ! queue ! mpegtsmux ! filesink location='/media/${hdduuid}/record-ts/${filename}~1.ts' rtspsrc location=${rtsplink} latency=0 ! application/x-rtp, media=video, encoding-name=H264 ! rtph264depay ! tee name=t2 ! queue ! h264parse ! queue ! nvv4l2decoder ! nvvidconv ! queue ! "video/x-raw(memory:NVMM),width=1920,height=1080,format=NV12" ! videorate ! "video/x-raw(memory:NVMM),width=1920,height=1080,format=NV12,framerate=${fpsp2}/1" ! nvv4l2h264enc ! queue ! h264parse ! mux. liveadder name=mix1 ! queue ! audioconvert ! voaacenc ! mux. alsasrc device="hw:externAud,0" ! queue ! audio/x-raw ! queue ! audioresample ! "audio/x-raw,rate=48000" ! tee name=a1 ! queue ! mix1.sink_0 alsasrc device="hw:channel1,0" ! queue ! audio/x-raw ! queue ! audioresample ! "audio/x-raw,rate=48000" ! tee name=a2 ! queue ! mix1.sink_1 mpegtsmux name=mux ! filesink location='/media/${hdduuid}/record-ts/${filename}~2.ts' videotestsrc pattern=black ! video/x-raw,width=320,height=240 ! nvvidconv ! queue ! comp.sink_0 t2. ! queue ! h264parse ! queue ! nvv4l2decoder ! nvvidconv ! queue ! "video/x-raw(memory:NVMM),width=960,height=540,format=NV12" ! queue ! comp.sink_1 rtspsrc location=${rtsplink2} latency=0 ! application/x-rtp, media=video, encoding-name=H264 ! rtph264depay ! queue ! h264parse ! queue ! nvv4l2decoder ! nvvidconv ! queue ! "video/x-raw(memory:NVMM),width=960,height=540,format=NV12" ! queue ! comp.sink_2 nvcompositor name=comp sink_0::width=1920 sink_0::height=1080 sink_1::xpos=0 sink_1::ypos=270 sink_1::width=960 sink_1::height=540 sink_2::xpos=960 sink_2::ypos=270 sink_2::width=960 sink_2::height=540 ! tee name=t3 ! queue ! nvvidconv ! queue ! nvv4l2h264enc maxperf-enable=1 bitrate=${bitrate} profile=4 ! queue ! h264parse ! queue ! mux3. liveadder name=mixer ! voaacenc ! queue ! mux3. a1. ! queue ! mixer.sink_0 a2. ! queue ! mixer.sink_1 flvmux name=mux3 ! rtmpsink location="rtmp://localhost/live" t3. ! nvvidconv ! nvoverlaysink liveadder name=mix ! queue ! audioconvert ! audioresample ! "audio/x-raw,rate=48000,format=S16LE,layout=interleaved,channels=2" ! alsasink device="hw:0,3" sync=false async=false a1. ! queue ! mix.sink_0 a2. ! queue ! mix.sink_1 t1. ! queue ! video/x-raw, width=1920, height=1080, framerate=60/1 ! videorate ! video/x-raw, width=1920, height=1080, framerate=1/2 ! jpegenc ! jpegparse ! multifilesink location=p1.jpg async=false t2. ! h264parse ! queue ! nvv4l2decoder ! nvvidconv ! queue ! "video/x-raw(memory:NVMM),width=1920,height=1080,format=NV12" ! nvvidconv ! "video/x-raw(memory:NVMM),format=I420" ! videorate ! "video/x-raw(memory:NVMM),framerate=1/1" ! nvjpegenc ! jpegparse ! queue ! multifilesink location=p2.jpg async=false liveadder name=mix4 ! queue ! audioconvert ! audioresample ! "audio/x-raw,rate=48000,channels=2,format=S16LE" ! alsasink device="hw:externAud,0" sync=false async=false a1. ! queue ! mix4.sink_0 a2. ! queue ! mix4.sink_1`

    //single files(presentation/rtsp)SBS SBS(livestream=rtsp/rtsp2) SBS(zoom=rtsp/rtsp2)

    let stval_sbsp1rt_rt1rt2_sbs = `gst-launch-1.0 -e videotestsrc pattern=black ! video/x-raw,width=320,height=240 ! nvvidconv ! queue ! tee name=t5 ! queue ! comp1.sink_0 v4l2src device=/dev/presentation ! queue ! tee name=t1 ! video/x-raw, width=1920, height=1080, framerate=60/1 ! videorate ! video/x-raw, width=1920, height=1080, framerate=${fpsp1}/1 ! nvvidconv ! queue ! "video/x-raw(memory:NVMM),width=1494,height=840,format=NV12" ! queue ! comp1.sink_1 rtspsrc location=${rtsplink} latency=0 ! application/x-rtp, media=video, encoding-name=H264 ! rtph264depay ! tee name=t2 ! queue ! h264parse ! queue ! nvv4l2decoder ! nvvidconv ! queue ! "video/x-raw(memory:NVMM),width=1920,height=1080,format=NV12" ! videorate ! "video/x-raw(memory:NVMM),width=1920,height=1080,format=NV12,framerate=${fpsp1}/1" ! nvvidconv ! queue ! "video/x-raw(memory:NVMM),width=426,height=240,format=NV12" ! queue ! comp1.sink_2 nvcompositor name=comp1 sink_0::width=1920 sink_0::height=1080 sink_1::xpos=0 sink_1::ypos=120 sink_1::width=1494 sink_1::height=840 sink_2::xpos=1494 sink_2::ypos=120 sink_2::width=426 sink_2::height=240 ! tee name=t4 ! queue ! nvvidconv ! queue ! nvv4l2h264enc maxperf-enable=1 bitrate=${bitrate} profile=4 ! queue ! h264parse ! queue ! mux. liveadder name=mix1 ! queue ! audioconvert ! voaacenc ! mux. alsasrc device="hw:externAud,0" ! queue ! audio/x-raw ! queue ! audioresample ! "audio/x-raw,rate=48000" ! tee name=a1 ! queue ! mix1.sink_0 alsasrc device="hw:channel1,0" ! queue ! audio/x-raw ! queue ! audioresample ! "audio/x-raw,rate=48000" ! tee name=a2 ! queue ! mix1.sink_1 mpegtsmux name=mux ! filesink location="/media/${hdduuid}/record-ts/${filename}.ts" videotestsrc pattern=black ! video/x-raw,width=320,height=240 ! nvvidconv ! queue ! comp.sink_0 t2. ! queue ! h264parse ! queue ! nvv4l2decoder ! nvvidconv ! queue ! "video/x-raw(memory:NVMM),width=1494,height=840,format=NV12" ! queue ! comp.sink_1 rtspsrc location=${rtsplink2} latency=0 ! application/x-rtp, media=video, encoding-name=H264 ! rtph264depay ! queue ! h264parse ! queue ! nvv4l2decoder ! nvvidconv ! queue ! "video/x-raw(memory:NVMM),width=426,height=240,format=NV12" ! queue ! comp.sink_2 nvcompositor name=comp sink_0::width=1920 sink_0::height=1080 sink_1::xpos=0 sink_1::ypos=120 sink_1::width=1494 sink_1::height=840 sink_2::xpos=1494 sink_2::ypos=120 sink_2::width=426 sink_2::height=240 ! tee name=t3 ! queue ! nvvidconv ! queue ! nvv4l2h264enc maxperf-enable=1 bitrate=${bitrate} profile=4 ! queue ! h264parse ! queue ! mux3. liveadder name=mixer ! voaacenc ! queue ! mux3. a1. ! queue ! mixer.sink_0 a2. ! queue ! mixer.sink_1 flvmux name=mux3 ! rtmpsink location="rtmp://localhost/live" t3. ! nvvidconv ! nvoverlaysink liveadder name=mix ! queue ! audioconvert ! audioresample ! "audio/x-raw,rate=48000,format=S16LE,layout=interleaved,channels=2" ! alsasink device="hw:0,3" sync=false async=false a1. ! queue ! mix.sink_0 a2. ! queue ! mix.sink_1 t5. ! queue ! comp3.sink_0 t1. ! video/x-raw, width=1920, height=1080, framerate=60/1 ! videorate ! video/x-raw, width=1920, height=1080, framerate=10/1 ! queue ! nvvidconv ! queue ! "video/x-raw(memory:NVMM),width=1920, height=1080,format=NV12" ! queue ! comp3.sink_1 t2. ! queue ! h264parse ! queue ! nvv4l2decoder ! nvvidconv ! queue ! "video/x-raw(memory:NVMM),width=1920,height=1080,format=NV12" ! videorate ! "video/x-raw(memory:NVMM),width=1920,height=1080,format=NV12,framerate=${fpsp1}/1" ! nvvidconv ! queue ! "video/x-raw(memory:NVMM),width=426,height=240,format=NV12" ! queue ! comp3.sink_2 nvcompositor name=comp3 sink_0::width=1920 sink_0::height=1080 sink_1::xpos=0 sink_1::ypos=120 sink_1::width=1494 sink_1::height=840 sink_2::xpos=1494 sink_2::ypos=120 sink_2::width=426 sink_2::height=240 ! queue ! nvvidconv ! "video/x-raw(memory:NVMM),framerate=1/1,format=I420" ! queue ! nvjpegenc ! jpegparse ! multifilesink location=p1.jpg async=false liveadder name=mix4 ! queue ! audioconvert ! audioresample ! "audio/x-raw,rate=48000,channels=2,format=S16LE" ! alsasink device="hw:externAud,0" sync=false async=false a1. ! queue ! mix4.sink_0 a2. ! queue ! mix4.sink_1`

    // 50-50(presentation/rtsp)50/50 50/50(livestream=rtsp/rtsp2) 50/50(zoom=rtsp/rtsp2)

    let stval_50p1rt_rt1rt2_50 = `gst-launch-1.0 -e videotestsrc pattern=black ! video/x-raw,width=320,height=240 ! nvvidconv ! queue ! tee name=t5 ! queue ! comp1.sink_0 v4l2src device=/dev/presentation ! queue ! tee name=t1 ! video/x-raw, width=1920, height=1080, framerate=60/1 ! videorate ! video/x-raw, width=1920, height=1080, framerate=${fpsp1}/1 ! nvvidconv ! queue ! "video/x-raw(memory:NVMM),width=960,height=540,format=NV12" ! queue ! comp1.sink_1 rtspsrc location=${rtsplink} latency=0 ! application/x-rtp, media=video, encoding-name=H264 ! rtph264depay ! tee name=t2 ! queue ! h264parse ! queue ! nvv4l2decoder ! nvvidconv ! queue ! "video/x-raw(memory:NVMM),width=1920,height=1080,format=NV12" ! videorate ! "video/x-raw(memory:NVMM),width=1920,height=1080,format=NV12,framerate=${fpsp1}/1" ! nvvidconv ! queue ! "video/x-raw(memory:NVMM),width=960,height=540,format=NV12" ! queue ! comp1.sink_2 nvcompositor name=comp1 sink_0::width=1920 sink_0::height=1080 sink_1::xpos=0 sink_1::ypos=270 sink_1::width=960 sink_1::height=540 sink_2::xpos=960 sink_2::ypos=270 sink_2::width=960 sink_2::height=540 ! tee name=t4 ! queue ! nvvidconv ! queue ! nvv4l2h264enc maxperf-enable=1 bitrate=${bitrate} profile=4 ! queue ! h264parse ! queue ! mux. liveadder name=mix1 ! queue ! audioconvert ! voaacenc ! mux. alsasrc device="hw:externAud,0" ! queue ! audio/x-raw ! queue ! audioresample ! "audio/x-raw,rate=48000" ! tee name=a1 ! queue ! mix1.sink_0 alsasrc device="hw:channel1,0" ! queue ! audio/x-raw ! queue ! audioresample ! "audio/x-raw,rate=48000" ! tee name=a2 ! queue ! mix1.sink_1 mpegtsmux name=mux ! filesink location="/media/${hdduuid}/record-ts/${filename}.ts" videotestsrc pattern=black ! video/x-raw,width=320,height=240 ! nvvidconv ! queue ! comp.sink_0 t2. ! queue ! h264parse ! queue ! nvv4l2decoder ! nvvidconv ! queue ! "video/x-raw(memory:NVMM),width=960,height=540,format=NV12" ! queue ! comp.sink_1 rtspsrc location=${rtsplink2} latency=0 ! application/x-rtp, media=video, encoding-name=H264 ! rtph264depay ! queue ! h264parse ! queue ! nvv4l2decoder ! nvvidconv ! queue ! "video/x-raw(memory:NVMM),width=960,height=540,format=NV12" ! queue ! comp.sink_2 nvcompositor name=comp sink_0::width=1920 sink_0::height=1080 sink_1::xpos=0 sink_1::ypos=270 sink_1::width=960 sink_1::height=540 sink_2::xpos=960 sink_2::ypos=270 sink_2::width=960 sink_2::height=540 ! tee name=t3 ! queue ! nvvidconv ! queue ! nvv4l2h264enc maxperf-enable=1 bitrate=${bitrate} profile=4 ! queue ! h264parse ! queue ! mux3. liveadder name=mixer ! voaacenc ! queue ! mux3. a1. ! queue ! mixer.sink_0 a2. ! queue ! mixer.sink_1 flvmux name=mux3 ! rtmpsink location="rtmp://localhost/live" t3. ! nvvidconv ! nvoverlaysink liveadder name=mix ! queue ! audioconvert ! audioresample ! "audio/x-raw,rate=48000,format=S16LE,layout=interleaved,channels=2" ! alsasink device="hw:0,3" sync=false async=false a1. ! queue ! mix.sink_0 a2. ! queue ! mix.sink_1 t5. ! queue ! comp3.sink_0 t1. ! video/x-raw, width=1920, height=1080, framerate=60/1 ! videorate ! video/x-raw, width=1920, height=1080, framerate=10/1 ! queue ! nvvidconv ! queue ! "video/x-raw(memory:NVMM),width=1920, height=1080,format=NV12" ! queue ! comp3.sink_1 t2. ! queue ! h264parse ! queue ! nvv4l2decoder ! nvvidconv ! queue ! "video/x-raw(memory:NVMM),width=1920,height=1080,format=NV12" ! videorate ! "video/x-raw(memory:NVMM),width=1920,height=1080,format=NV12,framerate=${fpsp1}/1" ! nvvidconv ! queue ! "video/x-raw(memory:NVMM),width=960,height=540,format=NV12" ! queue ! comp3.sink_2 nvcompositor name=comp3 sink_0::width=1920 sink_0::height=1080 sink_1::xpos=0 sink_1::ypos=270 sink_1::width=960 sink_1::height=540 sink_2::xpos=960 sink_2::ypos=270 sink_2::width=960 sink_2::height=540 ! queue ! nvvidconv ! "video/x-raw(memory:NVMM),framerate=1/1,format=I420" ! queue ! nvjpegenc ! jpegparse ! multifilesink location=p1.jpg async=false liveadder name=mix4 ! queue ! audioconvert ! audioresample ! "audio/x-raw,rate=48000,channels=2,format=S16LE" ! alsasink device="hw:externAud,0" sync=false async=false a1. ! queue ! mix4.sink_0 a2. ! queue ! mix4.sink_1`

    // SBS pres/rtsp(sbs) pres/rtsp(sbs) pres/rtsp(sbs) top

    let stval_sbsp1rt_p1rt_SBS = `gst-launch-1.0 -e videotestsrc pattern=black ! video/x-raw,width=320,height=240 ! nvvidconv ! queue ! tee name=t5 ! queue ! comp1.sink_0 v4l2src device=/dev/presentation ! queue ! tee name=t1 ! video/x-raw, width=1920, height=1080, framerate=60/1 ! videorate ! video/x-raw, width=1920, height=1080, framerate=${fpsp1}/1 ! nvvidconv ! queue ! "video/x-raw(memory:NVMM),width=1494,height=840,format=NV12" ! queue ! comp1.sink_1 rtspsrc location=${rtsplink} latency=0 ! application/x-rtp, media=video, encoding-name=H264 ! rtph264depay ! tee name=t2 ! queue ! h264parse ! queue ! nvv4l2decoder ! nvvidconv ! queue ! "video/x-raw(memory:NVMM),width=1920,height=1080,format=NV12" ! videorate ! "video/x-raw(memory:NVMM),width=1920,height=1080,format=NV12,framerate=${fpsp1}/1" ! nvvidconv ! queue ! "video/x-raw(memory:NVMM),width=426,height=240,format=NV12" ! queue ! comp1.sink_2 nvcompositor name=comp1 sink_0::width=1920 sink_0::height=1080 sink_1::xpos=0 sink_1::ypos=120 sink_1::width=1494 sink_1::height=840 sink_2::xpos=1494 sink_2::ypos=120 sink_2::width=426 sink_2::height=240 ! tee name=t4 ! queue ! nvvidconv ! queue ! nvv4l2h264enc maxperf-enable=1 bitrate=${bitrate} profile=4 ! queue ! h264parse ! queue ! mux. liveadder name=mix1 ! queue ! audioconvert ! voaacenc ! mux. alsasrc device="hw:externAud,0" ! queue ! audio/x-raw ! queue ! audioresample ! "audio/x-raw,rate=48000" ! tee name=a1 ! queue ! mix1.sink_0 alsasrc device="hw:channel1,0" ! queue ! audio/x-raw ! queue ! audioresample ! "audio/x-raw,rate=48000" ! tee name=a2 ! queue ! mix1.sink_1 mpegtsmux name=mux ! filesink location="/media/${hdduuid}/record-ts/${filename}.ts" sync=false async=false t4. ! queue ! nvvidconv ! queue ! nvv4l2h264enc maxperf-enable=1 bitrate=${bitrate} profile=4 ! queue ! h264parse ! queue ! mux3. liveadder name=mixer ! voaacenc ! queue ! mux3. a1. ! queue ! mixer.sink_0 a2. ! queue ! mixer.sink_1 flvmux name=mux3 ! rtmpsink location="rtmp://localhost/live" sync=false async=false t4. ! nvvidconv ! nvoverlaysink liveadder name=mix ! queue ! audioconvert ! audioresample ! "audio/x-raw,rate=48000,format=S16LE,layout=interleaved,channels=2" ! alsasink device="hw:0,3" sync=false async=false a1. ! queue ! mix.sink_0 a2. ! queue ! mix.sink_1 t5. ! queue ! comp3.sink_0 t1. ! video/x-raw, width=1920, height=1080, framerate=60/1 ! videorate ! video/x-raw, width=1920, height=1080, framerate=10/1 ! queue ! nvvidconv ! queue ! "video/x-raw(memory:NVMM),width=1920, height=1080,format=NV12" ! queue ! comp3.sink_1 t2. ! queue ! h264parse ! queue ! nvv4l2decoder ! nvvidconv ! queue ! "video/x-raw(memory:NVMM),width=1920,height=1080,format=NV12" ! videorate ! "video/x-raw(memory:NVMM),width=1920,height=1080,format=NV12,framerate=30/1" ! nvvidconv ! queue ! "video/x-raw(memory:NVMM),width=426,height=240,format=NV12" ! queue ! comp3.sink_2 nvcompositor name=comp3 sink_0::width=1920 sink_0::height=1080 sink_1::xpos=0 sink_1::ypos=120 sink_1::width=1494 sink_1::height=840 sink_2::xpos=1494 sink_2::ypos=120 sink_2::width=426 sink_2::height=240 ! queue ! nvvidconv ! "video/x-raw(memory:NVMM),framerate=1/1,format=I420" ! queue ! nvjpegenc ! jpegparse ! multifilesink location=p1.jpg async=false liveadder name=mix4 ! queue ! audioconvert ! audioresample ! "audio/x-raw,rate=48000,channels=2,format=S16LE" ! alsasink device="hw:externAud,0" sync=false async=false a1. ! queue ! mix4.sink_0 a2. ! queue ! mix4.sink_1`

    //50-50(presentation/rtsp) 50-50(livestream=presentation/rtsp) 50-50(zoom=presentation/rtsp)

    let stval_50p1rt_p1rt_50 = `gst-launch-1.0 -e videotestsrc pattern=black ! video/x-raw,width=320,height=240 ! nvvidconv ! queue ! tee name=t5 ! queue ! comp1.sink_0 v4l2src device=/dev/presentation ! queue ! tee name=t1 ! video/x-raw, width=1920, height=1080, framerate=60/1 ! videorate ! video/x-raw, width=1920, height=1080, framerate=${fpsp1}/1 ! nvvidconv ! queue ! "video/x-raw(memory:NVMM),width=960,height=540,format=NV12" ! queue ! comp1.sink_1 rtspsrc location=${rtsplink} latency=0 ! application/x-rtp, media=video, encoding-name=H264 ! rtph264depay ! tee name=t2 ! queue ! h264parse ! queue ! nvv4l2decoder ! nvvidconv ! queue ! "video/x-raw(memory:NVMM),width=1920,height=1080,format=NV12" ! videorate ! "video/x-raw(memory:NVMM),width=1920,height=1080,format=NV12,framerate=${fpsp1}/1" ! nvvidconv ! queue ! "video/x-raw(memory:NVMM),width=960,height=540,format=NV12" ! queue ! comp1.sink_2 nvcompositor name=comp1 sink_0::width=1920 sink_0::height=1080 sink_1::xpos=0 sink_1::ypos=270 sink_1::width=960 sink_1::height=540 sink_2::xpos=960 sink_2::ypos=270 sink_2::width=960 sink_2::height=540 ! tee name=t4 ! queue ! nvvidconv ! queue ! nvv4l2h264enc maxperf-enable=1 bitrate=${bitrate} profile=4 ! queue ! h264parse ! queue ! mux. liveadder name=mix1 ! queue ! audioconvert ! voaacenc ! mux. alsasrc device="hw:externAud,0" ! queue ! audio/x-raw ! queue ! audioresample ! "audio/x-raw,rate=48000" ! tee name=a1 ! queue ! mix1.sink_0 alsasrc device="hw:channel1,0" ! queue ! audio/x-raw ! queue ! audioresample ! "audio/x-raw,rate=48000" ! tee name=a2 ! queue ! mix1.sink_1 mpegtsmux name=mux ! filesink location="/media/${hdduuid}/record-ts/${filename}.ts" sync=false async=false t4. ! queue ! nvvidconv ! queue ! nvv4l2h264enc maxperf-enable=1 bitrate=${bitrate} profile=4 ! queue ! h264parse ! queue ! mux3. liveadder name=mixer ! voaacenc ! queue ! mux3. a1. ! queue ! mixer.sink_0 a2. ! queue ! mixer.sink_1 flvmux name=mux3 ! rtmpsink location="rtmp://localhost/live" sync=false async=false t4. ! nvvidconv ! nvoverlaysink liveadder name=mix ! queue ! audioconvert ! audioresample ! "audio/x-raw,rate=48000,format=S16LE,layout=interleaved,channels=2" ! alsasink device="hw:0,3" sync=false async=false a1. ! queue ! mix.sink_0 a2. ! queue ! mix.sink_1 t5. ! queue ! comp3.sink_0 t1. ! video/x-raw, width=1920, height=1080, framerate=60/1 ! videorate ! video/x-raw, width=1920, height=1080, framerate=10/1 ! queue ! nvvidconv ! queue ! "video/x-raw(memory:NVMM),width=1920, height=1080,format=NV12" ! queue ! comp3.sink_1 t2. ! queue ! h264parse ! queue ! nvv4l2decoder ! nvvidconv ! queue ! "video/x-raw(memory:NVMM),width=1920,height=1080,format=NV12" ! videorate ! "video/x-raw(memory:NVMM),width=1920,height=1080,format=NV12,framerate=${fpsp1}/1" ! nvvidconv ! queue ! "video/x-raw(memory:NVMM),width=960,height=540,format=NV12" ! queue ! comp3.sink_2 nvcompositor name=comp3 sink_0::width=1920 sink_0::height=1080 sink_1::xpos=0 sink_1::ypos=270 sink_1::width=960 sink_1::height=540 sink_2::xpos=960 sink_2::ypos=270 sink_2::width=960 sink_2::height=540 ! queue ! nvvidconv ! "video/x-raw(memory:NVMM),framerate=1/1,format=I420" ! queue ! nvjpegenc ! jpegparse ! multifilesink location=p1.jpg async=false liveadder name=mix4 ! queue ! audioconvert ! audioresample ! "audio/x-raw,rate=48000,channels=2,format=S16LE" ! alsasink device="hw:externAud,0" sync=false async=false a1. ! queue ! mix4.sink_0 a2. ! queue ! mix4.sink_1`

    // SBS(livestream=rtsp/usb)   SBS(livestream=rtsp/usb) SBS(zoom=rtsp/usb) one

    let stval_sbsrtex_rtex_sbs = `gst-launch-1.0 -e videotestsrc pattern=black ! video/x-raw,width=320,height=240 ! nvvidconv ! queue ! tee name=t5 ! queue ! comp1.sink_0 rtspsrc location=${rtsplink} latency=0 ! application/x-rtp, media=video, encoding-name=H264 ! rtph264depay ! tee name=t2 ! queue ! h264parse ! queue ! nvv4l2decoder ! nvvidconv ! queue ! "video/x-raw(memory:NVMM),width=1920,height=1080,format=NV12" ! videorate ! "video/x-raw(memory:NVMM),width=1920,height=1080,format=NV12,framerate=${fpsp1}/1" ! nvvidconv ! queue ! "video/x-raw(memory:NVMM),width=960,height=540,format=NV12" ! queue ! comp1.sink_1 v4l2src device=/dev/exCAM io-mode=2 ! queue ! tee name=t8 ! image/jpeg,width=1920,height=1080,framerate=30/1 ! videorate ! image/jpeg,width=1920,height=1080,framerate=${fpsp2}/1 ! jpegparse ! nvv4l2decoder mjpeg=1 ! nvvidconv ! queue ! "video/x-raw(memory:NVMM),width=426,height=240,format=NV12" ! queue ! comp1.sink_2 nvcompositor name=comp1 sink_0::width=1920 sink_0::height=1080 sink_1::xpos=0 sink_1::ypos=270 sink_1::width=960 sink_1::height=540 sink_2::xpos=960 sink_2::ypos=270 sink_2::width=960 sink_2::height=540 ! tee name=t4 ! queue ! nvvidconv ! queue ! nvv4l2h264enc maxperf-enable=1 bitrate=${bitrate} profile=4 ! queue ! h264parse ! queue ! mux. liveadder name=mix1 ! queue ! audioconvert ! voaacenc ! mux. alsasrc device="hw:externAud,0" ! queue ! audio/x-raw ! queue ! audioresample ! "audio/x-raw,rate=48000" ! tee name=a1 ! queue ! mix1.sink_0 alsasrc device="hw:channel1,0" ! queue ! audio/x-raw ! queue ! audioresample ! "audio/x-raw,rate=48000" ! tee name=a2 ! queue ! mix1.sink_1 mpegtsmux name=mux ! filesink location="/media/${hdduuid}/record-ts/${filename}.ts" videotestsrc pattern=black ! video/x-raw,width=320,height=240 ! nvvidconv ! queue ! comp.sink_0 t2. ! queue ! h264parse ! queue ! nvv4l2decoder ! nvvidconv ! queue ! "video/x-raw(memory:NVMM),width=1494,height=840,format=NV12" ! queue ! comp.sink_1 t8. ! queue ! image/jpeg,width=1920,height=1080,framerate=30/1 ! videorate ! image/jpeg,width=1920,height=1080,framerate=${fpsp2}/1 ! jpegparse ! nvv4l2decoder mjpeg=1 ! nvvidconv ! queue ! "video/x-raw(memory:NVMM),width=426,height=240,format=NV12" ! queue ! comp.sink_2 nvcompositor name=comp sink_0::width=1920 sink_0::height=1080 sink_1::xpos=0 sink_1::ypos=120 sink_1::width=1494 sink_1::height=840 sink_2::xpos=1494 sink_2::ypos=120 sink_2::width=426 sink_2::height=240 ! tee name=t3 ! queue ! nvvidconv ! queue ! nvv4l2h264enc maxperf-enable=1 bitrate=${bitrate} profile=4 ! queue ! h264parse ! queue ! mux3. liveadder name=mixer ! voaacenc ! queue ! mux3. a1. ! queue ! mixer.sink_0 a2. ! queue ! mixer.sink_1 flvmux name=mux3 ! rtmpsink location="rtmp://localhost/live" t3. ! nvvidconv ! nvoverlaysink liveadder name=mix ! queue ! audioconvert ! audioresample ! "audio/x-raw,rate=48000,format=S16LE,layout=interleaved,channels=2" ! alsasink device="hw:0,3" sync=false async=false a1. ! queue ! mix.sink_0 a2. ! queue ! mix.sink_1 t5. ! queue ! comp3.sink_0 t2. ! queue ! h264parse ! queue ! nvv4l2decoder ! nvvidconv ! queue ! "video/x-raw(memory:NVMM),width=1494,height=840,format=NV12" ! queue ! comp3.sink_1 t8. ! queue ! image/jpeg,width=1920,height=1080,framerate=30/1 ! videorate ! image/jpeg,width=1920,height=1080,framerate=${fpsp2}/1 ! jpegparse ! nvv4l2decoder mjpeg=1 ! nvvidconv ! queue ! "video/x-raw(memory:NVMM),width=426,height=240,format=NV12" ! queue ! comp3.sink_2 nvcompositor name=comp3 sink_0::width=1920 sink_0::height=1080 sink_1::xpos=0 sink_1::ypos=120 sink_1::width=1494 sink_1::height=840 sink_2::xpos=1494 sink_2::ypos=120 sink_2::width=426 sink_2::height=240 ! queue ! nvvidconv ! "video/x-raw(memory:NVMM),framerate=1/1,format=I420" ! queue ! nvjpegenc ! jpegparse ! multifilesink location=p1.jpg async=false liveadder name=mix4 ! queue ! audioconvert ! audioresample ! "audio/x-raw,rate=48000,channels=2,format=S16LE" ! alsasink device="hw:externAud,0" sync=false async=false a1. ! queue ! mix4.sink_0 a2. ! queue ! mix4.sink_1`


    let exCAM = false;

    console.log("presenter: ", csp2);

    // Check if external cam is presenter
    if (csp2 != 'hdmisource' && csp2 != 'sdisource' && csp2 != 'rtsp' && csp2 != 'rtsp2') {
        console.log('external cam is presenter');
        exCAM = true;
    }

    // Pipeline Selection
    if (options.csOptions.rec_method == "Separate") {
        if (options.lmcOptions.layout == "PresentationPresenter" && options.lmcOptions.rec_method == "50-50") {
            if (options.lsOptions.layout == "PresentationPresenter" && options.lsOptions.rec_method == "50-50") {
                if (csp1 == "hdmisource" && csp2 == "rtsp" && lsp1 == "rtsp" && lmcp1 == "rtsp" && lsp2 == "rtsp2" && lmcp2 == "rtsp2") {
                    console.log('stval_p1rt1sp_rt1rt250_rt1rt250');
                    stringval = await pipes.stval_p1rt1sp_rt1rt250_rt1rt250(filename, fpsp1, fpsp2, bitrate, rtsplink, rtsplink2, hdduuid);
                }
                else if (csp1 == "hdmisource" && csp2 == "sdisource" && lsp1 == "sdisource" && lmcp1 == "sdisource") {
                    stringval = stval_sfp1p2_50_50_p2_ex_yuyv;
                    console.log("sfp1p2_50_50_p2_ex_yuyv");

                }
                else if (csp1 == "hdmisource" && (csp2 != "sdisource" || csp2 != "hdmisource") && lsp1 == "sdisource" && lmcp1 == "sdisource") {
                    stringval = stval_sfp1ex_50_50_p2_ex_mjpg;
                    console.log("sfp1ex_50_50_p2_ex_mjpg");

                }
                else if (csp1 == "sdisource" && (csp2 != "sdisource" || csp2 != "hdmisource") && lsp1 == "sdisource" && lmcp1 == "sdisource") {
                    stringval = stval_sfp2_50_50_p2_ex;
                    console.log("sfp2_50_50_p2_ex");

                } else if (csp1 == "hdmisource" && csp2 == "rtsp" && lsp1 == "hdmisource" && lmcp1 == "hdmisource") {
                    stringval = stval_sfp1rt_50_50_p1_rt;

                } else if (csp1 == "hdmisource" && (csp2 != "sdisource" && csp2 != "hdmisource" && csp2 != "rtsp") && lsp1 == "rtsp" && lmcp1 == "rtsp") {
                    stringval = stval_sfp1ex_50_50_rt_ex;
                } else if (csp1 == "hdmisource" && csp2 == 'rtsp' && lsp2 == "rtsp2" && lmcp2 == "rtsp2") { stringval = stval_sfp1rt_rt1rt2_rt1rt2_50 }
                else {
                    exCAM ? stringval = stval_sf_50_50_mjpg : stringval = stval_sf_50_50_yuyv;
                    console.log("sf_50_50");

                }
            }
            else if (options.lsOptions.layout == "PresentationPresenter" && options.lsOptions.rec_method == "Side") {
                if (csp1 == "hdmisource" && csp2 == "rtsp" && lsp1 == "rtsp" && lmcp1 == "rtsp" && lsp2 == "rtsp2" && lmcp2 == "rtsp2") {
                    console.log('stval_p1rt1sp_rt1rt250_rt1rt2sbs');
                    stringval = await pipes.stval_p1rt1sp_rt1rt250_rt1rt2sbs(filename, fpsp1, fpsp2, bitrate, rtsplink, rtsplink2, hdduuid);
                }
                // exCAM ? stringval = stval_sf_50_sbs_mjpg : stringval = stval_sf_50_sbs_yuyv;
            }
            else if (options.lsOptions.layout == "Presentation") {
                // exCAM ? stringval = stval_sf_50_p1_mjpg : stringval = stval_sf_50_p1_yuyv;
            }
            else if (options.lsOptions.layout == "Presenter") {
                if (csp1 == "hdmisource" && csp2 == "rtsp" && lmcp1 == "rtsp" && lsp2 == "rtsp" && lmcp2 == "rtsp2") {
                    console.log('stval_p1rt1sp_rt1rt250_rt1si');
                    stringval = await pipes.stval_p1rt1sp_rt1rt250_rt1si(filename, fpsp1, fpsp2, bitrate, rtsplink, rtsplink2, hdduuid);
                }
                else if (csp1 == "hdmisource" && csp2 == "rtsp" && lmcp1 == "rtsp" && lsp2 == "rtsp2" && lmcp2 == "rtsp2") {
                    console.log('stval_p1rt1sp_rt1rt250_rt2si');
                    stringval = await pipes.stval_p1rt1sp_rt1rt250_rt2si(filename, fpsp1, fpsp2, bitrate, rtsplink, rtsplink2, hdduuid);
                }
                // exCAM ? stringval = stval_sf_50_p1_mjpg : stringval = stval_sf_50_p1_yuyv;
            }
        }
        else if (options.lmcOptions.layout == "PresentationPresenter" && options.lmcOptions.rec_method == "Side") {
            if (options.lsOptions.layout == "PresentationPresenter" && options.lsOptions.rec_method == "50-50") {
                if (csp1 == "hdmisource" && csp2 == "rtsp" && lsp1 == "rtsp" && lmcp1 == "rtsp" && lsp2 == "rtsp2" && lmcp2 == "rtsp2") {
                    console.log('stval_p1rt1sp_rt1rt2sbs_rt1rt250');
                    stringval = await pipes.stval_p1rt1sp_rt1rt2sbs_rt1rt250(filename, fpsp1, fpsp2, bitrate, rtsplink, rtsplink2, hdduuid);
                }
                // exCAM ? stringval = stval_sf_sbs_50_mjpg : stringval = stval_sf_sbs_50_yuyv;
            }
            else if (options.lsOptions.layout == "PresentationPresenter" && options.lsOptions.rec_method == "Side") {

                if (csp1 == "hdmisource" && csp2 == "rtsp" && lsp1 == "rtsp" && lmcp1 == "rtsp" && lsp2 == "rtsp2" && lmcp2 == "rtsp2") {
                    console.log('stval_p1rt1sp_rt1rt2sbs_rt1rt2sbs');
                    stringval = await pipes.stval_p1rt1sp_rt1rt2sbs_rt1rt2sbs(filename, fpsp1, fpsp2, bitrate, rtsplink, rtsplink2, hdduuid);
                }
                else if (csp1 == "hdmisource" && csp2 == 'rtsp' && lsp1 == "rtsp" && lmcp1 == "rtsp") { stringval = stval_sfp1rt_sbsrtex_sbsrtex }

                else { exCAM ? stringval = stval_sf_sbs_sbs_240_mjpg : stringval = stval_sf_sbs_sbs_240_yuyv; }

            }
            else if (options.lsOptions.layout == "Presentation") {
                // exCAM ? stringval = stval_sf_sbs_p1_mjpg : stringval = stval_sf_sbs_p1_yuyv;
            }
            else if (options.lsOptions.layout == "Presenter") {
                if (csp1 == "hdmisource" && csp2 == "rtsp" && lmcp1 == "rtsp" && lsp2 == "rtsp" && lmcp2 == "rtsp2") {
                    console.log('stval_p1rt1sp_rt1rt2sbs_rt1si');
                    stringval = await pipes.stval_p1rt1sp_rt1rt2sbs_rt1si(filename, fpsp1, fpsp2, bitrate, rtsplink, rtsplink2, hdduuid);
                }
                else if (csp1 == "hdmisource" && csp2 == "rtsp" && lmcp1 == "rtsp" && lsp2 == "rtsp2" && lmcp2 == "rtsp2") {
                    console.log('stval_p1rt1sp_rt1rt2sbs_rt2si');
                    stringval = await pipes.stval_p1rt1sp_rt1rt2sbs_rt2si(filename, fpsp1, fpsp2, bitrate, rtsplink, rtsplink2, hdduuid);
                }
                // exCAM ? stringval = stval_sf_sbs_p2_mjpg : stringval = stval_sf_sbs_p2_yuyv;
            }
        }
        else if (options.lmcOptions.layout == "Presentation") {
            if (options.lsOptions.layout == "PresentationPresenter" && options.lsOptions.rec_method == "50-50") {
                // exCAM ? stringval = stval_sf_p1_50_mjpg : stringval = stval_sf_p1_50_yuyv;
            }
            else if (options.lsOptions.layout == "PresentationPresenter" && options.lsOptions.rec_method == "Side") {
                // exCAM ? stringval = stval_sf_p1_sbs_240_mjpg : stringval = stval_sf_p1_sbs_240_yuyv;
            }
            else if (options.lsOptions.layout == "Presentation") {
                exCAM ? stringval = stval_sf_p1_p1_mjpg : stringval = stval_sf_p1_p1_yuyv;
            }
            else if (options.lsOptions.layout == "Presenter") {
                // exCAM ? stringval = stval_sf_p1_p2_mjpg : stringval = stval_sf_p1_p2_yuyv;
            }
        }
        else if (options.lmcOptions.layout == "Presenter") {
            if (options.lsOptions.layout == "PresentationPresenter" && options.lsOptions.rec_method == "50-50") {
                if (csp1 == "hdmisource" && csp2 == "rtsp" && lsp1 == "rtsp" && lsp2 == "rtsp2" && lmcp2 == "rtsp") {
                    console.log('stval_p1rt1sp_rt1si_rt1rt250');
                    stringval = await pipes.stval_p1rt1sp_rt1si_rt1rt250(filename, fpsp1, fpsp2, bitrate, rtsplink, rtsplink2, hdduuid);
                }
                else if (csp1 == "hdmisource" && csp2 == "rtsp" && lsp1 == "rtsp" && lsp2 == "rtsp2" && lmcp2 == "rtsp2") {
                    console.log('stval_p1rt1sp_rt2si_rt1rt250');
                    stringval = await pipes.stval_p1rt1sp_rt2si_rt1rt250(filename, fpsp1, fpsp2, bitrate, rtsplink, rtsplink2, hdduuid);
                }
                // exCAM ? stringval = stval_sf_p2_50_mjpg : stringval = stval_sf_p2_50_yuyv;
            }
            else if (options.lsOptions.layout == "PresentationPresenter" && options.lsOptions.rec_method == "Side") {
                if (csp1 == "hdmisource" && csp2 == "rtsp" && lsp1 == "rtsp" && lsp2 == "rtsp2" && lmcp2 == "rtsp") {
                    console.log('stval_p1rt1sp_rt1si_rt1rt2sbs');
                    stringval = await pipes.stval_p1rt1sp_rt1si_rt1rt2sbs(filename, fpsp1, fpsp2, bitrate, rtsplink, rtsplink2, hdduuid);
                }
                else if (csp1 == "hdmisource" && csp2 == "rtsp" && lsp1 == "rtsp" && lsp2 == "rtsp2" && lmcp2 == "rtsp2") {
                    console.log('stval_p1rt1sp_rt2si_rt1rt2sbs');
                    stringval = await pipes.stval_p1rt1sp_rt2si_rt1rt2sbs(filename, fpsp1, fpsp2, bitrate, rtsplink, rtsplink2, hdduuid);
                }
                // exCAM ? stringval = stval_sf_p2_sbs_240_mjpg : stringval = stval_sf_p2_sbs_240_yuyv;
            }
            else if (options.lsOptions.layout == "Presentation") {
                // exCAM ? stringval = stval_sf_p2_p1_mjpg : stringval = stval_sf_p2_p1_yuyv;
            }
            else if (options.lsOptions.layout == "Presenter") {

                if (csp1 == "hdmisource" && csp2 == "rtsp" && lsp2 == "rtsp" && lmcp2 == "rtsp") {
                    console.log('stval_p1rt1sp_rt1si_rt1si');
                    stringval = await pipes.stval_p1rt1sp_rt1si_rt1si(filename, fpsp1, fpsp2, bitrate, rtsplink, rtsplink2, hdduuid);
                }
                else if (csp1 == "hdmisource" && csp2 == "rtsp" && lsp2 == "rtsp2" && lmcp2 == "rtsp") {
                    console.log('stval_p1rt1sp_rt1si_rt2si');
                    stringval = await pipes.stval_p1rt1sp_rt1si_rt2si(filename, fpsp1, fpsp2, bitrate, rtsplink, rtsplink2, hdduuid);
                }
                else if (csp1 == "hdmisource" && csp2 == "rtsp" && lsp2 == "rtsp" && lmcp2 == "rtsp2") {
                    console.log('stval_p1rt1sp_rt2si_rt1si');
                    stringval = await pipes.stval_p1rt1sp_rt2si_rt1si(filename, fpsp1, fpsp2, bitrate, rtsplink, rtsplink2, hdduuid);
                }
                else if (csp1 == "hdmisource" && csp2 == "rtsp" && lsp2 == "rtsp2" && lmcp2 == "rtsp2") {
                    console.log('stval_p1rt1sp_rt2si_rt2si');
                    stringval = await pipes.stval_p1rt1sp_rt2si_rt2si(filename, fpsp1, fpsp2, bitrate, rtsplink, rtsplink2, hdduuid);
                }
                else if (csp1 == "rtsp" && (csp2 != "sdisource" || csp2 != "hdmisource") && lsp2 == "rtsp" && lmcp2 == "rtsp") {

                    stringval = stval_sfexrt_rt_rt;
                }
                else { exCAM ? stringval = stval_sf_p2_p2_mjpg : stringval = stval_sf_p2_p2_yuyv; }
            }
        }
    }
    else if (options.csOptions.rec_method == "50-50") {
        console.log('50-50');

        if (options.lmcOptions.layout == "PresentationPresenter" && options.lmcOptions.rec_method == "50-50") {
            if (options.lsOptions.layout == "PresentationPresenter" && options.lsOptions.rec_method == "50-50") {
                if (csp1 == "hdmisource" && csp2 == "sdisource" && lsp1 == "sdisource" && lmcp1 == "sdisource") {
                    stringval = stval_50p1p2_50_50_p2_ex_yuyv;
                }
                else if (csp1 == "hdmisource" && (csp2 != "sdisource" || csp2 != "hdmisource") && lsp1 == "sdisource" && lmcp1 == "sdisource") {
                    stringval = stval_50p1ex_50_50_p2_ex_mjpg;
                }
                else if (csp1 == "hdmisource" && csp2 == "rtsp" && lsp2 == "rtsp" && lmcp2 == "rtsp") {
                    stringval = stval_50p1rt_p1rt_50;
                }
                else if (csp1 == "hdmisource" && csp2 == "rtsp" && lsp1 == "rtsp" && lmcp1 == "rtsp" && lsp2 == "rtsp2" && lmcp2 == "rtsp2") {
                    console.log('stval_50p1rt_rt1rt2_50');
                    stringval = stval_50p1rt_rt1rt2_50;


                }
                else {
                    exCAM ? stringval = stval_50_50_50_mjpg : stringval = stval_50_50_50_yuyv;
                    console.log("50_50_50_mjpg");
                }
            }
            else if (options.lsOptions.layout == "PresentationPresenter" && options.lsOptions.rec_method == "Side") {
                if (csp1 == "hdmisource" && csp2 == "rtsp" && lsp1 == "rtsp" && lmcp1 == "rtsp" && lsp2 == "rtsp2" && lmcp2 == "rtsp2") {
                    console.log('stval_p1rt150_rt1rt250_rt1rt2sbs');
                    stringval = await pipes.stval_p1rt150_rt1rt250_rt1rt2sbs(filename, fpsp1, fpsp2, bitrate, rtsplink, rtsplink2, hdduuid);
                }
                // exCAM ? stringval = stval_50_50_sbs_mjpg : stringval = stval_50_50_sbs_yuyv;
            }
            else if (options.lsOptions.layout == "Presentation") {
                // exCAM ? stringval = stval_50_50_p1_mjpg : stringval = stval_50_50_p1_yuyv;
            }
            else if (options.lsOptions.layout == "Presenter") {
                if (csp1 == "hdmisource" && csp2 == "rtsp" && lmcp1 == "rtsp" && lsp2 == "rtsp" && lmcp2 == "rtsp2") {
                    console.log('stval_p1rt150_rt1rt250_rt1si');
                    stringval = await pipes.stval_p1rt150_rt1rt250_rt1si(filename, fpsp1, fpsp2, bitrate, rtsplink, rtsplink2, hdduuid);

                }
                else if (csp1 == "hdmisource" && csp2 == "rtsp" && lmcp1 == "rtsp" && lsp2 == "rtsp2" && lmcp2 == "rtsp2") {
                    console.log('stval_p1rt150_rt1rt250_rt2si');
                    stringval = await pipes.stval_p1rt150_rt1rt250_rt2si(filename, fpsp1, fpsp2, bitrate, rtsplink, rtsplink2, hdduuid);

                }
                // exCAM ? stringval = stval_50_50_p1_mjpg : stringval = stval_50_50_p1_yuyv;
            }
        }
        else if (options.lmcOptions.layout == "PresentationPresenter" && options.lmcOptions.rec_method == "Side") {
            if (options.lsOptions.layout == "PresentationPresenter" && options.lsOptions.rec_method == "50-50") {
                if (csp1 == "hdmisource" && csp2 == "rtsp" && lsp1 == "rtsp" && lmcp1 == "rtsp" && lsp2 == "rtsp2" && lmcp2 == "rtsp2") {
                    console.log('stval_p1rt150_rt1rt2sbs_rt1rt250');
                    stringval = await pipes.stval_p1rt150_rt1rt2sbs_rt1rt250(filename, fpsp1, fpsp2, bitrate, rtsplink, rtsplink2, hdduuid);

                }
                // exCAM ? stringval = stval_50_sbs_50_mjpg : stringval = stval_50_sbs_50_yuyv;
            }
            else if (options.lsOptions.layout == "PresentationPresenter" && options.lsOptions.rec_method == "Side") {
                console.log('----------test');

                if (csp1 == "hdmisource" && csp2 == "rtsp" && (lsp2 != "sdisource" && lsp2 != "hdmisource" && lsp2 != "rtsp2" && lsp2 != "rtsp") && (lmcp2 != "sdisource" && lmcp2 != "hdmisource" && lmcp2 != "rtsp2" && lmcp2 != "rtsp")) {
                    console.log('test-----------');
                    stringval = stval_50p1rt_sbsrtex_sbsrtex;
                } else if (csp1 == "hdmisource" && csp2 == "rtsp" && lsp1 == "rtsp" && lmcp1 == "rtsp" && lsp2 == "rtsp2" && lmcp2 == "rtsp2") {
                    console.log('stval_p1rt150_rt1rt2sbs_rt1rt2sbs');
                    stringval = await pipes.stval_p1rt150_rt1rt2sbs_rt1rt2sbs(filename, fpsp1, fpsp2, bitrate, rtsplink, rtsplink2, hdduuid);

                } else {

                    exCAM ? stringval = stval_50_sbs_sbs_mjpg_240 : stringval = stval_50_sbs_sbs_yuyv_240;
                }
            }
            else if (options.lsOptions.layout == "Presentation") {
                // exCAM ? stringval = stval_50_sbs_p1_mjpg : stringval = stval_50_sbs_p1_yuyv;
            }
            else if (options.lsOptions.layout == "Presenter") {
                if (csp1 == "hdmisource" && csp2 == "rtsp" && lmcp1 == "rtsp" && lsp2 == "rtsp" && lmcp2 == "rtsp2") {
                    console.log('stval_p1rt150_rt1rt2sbs_rt1si');
                    stringval = await pipes.stval_p1rt150_rt1rt2sbs_rt1si(filename, fpsp1, fpsp2, bitrate, rtsplink, rtsplink2, hdduuid);

                }
                else if (csp1 == "hdmisource" && csp2 == "rtsp" && lmcp1 == "rtsp" && lsp2 == "rtsp2" && lmcp2 == "rtsp2") {
                    console.log('stval_p1rt150_rt1rt2sbs_rt2si');
                    stringval = await pipes.stval_p1rt150_rt1rt2sbs_rt2si(filename, fpsp1, fpsp2, bitrate, rtsplink, rtsplink2, hdduuid);

                }
                // exCAM ? stringval = stval_50_sbs_p2_mjpg : stringval = stval_50_sbs_p2_yuyv;
            }
        }
        else if (options.lmcOptions.layout == "Presentation") {
            if (options.lsOptions.layout == "PresentationPresenter" && options.lsOptions.rec_method == "50-50") {
                // exCAM ? stringval = stval_50_p1_50_mjpg : stringval = stval_50_p1_50_yuyv;
            }
            else if (options.lsOptions.layout == "PresentationPresenter" && options.lsOptions.rec_method == "Side") {
                // exCAM ? stringval = stval_50_p1_sbs_240_mjpg : stringval = stval_50_p1_sbs_240_yuyv;
            }
            else if (options.lsOptions.layout == "Presentation") {
                exCAM ? stringval = stval_50_p1_p1_mjpg : stringval = stval_50_p1_p1_yuyv;
            }
            else if (options.lsOptions.layout == "Presenter") {
                // exCAM ? stringval = stval_50_p1_p2_mjpg : stringval = stval_50_p1_p2_yuyv;
            }
        }
        else if (options.lmcOptions.layout == "Presenter") {
            if (options.lsOptions.layout == "PresentationPresenter" && options.lsOptions.rec_method == "50-50") {
                if (csp1 == "hdmisource" && csp2 == "rtsp" && lsp1 == "rtsp" && lsp2 == "rtsp2" && lmcp2 == "rtsp") {
                    console.log('stval_p1rt150_rt1si_rt1rt250');
                    stringval = await pipes.stval_p1rt150_rt1si_rt1rt250(filename, fpsp1, fpsp2, bitrate, rtsplink, rtsplink2, hdduuid);

                }
                else if (csp1 == "hdmisource" && csp2 == "rtsp" && lsp1 == "rtsp" && lsp2 == "rtsp2" && lmcp2 == "rtsp2") {
                    console.log('stval_p1rt150_rt2si_rt1rt250');
                    stringval = await pipes.stval_p1rt150_rt2si_rt1rt250(filename, fpsp1, fpsp2, bitrate, rtsplink, rtsplink2, hdduuid);

                }
                // exCAM ? stringval = stval_50_p2_50_mjpg : stringval = stval_50_p2_50_yuyv;
            }
            else if (options.lsOptions.layout == "PresentationPresenter" && options.lsOptions.rec_method == "Side") {
                if (csp1 == "hdmisource" && csp2 == "rtsp" && lsp1 == "rtsp" && lsp2 == "rtsp2" && lmcp2 == "rtsp") {
                    console.log('stval_p1rt150_rt1si_rt1rt2sbs');
                    stringval = await pipes.stval_p1rt150_rt1si_rt1rt2sbs(filename, fpsp1, fpsp2, bitrate, rtsplink, rtsplink2, hdduuid);

                }
                else if (csp1 == "hdmisource" && csp2 == "rtsp" && lsp1 == "rtsp" && lsp2 == "rtsp2" && lmcp2 == "rtsp2") {
                    console.log('stval_p1rt150_rt2si_rt1rt2sbs');
                    stringval = await pipes.stval_p1rt150_rt2si_rt1rt2sbs(filename, fpsp1, fpsp2, bitrate, rtsplink, rtsplink2, hdduuid);

                }
                // exCAM ? stringval = stval_50_p2_sbs_240_mjpg : stringval = stval_50_p2_sbs_240_yuyv;
            }
            else if (options.lsOptions.layout == "Presentation") {
                // exCAM ? stringval = stval_50_p2_p1_mjpg : stringval = stval_50_p2_p1_yuyv;
            }
            else if (options.lsOptions.layout == "Presenter") {
                if (csp1 == "hdmisource" && csp2 == "rtsp" && lsp2 == "rtsp" && lmcp2 == "rtsp") {
                    console.log('stval_p1rt150_rt1si_rt1si');
                    stringval = await pipes.stval_p1rt150_rt1si_rt1si(filename, fpsp1, fpsp2, bitrate, rtsplink, rtsplink2, hdduuid);

                }
                else if (csp1 == "hdmisource" && csp2 == "rtsp" && lsp2 == "rtsp2" && lmcp2 == "rtsp") {
                    console.log('stval_p1rt150_rt1si_rt2si');
                    stringval = await pipes.stval_p1rt150_rt1si_rt2si(filename, fpsp1, fpsp2, bitrate, rtsplink, rtsplink2, hdduuid);

                }
                else if (csp1 == "hdmisource" && csp2 == "rtsp" && lsp2 == "rtsp" && lmcp2 == "rtsp2") {
                    console.log('stval_p1rt150_rt2si_rt1si');
                    stringval = await pipes.stval_p1rt150_rt2si_rt1si(filename, fpsp1, fpsp2, bitrate, rtsplink, rtsplink2, hdduuid);

                }
                else if (csp1 == "hdmisource" && csp2 == "rtsp" && lsp2 == "rtsp2" && lmcp2 == "rtsp2") {
                    console.log('stval_p1rt150_rt2si_rt2si');
                    stringval = await pipes.stval_p1rt150_rt2si_rt2si(filename, fpsp1, fpsp2, bitrate, rtsplink, rtsplink2, hdduuid);

                }
                else {
                    exCAM ? stringval = stval_50_p2_p2_mjpg : stringval = stval_50_p2_p2_yuyv;
                }
            }
        }
    }
    else if (options.csOptions.rec_method == "Side") {
        if (options.lmcOptions.layout == "PresentationPresenter" && options.lmcOptions.rec_method == "50-50") {
            if (options.lsOptions.layout == "PresentationPresenter" && options.lsOptions.rec_method == "50-50") {
                if (csp1 == "hdmisource" && csp2 == "sdisource" && lsp1 == "sdisource" && lmcp1 == "sdisource") {
                    stringval = stval_sbsp1p2_50_50_p2_ex_yuyv;
                    console.log("sbsp1p2_50_50_p2_ex_yuyv");

                }
                else if (csp1 == "hdmisource" && (csp2 != "sdisource" || csp2 != "hdmisource") && lsp1 == "sdisource" && lmcp1 == "sdisource") {
                    stringval = stval_sbsp1ex_50_50_p2_ex_mjpg;
                    console.log("sbsp1ex_50_50_p2_ex_mjpg");

                } else if (csp1 == "rtsp" && csp2 == "rtsp2" && lsp1 == "rtsp" && lsp2 == "rtsp2" && lmcp1 == "rtsp" && lmcp2 == "rtsp2") {
                    console.log('stval_rt1rt2sbs_rt1rt250_rt1rt250');
                    stringval = await pipes.stval_rt1rt2sbs_rt1rt250_rt1rt250(filename, fpsp1, fpsp2, bitrate, rtsplink, rtsplink2, hdduuid);

                }
                else {
                    exCAM ? stringval = stval_sbs_50_50_240_mjpg : stringval = stval_sbs_50_50_240_yuyv;
                    console.log("_sbs_50_50");

                }
            }
            else if (options.lsOptions.layout == "PresentationPresenter" && options.lsOptions.rec_method == "Side") {
                if (csp1 == "rtsp" && csp2 == "rtsp2" && lsp1 == "rtsp" && lsp2 == "rtsp2" && lmcp1 == "rtsp" && lmcp2 == "rtsp2") {
                    console.log('stval_rt1rt2sbs_rt1rt250_rt1rt2sbs');
                    stringval = await pipes.stval_rt1rt2sbs_rt1rt250_rt1rt2sbs(filename, fpsp1, fpsp2, bitrate, rtsplink, rtsplink2, hdduuid);

                }
                // exCAM ? stringval = stval_sbs_50_sbs_mjpg : stringval = stval_sbs_50_sbs_yuyv;
            }
            else if (options.lsOptions.layout == "Presentation") {
                // exCAM ? stringval = stval_sbs_50_p1_mjpg : stringval = stval_sbs_50_p1_yuyv;
            }
            else if (options.lsOptions.layout == "Presenter") {
                if (csp1 == "rtsp" && csp2 == "rtsp2" && lsp2 == "rtsp" && lmcp1 == "rtsp" && lmcp2 == "rtsp2") {
                    console.log('stval_rt1rt2sbs_rt1rt250_rt1si');
                    stringval = await pipes.stval_rt1rt2sbs_rt1rt250_rt1si(filename, fpsp1, fpsp2, bitrate, rtsplink, rtsplink2, hdduuid);

                }
                else if (csp1 == "rtsp" && csp2 == "rtsp2" && lsp2 == "rtsp2" && lmcp1 == "rtsp" && lmcp2 == "rtsp2") {
                    console.log('stval_rt1rt2sbs_rt1rt250_rt2si');
                    stringval = await pipes.stval_rt1rt2sbs_rt1rt250_rt2si(filename, fpsp1, fpsp2, bitrate, rtsplink, rtsplink2, hdduuid);

                }
                // exCAM ? stringval = stval_sbs_50_p1_mjpg : stringval = stval_sbs_50_p1_yuyv;
            }
        }
        else if (options.lmcOptions.layout == "PresentationPresenter" && options.lmcOptions.rec_method == "Side") {
            if (options.lsOptions.layout == "PresentationPresenter" && options.lsOptions.rec_method == "50-50") {
                if (csp1 == "rtsp" && csp2 == "rtsp2" && lsp1 == "rtsp" && lsp2 == "rtsp2" && lmcp1 == "rtsp" && lmcp2 == "rtsp2") {
                    console.log('stval_rt1rt2sbs_rt1rt2sbs_rt1rt250');
                    stringval = await pipes.stval_rt1rt2sbs_rt1rt2sbs_rt1rt250(filename, fpsp1, fpsp2, bitrate, rtsplink, rtsplink2, hdduuid);

                }
                // exCAM ? stringval = stval_sbs_sbs_50_mjpg : stringval = stval_sbs_sbs_50_yuyv;
            }
            else if (options.lsOptions.layout == "PresentationPresenter" && options.lsOptions.rec_method == "Side") {
                console.log('------------------anydevice-----', csp1);

                if (csp1 == "hdmisource" && csp2 == "rtsp" && lsp2 == "rtsp" && lmcp2 == "rtsp") {
                    stringval = stval_sbsp1rt_p1rt_SBS;
                } else if (csp1 == "hdmisource" && csp2 == "rtsp" && lsp2 == "rtsp2" && lmcp2 == "rtsp2") {
                    stringval = stval_sbsp1rt_rt1rt2_sbs;
                } else if (csp1 == "rtsp" && csp2 == "any device id" && lsp1 == "rtsp" && lmcp1 == "rtsp") {
                    stringval = stval_sbsrtex_rtex_sbs;
                } else if (csp1 == "rtsp" && csp2 == "rtsp2" && lsp1 == "rtsp" && lsp2 == "rtsp2" && lmcp1 == "rtsp" && lmcp2 == "rtsp2") {
                    console.log('stval_rt1rt2sbs_rt1rt2sbs_rt1rt2sbs');
                    stringval = await pipes.stval_rt1rt2sbs_rt1rt2sbs_rt1rt2sbs(filename, fpsp1, fpsp2, bitrate, rtsplink, rtsplink2, hdduuid);

                } else {
                    exCAM ? stringval = stval_sbs_sbs_240_mjpg : stringval = stval_sbs_sbs_240_yuyv;
                }
            }
            else if (options.lsOptions.layout == "Presentation") {
                // exCAM ? stringval = stval_sbs_sbs_p1_mjpg : stringval = stval_sbs_sbs_p1_yuyv;
            }
            else if (options.lsOptions.layout == "Presenter") {
                if (csp1 == "rtsp" && csp2 == "rtsp2" && lsp2 == "rtsp" && lmcp1 == "rtsp" && lmcp2 == "rtsp2") {
                    console.log('stval_rt1rt2sbs_rt1rt2sbs_rt1si');
                    stringval = await pipes.stval_rt1rt2sbs_rt1rt2sbs_rt1si(filename, fpsp1, fpsp2, bitrate, rtsplink, rtsplink2, hdduuid);

                }
                else if (csp1 == "rtsp" && csp2 == "rtsp2" && lsp2 == "rtsp2" && lmcp1 == "rtsp" && lmcp2 == "rtsp2") {
                    console.log('stval_rt1rt2sbs_rt1rt2sbs_rt2si');
                    stringval = await pipes.stval_rt1rt2sbs_rt1rt2sbs_rt2si(filename, fpsp1, fpsp2, bitrate, rtsplink, rtsplink2, hdduuid);

                }
                // exCAM ? stringval = stval_sbs_sbs_p2_mjpg : stringval = stval_sbs_sbs_p2_yuyv;
            }
        }
        else if (options.lmcOptions.layout == "Presentation") {
            if (options.lsOptions.layout == "PresentationPresenter" && options.lsOptions.rec_method == "50-50") {
                // exCAM ? stringval = stval_sbs_p1_50_mjpg : stringval = stval_sbs_p1_50_yuyv;
            }
            else if (options.lsOptions.layout == "PresentationPresenter" && options.lsOptions.rec_method == "Side") {
                // exCAM ? stringval = stval_sbs_p1_sbs_240_mjpg : stringval = stval_sbs_p1_sbs_240_yuyv;
            }
            else if (options.lsOptions.layout == "Presentation") {
                exCAM ? stringval = stval_sbs_p1_p1_mjpg_240 : stringval = stval_sbs_p1_p1_yuyv_240;
            }
            else if (options.lsOptions.layout == "Presenter") {
                // exCAM ? stringval = stval_sbs_p1_p2_mjpg : stringval = stval_sbs_p1_p2_yuyv;
            }
        }
        else if (options.lmcOptions.layout == "Presenter") {
            if (options.lsOptions.layout == "PresentationPresenter" && options.lsOptions.rec_method == "50-50") {
                if (csp1 == "rtsp" && csp2 == "rtsp2" && lsp1 == "rtsp" && lsp2 == "rtsp2" && lmcp2 == "rtsp") {
                    console.log('stval_rt1rt2sbs_rt1si_rt1rt250');
                    stringval = await pipes.stval_rt1rt2sbs_rt1si_rt1rt250(filename, fpsp1, fpsp2, bitrate, rtsplink, rtsplink2, hdduuid);

                } else if (csp1 == "rtsp" && csp2 == "rtsp2" && lsp1 == "rtsp" && lsp2 == "rtsp2" && lmcp2 == "rtsp2") {
                    console.log('stval_rt1rt2sbs_rt2si_rt1rt250');
                    stringval = await pipes.stval_rt1rt2sbs_rt2si_rt1rt250(filename, fpsp1, fpsp2, bitrate, rtsplink, rtsplink2, hdduuid);

                }
                // exCAM ? stringval = stval_sbs_p2_50_mjpg : stringval = stval_sbs_p2_50_yuyv;
            }
            else if (options.lsOptions.layout == "PresentationPresenter" && options.lsOptions.rec_method == "Side") {
                if (csp1 == "rtsp" && csp2 == "rtsp2" && lsp1 == "rtsp" && lsp2 == "rtsp2" && lmcp2 == "rtsp") {
                    console.log('stval_rt1rt2sbs_rt1si_rt1rt2sbs');
                    stringval = await pipes.stval_rt1rt2sbs_rt1si_rt1rt2sbs(filename, fpsp1, fpsp2, bitrate, rtsplink, rtsplink2, hdduuid);

                }
                else if (csp1 == "rtsp" && csp2 == "rtsp2" && lsp1 == "rtsp" && lsp2 == "rtsp2" && lmcp2 == "rtsp2") {
                    console.log('stval_rt1rt2sbs_rt2si_rt1rt2sbs');
                    stringval = await pipes.stval_rt1rt2sbs_rt2si_rt1rt2sbs(filename, fpsp1, fpsp2, bitrate, rtsplink, rtsplink2, hdduuid);

                }
                // exCAM ? stringval = stval_sbs_p2_sbs_240_mjpg : stringval = stval_sbs_p2_sbs_240_yuyv;
            }
            else if (options.lsOptions.layout == "Presentation") {
                // exCAM ? stringval = stval_sbs_p2_p1_mjpg : stringval = stval_sbs_p2_p1_yuyv;
            }
            else if (options.lsOptions.layout == "Presenter") {
                if (csp1 == "hdmisource" && csp2 == 'rtsp' && lsp2 == "rtsp" && lmcp2 == "rtsp") {
                    if (options.lmcOptions.s_pip_pos == 'Top' && options.lmcOptions.s_pip_pos == 'Top' && options.lmcOptions.s_pip_pos == 'Top') {
                        stringval = stval_sbsp1rt_rt_rt_top
                    }
                    if (options.lmcOptions.s_pip_pos == 'Middle' && options.lmcOptions.s_pip_pos == 'Middle' && options.lmcOptions.s_pip_pos == 'Middle') {
                        stringval = stval_sbsp1rt_rt_rt_mid
                    }
                    if (options.lmcOptions.s_pip_pos == 'Bottom' && options.lmcOptions.s_pip_pos == 'Bottom' && options.lmcOptions.s_pip_pos == 'Bottom') {
                        stringval = stval_sbsp1rt_rt_rt_bot
                    }
                }
                else if (csp1 == "rtsp" && csp2 == 'hdmisource' && lsp2 == "rtsp" && lmcp2 == "rtsp") {
                    if (options.lmcOptions.s_pip_pos == 'Top' && options.lmcOptions.s_pip_pos == 'Top' && options.lmcOptions.s_pip_pos == 'Top') {
                        stringval = stval_sbsrtp1_rt_rt_top
                    }
                    if (options.lmcOptions.s_pip_pos == 'Middle' && options.lmcOptions.s_pip_pos == 'Middle' && options.lmcOptions.s_pip_pos == 'Middle') {
                        stringval = stval_sbsrtp1_rt_rt_mid
                    }
                    if (options.lmcOptions.s_pip_pos == 'Bottom' && options.lmcOptions.s_pip_pos == 'Bottom' && options.lmcOptions.s_pip_pos == 'Bottom') {
                        stringval = stval_sbsrtp1_rt_rt_bot
                    }
                }
                else if (csp1 == "rtsp" && csp2 == "rtsp2" && lsp2 == "rtsp" && lmcp2 == "rtsp") {
                    console.log('stval_rt1rt2sbs_rt1si_rt1si');
                    stringval = await pipes.stval_rt1rt2sbs_rt1si_rt1si(filename, fpsp1, fpsp2, bitrate, rtsplink, rtsplink2, hdduuid);

                }
                else if (csp1 == "rtsp" && csp2 == "rtsp2" && lsp2 == "rtsp2" && lmcp2 == "rtsp") {
                    console.log('stval_rt1rt2sbs_rt1si_rt2si');
                    stringval = await pipes.stval_rt1rt2sbs_rt1si_rt2si(filename, fpsp1, fpsp2, bitrate, rtsplink, rtsplink2, hdduuid);

                }
                else if (csp1 == "rtsp" && csp2 == "rtsp2" && lsp2 == "rtsp" && lmcp2 == "rtsp2") {
                    console.log('stval_rt1rt2sbs_rt2si_rt1si');
                    stringval = await pipes.stval_rt1rt2sbs_rt2si_rt1si(filename, fpsp1, fpsp2, bitrate, rtsplink, rtsplink2, hdduuid);

                }
                else if (csp1 == "rtsp" && csp2 == "rtsp2" && lsp2 == "rtsp2" && lmcp2 == "rtsp2") {
                    console.log('stval_rt1rt2sbs_rt2si_rt2si');
                    stringval = await pipes.stval_rt1rt2sbs_rt2si_rt2si(filename, fpsp1, fpsp2, bitrate, rtsplink, rtsplink2, hdduuid);

                }
                else {
                    exCAM ? stringval = stval_sbs_p2_p2_mjpg_240 : stringval = stval_sbs_p2_p2_yuyv_240;
                }
            }
        }
    }
    else if (options.csOptions.rec_method == "Single") {
        if (options.lmcOptions.layout == "PresentationPresenter" && options.lmcOptions.rec_method == "50-50") {
            if (options.lsOptions.layout == "PresentationPresenter" && options.lsOptions.rec_method == "50-50") {
                // exCAM ? stringval = stval_sbs_50_50_240_mjpg : stringval = stval_sbs_50_50_240_yuyv;
                if (csp1 == "hdmisource" && csp2 == 'rtsp' && lsp1 == "hdmisource" && lsp2 == "rtsp" && lmcp1 == "hdmisource" && lmcp2 == "rtsp") {
                    stringval = stval_50p1rt_rt_rt
                } else if (csp2 == "rtsp" && lsp1 == "rtsp" && lsp2 == "rtsp2" && lmcp1 == "rtsp" && lmcp2 == "rtsp2") {
                    console.log('stval_rt1si_rt1rt250_rt1rt250');
                    stringval = await pipes.stval_rt1si_rt1rt250_rt1rt250(filename, fpsp1, fpsp2, bitrate, rtsplink, rtsplink2, hdduuid);

                }
            }
            else if (options.lsOptions.layout == "PresentationPresenter" && options.lsOptions.rec_method == "Side") {
                if (csp2 == "rtsp" && lsp1 == "rtsp" && lsp2 == "rtsp2" && lmcp1 == "rtsp" && lmcp2 == "rtsp2") {
                    console.log('stval_rt1si_rt1rt250_rt1rt2sbs');
                    stringval = await pipes.stval_rt1si_rt1rt250_rt1rt2sbs(filename, fpsp1, fpsp2, bitrate, rtsplink, rtsplink2, hdduuid);

                }
                // exCAM ? stringval = stval_sbs_50_sbs_mjpg : stringval = stval_sbs_50_sbs_yuyv;

            }
            else if (options.lsOptions.layout == "Presentation") {
                // exCAM ? stringval = stval_sbs_50_p1_mjpg : stringval = stval_sbs_50_p1_yuyv;
            }
            else if (options.lsOptions.layout == "Presenter") {
                if (csp2 == "rtsp" && lsp2 == "rtsp" && lmcp1 == "rtsp" && lmcp2 == "rtsp2") {
                    console.log('stval_rt1si_rt1rt250_rt1si');
                    stringval = await pipes.stval_rt1si_rt1rt250_rt1si(filename, fpsp1, fpsp2, bitrate, rtsplink, rtsplink2, hdduuid);

                }
                else if (csp2 == "rtsp" && lsp2 == "rtsp2" && lmcp1 == "rtsp" && lmcp2 == "rtsp2") {
                    console.log('stval_rt1si_rt1rt250_rt2si');
                    stringval = await pipes.stval_rt1si_rt1rt250_rt2si(filename, fpsp1, fpsp2, bitrate, rtsplink, rtsplink2, hdduuid);

                }
                // exCAM ? stringval = stval_sbs_50_p1_mjpg : stringval = stval_sbs_50_p1_yuyv;
            }
        }
        else if (options.lmcOptions.layout == "PresentationPresenter" && options.lmcOptions.rec_method == "Side") {
            if (options.lsOptions.layout == "PresentationPresenter" && options.lsOptions.rec_method == "50-50") {
                // exCAM ? stringval = stval_sbs_sbs_50_mjpg : stringval = stval_sbs_sbs_50_yuyv;
                if (csp2 == "rtsp" && lsp1 == "rtsp" && lsp2 == "rtsp2" && lmcp1 == "rtsp" && lmcp2 == "rtsp2") {
                    console.log('stval_rt1si_rt1rt2sbs_rt1rt250');
                    stringval = await pipes.stval_rt1si_rt1rt2sbs_rt1rt250(filename, fpsp1, fpsp2, bitrate, rtsplink, rtsplink2, hdduuid);

                }
            }
            else if (options.lsOptions.layout == "PresentationPresenter" && options.lsOptions.rec_method == "Side") {
                // exCAM ? stringval = stval_sbs_sbs_240_mjpg : stringval = stval_sbs_sbs_240_yuyv;
                if (csp2 == 'rtsp' && lsp2 == 'any device id' && lsp1 == 'rtsp' && lmcp1 == 'rtsp' && lmcp2 == 'any device id') {
                    stringval = stval_sirt_rtusb_rtusb_sbs
                } else if (csp2 == "rtsp" && lsp1 == "rtsp" && lsp2 == "rtsp2" && lmcp1 == "rtsp" && lmcp2 == "rtsp2") {
                    console.log('stval_rt1si_rt1rt2sbs_rt1rt2sbs');
                    stringval = await pipes.stval_rt1si_rt1rt2sbs_rt1rt2sbs(filename, fpsp1, fpsp2, bitrate, rtsplink, rtsplink2, hdduuid);

                }
            }
            else if (options.lsOptions.layout == "Presentation") {
                // exCAM ? stringval = stval_sbs_sbs_p1_mjpg : stringval = stval_sbs_sbs_p1_yuyv;
            }
            else if (options.lsOptions.layout == "Presenter") {
                if (csp2 == "rtsp" && lsp2 == "rtsp" && lmcp1 == "rtsp" && lmcp2 == "rtsp2") {
                    console.log('stval_rt1si_rt1rt2sbs_rt1si');
                    stringval = await pipes.stval_rt1si_rt1rt2sbs_rt1si(filename, fpsp1, fpsp2, bitrate, rtsplink, rtsplink2, hdduuid);

                } else if (csp2 == "rtsp" && lsp2 == "rtsp2" && lmcp1 == "rtsp" && lmcp2 == "rtsp2") {
                    console.log('stval_rt1si_rt1rt2sbs_rt2si');
                    stringval = await pipes.stval_rt1si_rt1rt2sbs_rt2si(filename, fpsp1, fpsp2, bitrate, rtsplink, rtsplink2, hdduuid);

                }
                // exCAM ? stringval = stval_sbs_sbs_p2_mjpg : stringval = stval_sbs_sbs_p2_yuyv;
            }
        }
        else if (options.lmcOptions.layout == "Presentation") {
            if (options.lsOptions.layout == "PresentationPresenter" && options.lsOptions.rec_method == "50-50") {
                // exCAM ? stringval = stval_sbs_p1_50_mjpg : stringval = stval_sbs_p1_50_yuyv;
            }
            else if (options.lsOptions.layout == "PresentationPresenter" && options.lsOptions.rec_method == "Side") {
                // exCAM ? stringval = stval_sbs_p1_sbs_240_mjpg : stringval = stval_sbs_p1_sbs_240_yuyv;
            }
            else if (options.lsOptions.layout == "Presentation") {
                exCAM ? stringval = stval_si_p1_p1_mjpg : stringval = stval_si_p1_p1_yuyv;
            }
            else if (options.lsOptions.layout == "Presenter") {
                // exCAM ? stringval = stval_sbs_p1_p2_mjpg : stringval = stval_sbs_p1_p2_yuyv;
            }
        }
        else if (options.lmcOptions.layout == "Presenter") {
            if (options.lsOptions.layout == "PresentationPresenter" && options.lsOptions.rec_method == "50-50") {
                if (csp2 == "rtsp" && lsp1 == "rtsp" && lsp2 == "rtsp2" && lmcp2 == "rtsp") {
                    console.log('stval_rt1si_rt1si_rt1rt250');
                    stringval = await pipes.stval_rt1si_rt1si_rt1rt250(filename, fpsp1, fpsp2, bitrate, rtsplink, rtsplink2, hdduuid);

                } else if (csp2 == "rtsp" && lsp1 == "rtsp" && lsp2 == "rtsp2" && lmcp2 == "rtsp2") {
                    console.log('stval_rt1si_rt2si_rt1rt250');
                    stringval = await pipes.stval_rt1si_rt2si_rt1rt250(filename, fpsp1, fpsp2, bitrate, rtsplink, rtsplink2, hdduuid);

                }
                // exCAM ? stringval = stval_sbs_p2_50_mjpg : stringval = stval_sbs_p2_50_yuyv;
            }
            else if (options.lsOptions.layout == "PresentationPresenter" && options.lsOptions.rec_method == "Side") {
                if (csp2 == "rtsp" && lsp1 == "rtsp" && lsp2 == "rtsp2" && lmcp2 == "rtsp") {
                    console.log('stval_rt1si_rt1si_rt1rt2sbs');
                    stringval = await pipes.stval_rt1si_rt1si_rt1rt2sbs(filename, fpsp1, fpsp2, bitrate, rtsplink, rtsplink2, hdduuid);

                } else if (csp2 == "rtsp" && lsp1 == "rtsp" && lsp2 == "rtsp2" && lmcp2 == "rtsp2") {
                    console.log('stval_rt1si_rt2si_rt1rt2sbs');
                    stringval = await pipes.stval_rt1si_rt2si_rt1rt2sbs(filename, fpsp1, fpsp2, bitrate, rtsplink, rtsplink2, hdduuid);

                }
                // exCAM ? stringval = stval_sbs_p2_sbs_240_mjpg : stringval = stval_sbs_p2_sbs_240_yuyv;
            }
            else if (options.lsOptions.layout == "Presentation") {
                // exCAM ? stringval = stval_sbs_p2_p1_mjpg : stringval = stval_sbs_p2_p1_yuyv;
            }
            else if (options.lsOptions.layout == "Presenter") {
                if (csp2 == "rtsp" && lsp2 == "rtsp2" && lmcp2 == "rtsp") {
                    console.log('stval_rt1si_rt1si_rt2si');
                    stringval = await pipes.stval_rt1si_rt1si_rt2si(filename, fpsp1, fpsp2, bitrate, rtsplink, rtsplink2, hdduuid);

                } else if (csp2 == "rtsp" && lsp2 == "rtsp" && lmcp2 == "rtsp2") {
                    console.log('stval_rt1si_rt2si_rt1si');
                    stringval = await pipes.stval_rt1si_rt2si_rt1si(filename, fpsp1, fpsp2, bitrate, rtsplink, rtsplink2, hdduuid);

                } else if (csp2 == "rtsp" && lsp2 == "rtsp2" && lmcp2 == "rtsp2") {
                    console.log('stval_rt1si_rt2si_rt2si');
                    stringval = await pipes.stval_rt1si_rt2si_rt2si(filename, fpsp1, fpsp2, bitrate, rtsplink, rtsplink2, hdduuid);

                } else if (csp2 == 'rtsp' && lsp2 == 'rtsp' && lmcp2 == 'rtsp') {
                    stringval = stval_sirt_rt_rt;
                } else {
                    exCAM ? stringval = stval_si_p2_p2_mjpg : stringval = stval_si_p2_p2_yuyv;
                }
            }
        }
    }

    console.log('running code: ', stringval);

    codeexec(stringval, function (results) {
        console.log(results);
        if (results) {
            codeexec('python /root/src/UMS4/LC/bashfiles/recblink.py', (results) => {
                console.log('blink start', results);
            })
            let query = `INSERT INTO record_status (record, status, userid,module,lecture_hall,topic,duration,time,pauseval) VALUES(1, true, ${userid},'${options.module}','${options.lecture_hall}','${options.topic}','${options.maxdu}','${updated_at}',${options.pauseval}) ON DUPLICATE KEY UPDATE status=true, userid=${userid}, module='${options.module}', lecture_hall='${options.lecture_hall}',topic='${options.topic}',duration='${options.maxdu}',time='${updated_at}',pauseval=${options.pauseval}`
            sql.query(query, (err, res) => {
                if (err) {
                    console.log("error on update status of record: ", err);
                    return;
                }
                console.log("update status of record: ", res);
            });
            res.status(200).json({
                message: "Successfull",
                success: true
            });
            setInterval(() => {
                let query = `SELECT * FROM settings WHERE userid = 1 AND submenu='lss'`;
                sql.query(query, (err, res) => {
                    if (err) {
                        console.log("error: ", err);
                        return;
                    }
                    console.log("code run every 500000ms: ", res);
                });
            }, 500000);
        } else {
            console.log("error running code");
            res.status(409).json({
                message: "Error",
                success: false
            });
        }
    })
};

// get record started time 
function query_promise_rectime() {
    return new Promise((resolve, reject) => {
        sql.query('SELECT time FROM record_status WHERE record = 1', async (err, res) => {
            if (err) {
                console.log("error on update status of record: ", err);
                return reject(err);
            }
            console.log("data: ", res);
            resolve(res[0].time);
        });
    });
}

// Record stop function
export const ShellStop = async (req, res) => {
    let options = req.body;

    let audOnlyPipe = ``

    let userid = options.userid;

    // record started time (in case server restart/off at middle of recording)
    let updated_at_db = await query_promise_rectime()

    let filename = `${options.module}~${options.topic}~${options.lecture_hall}~${userid}~${updated_at == undefined ? updated_at_db : updated_at}`;
    filename = filename.replace(/:/g, '-');

    var stringval = `sudo killall -SIGINT gst-launch-1.0`;

    // calculate record time
    var duration = moment().diff(updated_at_now, 'minutes')
    console.log('--------duration', duration);

    // create groupid if pauseval 0
    if (options.pauseval === 0) {
        groupid = crypto.randomBytes(10).toString('hex');
        groupid2 = crypto.randomBytes(10).toString('hex');
    }

    codeexec(stringval, function (results) {
        if (results) {
            if (Object.keys(req.body).length != 0) {
                let query = `INSERT INTO record_status (record, status, userid,module,lecture_hall,topic,duration,pauseval) VALUES(1, false, ${userid},'${options.module}','${options.lecture_hall}','${options.topic}','${options.maxdu}',${options.pauseval}) ON DUPLICATE KEY UPDATE status=false, userid=${userid}, module='${options.module}', lecture_hall='${options.lecture_hall}',topic='${options.topic}',duration='${options.maxdu}',pauseval=${options.pauseval}`
                sql.query(query, (err, res) => {
                    if (err) {
                        console.log("error on update status of record: ", err);
                        return;
                    }
                    console.log("update status of record: ", res);
                });
                let vidquery;
                if (options.csOptions.rec_method == "Separate") {
                    vidquery = `INSERT INTO video_queue (filename,status,duration,groupid,pauseval) VALUES('${filename}~1.ts','waiting','${duration}','${groupid}',${options.pauseval}),('${filename}~2.ts','waiting','${duration}','${groupid2}',${options.pauseval})`
                } else {
                    vidquery = `INSERT INTO video_queue (filename,status,duration,groupid,pauseval) VALUES('${filename}.ts','waiting','${duration}','${groupid}',${options.pauseval})`
                }

                sql.query(vidquery, (err, res) => {
                    if (err) {
                        console.log("error on inserting data to video queue: ", err);
                        return;
                    }
                    console.log("inserted data to video queue: ", res);
                });
            }

            codeexec('sudo pkill -f /root/src/UMS4/LC/bashfiles/recblink.py', (results) => {
                console.log('1. recblink killed', results);
                codeexec('python /root/src/UMS4/LC/bashfiles/clear.py', (results) => {
                    console.log('2. blink clear', results);
                    codeexec('sudo pkill -f /root/src/UMS4/LC/bashfiles/clear.py', (results) => {
                        console.log('3. blink clear killed', results);
                        // setTimeout(() => {
                        // uploadvideo().then(() => {
                        codeexec(audOnlyPipe, (results) => {
                            console.log('Audio Only Pipe Running', results);
                            // setTimeout(() => {
                            // uploadvideo().then(() => {
                            return res.status(200).json({
                                message: "Successfull",
                                success: true
                                // });
                            })
                            // }, 5000);

                        })
                        // }, 5000);

                    })
                })
            })

        } else {
            return res.status(409).json({
                message: "Error",
                success: false
            });
        }
    })

};


// ==============STREAM============

export const ShellStartStream = async (req, res) => {
    console.log(req.body);
    var rtmpvals = req.body;

    NginxConfFile.create(filenamenginx, function (err, conf) {
        if (err || !conf) {
            console.log(err);
            return;
        }

        // reading values
        console.log('user: ' + conf.nginx.user[0]._value);
        // console.log('http.server.listen: ' + conf.nginx.http[0].server[0].listen[0]._value);

        conf.nginx.rtmp[0].server[0]._remove('application');
        conf.nginx.rtmp[0].server[0]._add('application', 'live');
        conf.nginx.rtmp[0].server[0].application[0]._add('live', 'on');
        conf.nginx.rtmp[0].server[0].application[0]._add('record', 'off');
        rtmpvals.forEach(rtmpval => {
            console.log("val b", rtmpval);

            if (rtmpval.substring(0, 2) == "FB") { rtmpval = 'rtmp://127.0.0.1:1936/rtmp/' + rtmpval }
            console.log("val a", rtmpval);
            conf.nginx.rtmp[0].server[0].application[0]._add('push', rtmpval);
        });
        console.log(conf.nginx.rtmp[0].server[0].application[0]._value);
        //writing values
        //NginxConfFile.create() automatically sets up a sync, so that whenever
        //a value is changed, or a node is removed/added, the file gets updated
        //immediately

        const onFlushed = () => {
            console.log('finished writing to disk');
            codeexec('sudo systemctl restart nginx', (results) => {
                console.log('nginx restarted', results);
                codeexec('sudo systemctl restart stunnel4.service', (results) => {
                    console.log('stunnel4 restarted', results);
                })
            })
            res.status(200).json({
                message: "Successfull",
                success: true
            });
        };

        conf.on('flushed', onFlushed);

        conf.flush();
    });


};



export const ShellStopStream = async (req, res) => {
    console.log('----stream------');

    NginxConfFile.create(filenamenginx, function (err, conf) {
        if (err || !conf) {
            console.log(err);
            return;
        }

        // reading values
        console.log('user: ' + conf.nginx.user[0]._value);
        // console.log('http.server.listen: ' + conf.nginx.http[0].server[0].listen[0]._value);

        conf.nginx.rtmp[0].server[0]._remove('application');
        conf.nginx.rtmp[0].server[0]._add('application', 'live');
        conf.nginx.rtmp[0].server[0].application[0]._add('live', 'on');
        conf.nginx.rtmp[0].server[0].application[0]._add('record', 'off');

        //writing values
        //NginxConfFile.create() automatically sets up a sync, so that whenever
        //a value is changed, or a node is removed/added, the file gets updated
        //immediately

        const onFlushed = () => {
            console.log('finished writing to disk');
            codeexec('sudo systemctl restart nginx', (results) => {
                console.log('nginx restarted', results);
            })

            res.status(200).json({
                message: "Successfull",
                success: true
            });
        };

        conf.on('flushed', onFlushed);

        conf.flush();
    });
}






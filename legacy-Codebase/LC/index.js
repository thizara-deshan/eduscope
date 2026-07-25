import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const https = require('https');
const usbDetect = require('usb-detection');
const drivelist = require('drivelist');
const exec = require('child_process').exec
const execs = require('child_process').execSync
import express from 'express';
import bodyParser from 'body-parser';
import cors from 'cors';
import passport from 'passport'
import cron from 'node-cron'
import moment from "moment"
import fusSettings from './models/fusSettings.js';
import videoQueue from './models/videoQueue.js';
import axios from 'axios'
import sql from "./models/db.js"
import InstituteUser from './models/institute-users.js';
import bcrypt from 'bcrypt'
const shellExec = require('shell-exec')
const fs = require('fs');
const FormData = require('form-data');

// Import busboy
const busboy = require('connect-busboy');

//Import routes
import adminRoutes from './routes/adminRoutes.js';
import settingsRoutes from './routes/settingsRoutes.js';
import captureSetupRoutes from './routes/captureSetupRoutes.js';
import lmcRoutes from './routes/lmcRoutes.js';
import fmRoutes from './routes/fmRoutes.js';
import lsRoutes from './routes/lsRoutes.js';
import sdRoutes from './routes/sdRoutes.js';

//initiate express
const app = express();
var http = require('http').Server(app);
const io = require('socket.io')(http);

// Insert the busboy middle-ware
app.use(busboy({
    highWaterMark: 2 * 1024 * 1024, // Set 2MiB buffer
}));

app.use(bodyParser.json({ limit: '30mb', extended: true }))
app.use(bodyParser.urlencoded({ limit: '30mb', extended: true }))
app.use(cors());
app.use(passport.initialize());

app.use(function (req, res, next) {
    res.header("Access-Control-Allow-Origin", "*");
    res.header("Access-Control-Allow-Headers", "Origin, X-Requested-With, Content-Type, Accept");
    next();
});

//import and initiate passport
import middlepassport from './middleware/passport.js';
import { getFileList } from './controllers/fm_ctrl.js';

middlepassport(passport);

//Routes
app.use('/api/admin', adminRoutes);
app.use('/api/settings', settingsRoutes);
app.use('/api/caps', captureSetupRoutes);
app.use('/api/lmc', lmcRoutes);
app.use('/api/fm', fmRoutes);
app.use('/api/ls', lsRoutes);
app.use('/api/sd', sdRoutes);

//assign port
const PORT = process.env.PORT || 5000;

// function to execute linux codes on terminal
var codeexec = function (code, callback) {
    var results = false
    try {
        shellExec(code).then((res) => {
            console.log(res);
            results = true;
            callback(results)
        }).catch((err) => {
            console.log(err);
            callback(results)
        })

    } catch (error) {
        results = false;
        console.log("on catch block------", error);
        callback(results);
    }
}

var codeexecStorage = function (code, callback) {
    return new Promise((resolve, reject) => {
        var results = true
        try {
            exec(code, (err, stdout, stderr) => {
                if (err !== null) {
                    console.log(`exec error: ${err}`);
                    results = false;
                    return reject(results)
                } else {
                    results = stdout;
                    callback(results)
                    resolve(results)
                }
            })

        } catch (error) {
            results = false;
            console.log("on catch block------", error);
            return reject(error);
        }
    });

}


var codeexecConvert = function (code, callback) {
    var results = true
    try {
        execs(code, (err, stdout, stderr) => {
            if (err !== null) {
                console.log(`exec error: ${err}`);
                results = false;
                return results
            } else {
                results = stdout;
                callback(results)
            }
        })

    } catch (error) {
        results = false;
        console.log("on catch block------", error);
        return results
    }
}

// query to get hard disk id
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

//start server
http.listen(PORT, () => {
    console.log(`Server Running on Port: http://localhost:${PORT}`)

    // Detect Ez-Cap connected or else restart usb connections
    let stringval = `v4l2-ctl --list-devices`;
    let devicearr = [];
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

        if (!devicearr.includes("Eduscope UMS ")) {
            console.log('Eduscope UMS not Detected');
            setTimeout(() => {
                codeexec('sudo uhubctl -l 2-1 -p 2 -a cycle -d 5 -R', (results) => {
                    if (results) {
                        console.log('USB Devices Reconnected');
                    } else {
                        console.log('ERROR While USB Devices Reconnecting');
                    }
                })
            }, 20000);
        }
    }).catch((err) => {
        console.log(err);
    })
})

// Serve the image file from the server
var start = false;
io.on('connection', function (socket) {

    socket.on('startrec', (data) => {
        start = data
        setInterval(() => {
            filereadFunc(start)
        }, 3000);
    })

    const filereadFunc = async (start) => {
        if (start) {
            fs.readFile('./p1.jpg', function (err, buf) {
                if (err) {
                    console.log(err);
                }
                // it's possible to embed binary data
                // within arbitrarily-complex objects
                buf && socket.emit('image1', { image: true, buffer: buf.toString('base64') });
            })
            fs.readFile('./p2.jpg', function (err, buf) {
                if (err) {
                    console.log(err);
                }
                // it's possible to embed binary data
                // within arbitrarily-complex objects
                buf && socket.emit('image2', { image: true, buffer: buf.toString('base64') });
            })
        }
    }
});

// serve privew images to frontend
let priv = false
io.on('connection', function (socket) {
    socket.on('startpriv', (data) => {
        priv = data
        setInterval(() => {
            filereadFunc(priv)
        }, 800);
    })

    const filereadFunc = (priv) => {
        if (priv) {
            fs.readFile('./presentation.jpg', function (err, buf) {
                if (err) {
                    console.log(err);
                }
                // it's possible to embed binary data
                // within arbitrarily-complex objects
                buf && socket.emit('presentation', { image: true, buffer: buf.toString('base64') });
            })
            fs.readFile('./presenter.jpg', function (err, buf) {
                if (err) {
                    console.log(err);
                }
                // it's possible to embed binary data
                // within arbitrarily-complex objects
                buf && socket.emit('presenter', { image: true, buffer: buf.toString('base64') });
            })
        }
    }
});


let usbrunning = false;

io.on('connection', function (socket) {

    socket.on("disconnect", () => {
        console.log("Client disconnected");
    });

    // Detect USB on insertion
    socket.on('usbdetection', async (data) => {
        console.log(data);
        let usbList = [];
        let usbNameList = [];

        usbDetect.startMonitoring();

        const getusbstorage = () => {
            console.log('device list', usbList);
            console.log('getting usb storage data');

            if (!usbrunning) {
                usbrunning = true;
                setInterval(async () => {
                    let stringval = `df --output=size,avail,pcent '${usbList[0]}' | tail -n +2`;
                    if (usbList.length > 0) {
                        codeexecStorage(stringval, function (results) {
                            if (results) {
                                io.emit('storagedata', { result: results, name: usbNameList[0] });
                            } else {
                                console.log('error while getting storage data');
                            }
                        })
                    }
                }, 5000);
            }
        }

        // Detect insert
        usbDetect.on('add', () => {
            console.log('usb detected');

            // const poll = setInterval(() => {
            drivelist.list().then((drives) => {
                console.log(drives);

                drives.forEach((drive) => {
                    if (drive.isUSB && ((process.env.SDCARD == 'true') || (drive.device != '/dev/sda')) && ((process.env.SDCARD == 'false') || drive.devicePath != process.env.SDCARD)) {
                        console.log('inside sd---------');
                        console.log(drive.mountpoints);

                        const mountPath = drive.mountpoints[0].path;
                        const name = drive.description;
                        if (!usbList.includes(mountPath)) {
                            console.log(mountPath); //op
                            usbList.push(mountPath);
                            usbNameList.push(name);
                            getusbstorage()
                        }
                    }
                })
            })
            // }, 2000)
        });

        const getDeviceList = async (_callback) => {
            drivelist.list().then((drives) => {
                console.log(drives);

                drives.forEach((drive) => {
                    if (drive.isUSB && ((process.env.SDCARD == 'true') || (drive.device != '/dev/sda')) && ((process.env.SDCARD == 'false') || drive.devicePath != process.env.SDCARD)) {
                        console.log(drive.mountpoints[0]);
                        const mountPath = drive.mountpoints[0].path;
                        const name = drive.description;
                        if (!usbList.includes(mountPath)) {
                            console.log(mountPath); //op
                            usbList.push(mountPath);
                            usbNameList.push(name);
                            // return true;
                            console.log('calling callback');

                            _callback
                        }
                    } else {
                        return false;
                    }
                })
            })
        }
        getDeviceList(getusbstorage);



        // Detect remove
        usbDetect.on('remove', () => {
            let newUsbList = []
            let removalList = []
            let newUsbNameList = []
            let removalNameList = []
            drivelist.list().then((drives) => {
                drives.forEach((drive) => {
                    if (drive.isUSB && ((process.env.SDCARD == 'true') || (drive.device != '/dev/sda')) && ((process.env.SDCARD == 'false') || drive.devicePath != process.env.SDCARD)) {
                        newUsbList.push(drive.device);
                        newUsbNameList.push(drive.description);
                    }
                })
                removalList = usbList.filter(x => !newUsbList.includes(x));
                usbList = usbList.filter(x => !removalList.includes(x))

                removalNameList = usbNameList.filter(x => !newUsbNameList.includes(x));
                usbNameList = usbNameList.filter(x => !removalNameList.includes(x))
                socket.emit('storagedata', { result: ' 0 0 0', name: 'No USB Device Found' });
                console.log('removalList: ', removalList) // op
                usbrunning = false;
            })
        });

        //usbDetect.stopMonitoring()
    })
});

// export socket io
app.set('socketio', io);


// Delete Files When Storage Hit 80% Cron
cron.schedule('0 * * * * *', async function () {
    let hdduuid = await query_promise()

    let stringval = `df --output=size,avail,pcent /media/${hdduuid} | tail -n +2`;
    let usage = 0;
    codeexecStorage(stringval, async function (results) {
        if (results) {
            let data = results.split(' ').filter(i => i);
            usage = Math.round(((parseInt(data[0]) - parseInt(data[1])) / parseInt(data[0])) * 100, 2)
            if (usage > 80) {
                let filelist = []
                filelist = await getFileList(`/media/${hdduuid}/record`);
                // console.log('file list', filelist);
                let deletelist = filelist.filter((delfile) => {
                    let nameArr = delfile.file.split('~');
                    let RecordDate = `${nameArr[4]}-${nameArr[5]}-${nameArr[6]} ${nameArr[7]}:${nameArr[8]} ${nameArr[10].substring(0, 2)}`;
                    // console.log(RecordDate);

                    let today = new Date()
                    let filedate = new Date(RecordDate)
                    let datediff = Math.floor((today.getTime() - filedate.getTime()) / (24 * 3600 * 1000));

                    // Delete when files older than 7 days
                    if (datediff > 7) {
                        return delfile

                    }
                })

                console.log('del files', deletelist.length);
                if (deletelist.length > 0) {
                    deletelist.map(file => {
                        videoQueue.updateByName(`${file.file.slice(0, -3)}ts`, `deleted(sys)`, (err, data) => {
                            if (err) {
                                console.log(err);
                            } else {
                                console.log('success changing video status to deleted');
                            }
                        })
                    });
                    let hdduuid = await query_promise()
                    codeexec(`rm ${deletelist.map(a => `/media/${hdduuid}/record/` + JSON.stringify(a.file)).join(' ')}`, (results) => {
                        console.log('Delete Result', results);
                        codeexec(`rm ${deletelist.map(a => `/media/${hdduuid}/record-ts/` + JSON.stringify(`${a.file.slice(0, -3)}ts`)).join(' ')}`, (results) => {
                            console.log('Delete Result', results);
                        })
                    })
                    // });
                }
            }
        } else {
            console.log('error while getting storage data');
        }
    })

})

// Get new institute userlist and update DB
cron.schedule('0 0 * * * *', function () {
    const agent = new https.Agent({
        rejectUnauthorized: false
    });
    if (process.env.UPLOAD_DOMAIN !== 'false') {
        axios.get(`https://${process.env.UPLOAD_DOMAIN}/external_service.php?key=bkgu6786GHBj68h&type=full_login_list`, { httpsAgent: agent }).then(async (list) => {
            const userarry = list.data.user;
            console.log('inside user list');

            for (let userdata of userarry) {
                let pass = await bcrypt.hash(userdata.password, 10)
                InstituteUser.create(userdata.id, userdata.username, pass, (err, data) => {
                    if (err) {
                        console.log(err);
                    }
                })
            }
        });
    }

})

// Sheduled uploads
let successUpload = false
let foo = false;

// Upload Cron
cron.schedule('0 * * * * *', function () {

    console.log(process.env.UPLOAD);

    if (!successUpload && process.env.UPLOAD == 'scheduled') {
        console.log('inside upload--------------------');

        dailyuploadcheck()
        videoQueue.getAll(null, async (err, data) => {
            if (err) {
                console.log(err);
            } else {
                let waitingFiles = data.filter(vid => vid.status == 'waiting' && vid.filename.substr(-4) != "2.ts")
                if (waitingFiles.length < 1 && !itemsProcessing && foo) {
                    console.log('Starting shutdown');

                    setTimeout(() => {
                        shutdownDevice()
                    }, 10000);
                }
            }
        })
    }
}, {
    scheduled: true,
    timezone: "Asia/Colombo"
});

const isTimeBetween = function (startTime, endTime, serverTime) {
    let start = moment(startTime, "H:mm")
    let end = moment(endTime, "H:mm")
    let server = moment(serverTime, "H:mm")
    console.log(startTime, endTime, serverTime);

    if (end < start) {
        return server >= start && server <= moment('23:59:59', "h:mm:ss") || server >= moment('0:00:00', "h:mm:ss") && server < end;
    }
    return server >= start && server < end
}

function getTime(dateTime) {
    return moment({ h: dateTime.hours(), m: dateTime.minutes() });
}
// uploadCron()

var itemsProcessing = false;
let isSliit = (process.env.UPLOAD_DOMAIN).split('.')[1] == 'sliit';

const dailyuploadcheck = async () => {
    // console.log('onprogresss', onprogresss);
    // onprogresss = true;
    // uploadCron.stop()
    let isBetween = false
    fusSettings.getAll('1', (err, data) => {
        if (err)
            console.log(err);
        else {
            // normal time
            let arr = data[2].s_value.split(',')

            // backup time
            let arr2 = data[3].s_value.split(',')
            let format = 'H:mm';
            var time = moment()

            // console.log(moment(moment.unix(arr[0]), format));

            if ((isTimeBetween(`${moment.unix(arr[0]).hours()}:${moment.unix(arr[0]).minutes()}`, `${moment.unix(arr[1]).hours()}:${moment.unix(arr[1]).minutes()}`, `${time.hours()}:${time.minutes()}`) || isTimeBetween(`${moment.unix(arr2[0]).hours()}:${moment.unix(arr2[0]).minutes()}`, `${moment.unix(arr2[1]).hours()}:${moment.unix(arr2[1]).minutes()}`, `${time.hours()}:${time.minutes()}`)) && data[1].s_value == '1') {
                console.log('server time is in between time range');
                isBetween = true;
            }

            console.log('is items processing', itemsProcessing);
            let config = {
                httpsAgent: agent,
                maxContentLength: Infinity,
                maxBodyLength: Infinity,
                maxRedirects: 0
            }

            if (isBetween && !itemsProcessing) {
                videoQueue.getAll(null, async (err, data) => {
                    if (err) {
                        console.log(err);
                    } else {
                        let failedFiles = data.filter(vid => vid.status == 'failed' && vid.filename.substr(-4) != "2.ts")

                        console.log('failed queue start------------------');

                        const failarr = await failedFiles.reduce(async (a, file, index) => {
                            await a;
                            const res = await axios.get(`https://${process.env.UPLOAD_DOMAIN}/external_service.php?key=bkgu6786GHBj68h&type=${isSliit ? 'delete_lecture' : 'delete_video'}&video_id=${file.videoid}&uid=1`, config)
                            console.log('-----------delete res-----------', res.data);
                            if (res.data == 'success') {
                                videoQueue.updateById(id, 'waiting', (err, data) => {
                                    if (err) {
                                        console.log(err);
                                    } else {
                                        console.log('delete success - changing video status to waiting');
                                    }
                                })
                            }
                        }, Promise.resolve());

                        console.log('failed queue end------------------');

                        let waitingFiles = data.filter(vid => vid.status == 'waiting' && vid.filename.substr(-4) != "2.ts")
                        console.log(waitingFiles);


                        const donearr = await waitingFiles.reduce(async (a, file, index) => {
                            console.log('second');

                            // Wait for the previous item to finish processing
                            await a;
                            if (index + 1 < waitingFiles.length) { itemsProcessing = true }
                            // Process this item
                            videoQueue.updateById(file.id, 'uploading', (err, data) => {
                                if (err) {
                                    console.log(err);
                                } else {
                                    console.log('success changing video status to uploading');
                                }
                            })
                            console.log('---------------------converted status', file.converted);

                            if (!file.converted) {
                                let hdduuid = await query_promise()
                                codeexecConvert(`ffmpeg -i '/media/${hdduuid}/record-ts/${file.filename}' -c copy -y '/media/${hdduuid}/record/${file.filename.slice(0, -2)}mp4'`, function (results) {
                                    console.log('conversion----------------------', results);
                                })
                                await videoQueue.updateConverted(file.filename, (err, data) => {
                                    if (err) {
                                        console.log(err);
                                    } else {
                                        console.log(data);
                                    }
                                })
                                if (file.filename.substr(-4) == '1.ts') {
                                    codeexecConvert(`ffmpeg -i '/media/${hdduuid}/record-ts/${file.filename.slice(0, -4)}2.ts' -c copy -y '/media/${hdduuid}/record/${file.filename.slice(0, -4)}2.mp4'`, function (results) {
                                        console.log('conversion----------------------', results);
                                    })
                                    await videoQueue.updateConverted(`${file.filename.slice(0, -4)}2.ts`, (err, data) => {
                                        if (err) {
                                            console.log(err);
                                        } else {
                                            console.log(data);
                                        }
                                    })
                                }
                                // });

                            }
                            console.log('conversion next done------------');
                            // let waitout = setTimeout(async () => {
                            //     console.log('uploadstart----------');
                            await uploadVids(file.filename, file.id)
                            //     return true;
                            // }, 2000);
                            // await waitout;
                            if (index + 1 == waitingFiles.length) { itemsProcessing = false }
                            foo = true;
                            return a;
                        }, Promise.resolve());
                    }
                })
            }

        }
    });
}

const shutdownDevice = () => {
    //    PowerOff()
}

const agent = new https.Agent({
    rejectUnauthorized: false
});



const uploadVids = async (filename, id) => {
    let config = {
        httpsAgent: agent,
        maxContentLength: Infinity,
        maxBodyLength: Infinity,
        maxRedirects: 0
    }

    try {

        let isDual = false;
        if (filename.substr(-4) == "1.ts") { isDual = true }
        // get module and topic
        let nameArr = filename.split('~');

        // get video id
        const videoid = await getVideoID(filename, nameArr[0], nameArr[1], nameArr[2], nameArr[3]);
        if (videoid) { console.log("video id", videoid.data); }
        videoQueue.updateVidId(id, videoid.data.video_id, (err, data) => {
            if (err) {
                console.log(err);
            } else {
                console.log('success updating video id');
            }
        })
        // upload file
        const upload = await fileupload(videoid.data.video_id, filename, id, nameArr[3]);
        if (upload) { console.log("file upload", upload.data); }

        let upload2
        if (isDual) {
            console.log("uploading 2nd vid");

            let newfilename = filename.substring(0, filename.length - 4) + "2.ts"
            console.log("2 video name", newfilename);

            upload2 = await fileupload(videoid.data.video_id, newfilename, id, nameArr[3]);
            if (upload2) { console.log("file upload 2", upload2.data); }
        }

        // complete upload
        if (isDual) {
            console.log("isDual true");

            if (upload.data.result == 'success' && upload2.data.result == 'success') {
                const status = await completeupload(videoid.data.video_id, id);
                console.log("upload complete status", status.data);
                videoQueue.updateById(id, 'done', (err, data) => {

                    if (err) {
                        console.log(err);
                    } else {
                        console.log('success changing video status to done');
                        // onprogresss = false;

                    }
                })
                id = id + 1;
                videoQueue.updateById(id, 'done', (err, data) => {
                    if (err) {
                        console.log(err);
                        return true

                    } else {
                        console.log('success changing video status to done 2');
                        // onprogresss = false;
                        return true

                    }
                })
            } else {
                console.log('Error while completing upload');
                const res = await axios.get(`https://${process.env.UPLOAD_DOMAIN}/external_service.php?key=bkgu6786GHBj68h&type=${isSliit ? 'delete_lecture' : 'delete_video'}&video_id=${videoid.data.video_id}&uid=${nameArr[3]}`, config)
                console.log('-----------delete res-----------', res.data);
                videoQueue.updateById(id, 'failed', (err, data) => {
                    if (err) {
                        console.log(err);
                    } else {
                        console.log('error while complete uploading - changing video status to waiting');
                    }
                })
                // onprogresss = false;
                return true

            }
        } else {
            console.log("isDual false");
            if (upload.data.result == 'success') {
                const status = await completeupload(videoid.data.video_id, id);
                console.log("upload complete status", status.data);
                videoQueue.updateById(id, 'done', (err, data) => {
                    if (err) {
                        console.log(err);
                        return true

                    } else {
                        console.log('success changing video status to done');
                        return true
                        // onprogresss = false;
                    }
                })

            } else {
                console.log('Error while completing upload');
                const res = await axios.get(`https://${process.env.UPLOAD_DOMAIN}/external_service.php?key=bkgu6786GHBj68h&type=${isSliit ? 'delete_lecture' : 'delete_video'}&video_id=${videoid.data.video_id}&uid=${nameArr[3]}`, config)
                console.log('-----------delete res-----------', res.data);
                videoQueue.updateById(id, 'failed', (err, data) => {
                    if (err) {
                        console.log(err);
                    } else {
                        console.log('error while complete uploading - changing video status to waiting');
                    }
                })
                // onprogresss = false;
                return true

            }
        }
    }
    catch (err) {
        console.log(err);
        return true;
    }
}


// Get Video ID
const getVideoID = (name, module, topic, lechall, uid) => {
    try {
        let url = `https://${process.env.UPLOAD_DOMAIN}/external_service.php?key=bkgu6786GHBj68h&type=add_video&uid=${uid}&module=${module}&topic=${topic}&${isSliit ? `lecture_hall=${lechall}` : `video_type=1&organization_id=34`}`;
        console.log("add video url", url);

        return axios.get(url, { httpsAgent: agent })
    } catch (error) {
        console.error(error)
    }
}

// File Upload
const fileupload = async (vidid, filename, id, uid) => {
    const formData = new FormData();
    // let hdduuid = `7DC22FF8624B9FD7`
    let hdduuid = await query_promise()

    let config = {
        httpsAgent: agent,
        headers: formData.getHeaders(),
        maxContentLength: Infinity,
        maxBodyLength: Infinity,
        maxRedirects: 0
    }

    try {
        console.log(filename);
        if (fs.existsSync(`/media/${hdduuid}/record/${filename.slice(0, -2)}mp4`)) {
            formData.append("video", fs.createReadStream(`/media/${hdduuid}/record/${filename.slice(0, -2)}mp4`, {
                highWaterMark: 10000
            }));
            const res = await axios.post(`https://${process.env.UPLOAD_DOMAIN}/external_service.php?key=bkgu6786GHBj68h&type=video_file_upload&video_id=${vidid}${isSliit ? '' : `&organization_id=34`}`, formData, config)
            return res;
        } else {
            videoQueue.updateById(id, 'nofile', (err, data) => {

                if (err) {
                    console.log(err);
                } else {
                    console.log('success changing video status to nofile');
                    // onprogresss = false;

                }
            })
            return { data: 'File doesnt exist' }
        }

    } catch (error) {
        console.error(error)
        const res = await axios.get(`https://${process.env.UPLOAD_DOMAIN}/external_service.php?key=bkgu6786GHBj68h&type=${isSliit ? 'delete_lecture' : 'delete_video'}&video_id=${vidid}&uid=${uid}`, config)
        console.log('-----------delete res-----------', res.data);
        videoQueue.updateById(id, 'failed', (err, data) => {
            if (err) {
                console.log(err);
            } else {
                console.log('error while uploading - changing video status to waiting');
            }
        })
    }
}

//   Complete Upload
const completeupload = (vidid, id) => {
    try {
        return axios.get(`https://${process.env.UPLOAD_DOMAIN}/external_service.php?key=bkgu6786GHBj68h&type=video_upload_complete&video_id=${vidid}`, { httpsAgent: agent })
    } catch (error) {
        console.error(error)
        videoQueue.updateById(id, 'waiting', (err, data) => {
            if (err) {
                console.log(err);
            } else {
                console.log('error while complete uploading - changing video status to waiting');
            }
        })
    }
}


// /p1.jpg
// ./bashfiles/img.jpg

// io.listen(8000, () => { console.log("connected socket"); });
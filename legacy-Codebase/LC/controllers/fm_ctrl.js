import { createRequire } from 'module';
const require = createRequire(import.meta.url);
import videoQueue from '../models/videoQueue.js';
import sql from "../models/db.js"

var request = require('request');
var Rsync = require('rsync');
var async = require('async');
const shellExec = require('shell-exec')
const drivelist = require('drivelist');

const axios = require('axios')
const execs = require('child_process').execSync
const exec = require('child_process').exec

const fs = require('fs');
const path = require("path");
const FormData = require('form-data');


// query function
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


var codeexec = function (code, callback) {
    console.log("code execute... ", code);
    var results = false
    try {
        shellExec(code).then((res) => {
            console.log(res);
            results = true;
            callback(results, res)
        }).catch((err) => {
            console.log(err);
            callback(results, { stderr: 'err' })
        })

    } catch (error) {
        results = false;
        console.log("on catch block------", error);
        callback(results, { stderr: 'err' });
    }
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
                console.log("execute success");
                results = stdout;
                callback(results)
            }
        })

    } catch (error) {
        results = false;
        console.log(error)
        console.log("on catch block------");
        return results
    }
}


var codeexecTest = function (code, callback) {
    var results = true
    try {
        exec(code, (err, stdout, stderr) => {
            if (err !== null) {
                console.log(`exec error: ${err}`);
                results = false;
            } else {
                console.log("execute success");
                results = stdout;
                callback(results)
            }
        })

    } catch (error) {
        results = false;
        console.log(error)
        console.log("on catch block------");
        callback(results)
    }
}

const getStatus = filename => {
    return new Promise((resolve, reject) => {
        videoQueue.findByName(filename, (err, data) => {
            if (err) {
                console.log(err);
                resolve('unknown')
            } else {
                console.log('data recevied-', data.status);
                resolve(data.status)
            }
        })
    })
}

export const getFileList = async (route) => {
    const files = fs.readdirSync(route);
    let response = [];

    const promises = files.map(async (file) => {
        const extension = path.extname(file);
        let status = 'unknown';
        if (extension == '.mp4' || extension == '.ts') {
            const absolutePath = path.resolve(route, file);

            await getStatus(`${file.slice(0, -3)}ts`).then((stat) => {
                console.log(status);
                status = stat
            })
            const fileSizeInBytes = fs.statSync(absolutePath).size;

            return { file, fileSizeInBytes, status };

        }
    });
    response = await Promise.all(promises)

    return response;
}



// Get Video ID
const getVideoID = (name, module, topic) => {
    try {
        let url = `https://s2.eduscopestream.com/external_service.php?key=nvdsv5876tHVGjv&type=add_video&uid=136&module=5&topic=${topic}&video_type=1&organization_id=34`;
        console.log("add video url", url);

        return axios.get(url)
    } catch (error) {
        console.error(error)
    }
}

let percentCompleted;

// File Upload
const fileupload = async (vidid, filename) => {
    try {
        console.log(filename);

        const formData = new FormData();
        let config = {
            headers: formData.getHeaders(),
            maxContentLength: Infinity,
            maxBodyLength: Infinity,
            //Listen for the onuploadprogress event
            onUploadProgress: function (progressEvent) {
                console.log("on progress");

                console.log(progressEvent);
                console.log(progressEvent.loaded);

                percentCompleted = Math.round((progressEvent.loaded * 100) / progressEvent.total);
                console.log("upload cmp", percentCompleted);

            }
        }

        let hdduuid = await query_promise()
        formData.append("video", fs.createReadStream(`/media/${hdduuid}/record/${filename}`));

        const res = await axios.post(`https://s2.eduscopestream.com/external_service.php?key=nvdsv5876tHVGjv&type=video_file_upload&video_id=${vidid}&organization_id=34`, formData, config)
        return res;
    } catch (error) {
        console.error(error)
    }
}

//   Complete Upload
const completeupload = (vidid) => {
    try {
        return axios.get(`https://s2.eduscopestream.com/external_service.php?key=nvdsv5876tHVGjv&type=video_upload_complete&video_id=${vidid}`)
    } catch (error) {
        console.error(error)
    }
}

// Upload process
export const uploadVideo = async (req, res) => {
    console.log("filename----", req.body);
    let isDual = false;
    if (req.body.filename.substr(-5) == "2.mp4" || req.body.filename.substr(-9) == "2~cmb.mp4") { isDual = true }
    // get module and topic
    let nameArr = req.body.filename.split('~');

    // get video id
    const videoid = await getVideoID(req.body.filename, nameArr[0], nameArr[1]);
    console.log("video id", videoid.data);

    // upload file
    const upload = await fileupload(videoid.data.video_id, req.body.filename);
    console.log("file upload", upload.data);
    console.log("upload cmp", percentCompleted);

    let upload2
    if (isDual) {
        console.log("uploading 2nd vid");
        let newfilename = '';
        if (req.body.filename.substr(-9) == "2~cmb.mp4") {
            newfilename = req.body.filename.substring(0, req.body.filename.length - 9) + "1~cmb.mp4"
        } else {
            newfilename = req.body.filename.substring(0, req.body.filename.length - 5) + "1.mp4"
        }
        console.log("2 video name", newfilename);

        upload2 = await fileupload(videoid.data.video_id, newfilename);
        console.log("file upload 2", upload2.data);
    }

    // complete upload
    if (isDual) {
        console.log("isDual true");

        if (upload.data.result == 'success' && upload2.data.result == 'success') {
            const status = await completeupload(videoid.data.video_id);
            console.log("upload complete status", status.data);
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
    } else {
        console.log("isDual false");
        if (upload.data.result == 'success') {
            const status = await completeupload(videoid.data.video_id);
            console.log("upload complete status", status.data);
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
    }
}


// Copy process
export const copyVideo = async (req, res) => {
    const io = req.app.get('socketio');

    console.log("filename----", req.body);
    let isDual = false;
    drivelist.list().then((drives) => {
        // console.log(drives);
        let fileArr = req.body.filename;
        req.body.filename.map((val) => {
            if (val.substr(-5) == "2.mp4") {
                fileArr.push(val.substring(0, val.length - 5) + "1.mp4")
            }
            if (val.substr(-9) == "2~cmb.mp4") {
                fileArr.push(val.substring(0, val.length - 9) + "1~cmb.mp4")
            }

        })

        // fileArr.push(val.substring(0, val.length - 5) + "2.mp4")
        drives.forEach(async (drive) => {
            if (drive.isUSB && drive.device != '/dev/sda' && ((process.env.SDCARD == 'false') || drive.devicePath != process.env.SDCARD)) {
                const mountPath = drive.mountpoints[0].path;
                // if (!usbList.includes(mountPath)) {
                console.log(mountPath);

                console.log(fileArr.map(a => JSON.stringify(a)).join());

                let tempEx = await codeexecTest(`mkdir -p ${mountPath}/eduscope-ums`, (results) => {

                    if (results) {
                        console.log(results);
                        return true;
                    } else {
                        console.log('failed---------');
                        return false
                    }
                    // }
                })

                console.log('ok-------', tempEx);
                let hdduuid = await query_promise()
                var rsync = Rsync.build({
                    source: `/media/${hdduuid}/record/`,
                    destination: `${mountPath}/eduscope-ums/`,
                    include: fileArr,
                    exclude: ['*'],
                    flags: 'avzuP'
                });

                // `{${fileArr.map(a => JSON.stringify(a)).join()}}`
                // var copying = setInterval(() => {
                //     res.write('copying')
                // }, 10000);
                rsync.execute(function (error, stdout, stderr) {
                    console.log('stderr: ', stderr);
                    console.log('stdout: ', stdout);
                    console.log('error: ', error);

                    if (error !== null) {
                        console.log('error:', error);
                        console.log('stderr:', stderr);
                        // clearInterval(copying)
                        res.status(409).json({
                            message: "Error",
                            success: false
                        });

                    } else {
                        console.log(stdout);
                        // clearInterval(copying)
                        res.status(200).json({
                            message: "Successfull",
                            success: true
                        });
                        io.emit('copysuccess', { copy: true })
                    }
                });
                // await codeexec(`rsync -avz --progress --update --include={${fileArr.map(a => JSON.stringify(a)).join()}} --exclude="*" '/media/7DC22FF8624B9FD7/record/' ${mountPath}/eduscope-ums/`, (results) => {
                //     console.log('Copy Result', results);
                //     // if (!isDual) {
                //     console.log('testing-----------------------');

                //     if (results) {
                //         res.status(200).json({
                //             message: "Successfull",
                //             success: true
                //         });
                //     } else {
                //         res.status(409).json({
                //             message: "Error",
                //             success: false
                //         });
                //     }
                //     // }
                // })
                // if (isDual) {
                //     let newfilename = req.body.filename.substring(0, req.body.filename.length - 5) + "1.mp4"
                //     codeexec(`rsync -avzR --progress --update '/media/7DC22FF8624B9FD7/./record/${newfilename}' ${mountPath}/`, (results) => {
                //         console.log('Copy Result', results);
                //         if (results) {
                //             res.status(200).json({
                //                 message: "Successfull",
                //                 success: true
                //             });
                //         } else {
                //             res.status(409).json({
                //                 message: "Error",
                //                 success: false
                //             });
                //         }
                //     })
                // }
                // }
            }
        })
    })
}

// Remove process
export const deleteVideo = async (req, res) => {
    const io = req.app.get('socketio');

    console.log("filename----", req.body);
    let isDual = false;
    let fileArr = req.body.filename;
    req.body.filename.map((val) => {
        if (val.substr(-5) == "2.mp4") {
            fileArr.push(val.substring(0, val.length - 5) + "1.mp4")
        }
        if (val.substr(-9) == "2~cmb.mp4") {
            fileArr.push(val.substring(0, val.length - 9) + "1~cmb.mp4")
        }
    })
    // await sql.query('select value from hdd_id where id=1', async (err, res) => {
    //     if (err) {
    //         console.log("error on update status of record: ", err);
    //         return null;
    //     }
    //     console.log("data: ", res[0].value.split('/').pop());
    // let hdduuid = `7DC22FF8624B9FD7`;
    let hdduuid = await query_promise();
    fileArr.map(file => {
        videoQueue.updateByName(`${file.slice(0, -3)}ts`, `deleted(${req.body.userid})`, (err, data) => {
            if (err) {
                console.log(err);
            } else {
                console.log('success changing video status to deleted');
            }
        })
    });


    await codeexec(`rm ${fileArr.map(a => `/media/${hdduuid}/record/` + JSON.stringify(a)).join(' ')}`, async (results, status) => {
        console.log('MP4 Delete', results);
        await codeexec(`rm ${fileArr.map(a => `/media/${hdduuid}/record-ts/` + JSON.stringify(`${a.slice(0, -3)}ts`)).join(' ')}`, (results, status) => {
            console.log('TS Delete', results);
        })
        console.log('testing-----------------------');

        if (results && status.stderr == '') {
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
        // }
    })
    // });
    // console.log('--------uuid------', hdduuid);
}

// export const stopCopyVideo = async (req, res) => {
//     codeexecTest(`killall rsync`, (results) => {
//         console.log('Copy Result', results);
//         if (results) {
//             res.status(200).json({
//                 message: "Successfull",
//                 success: true
//             });
//         } else {
//             res.status(409).json({
//                 message: "Error",
//                 success: false
//             });
//         }
//         // }
//     })
// }

export const LoadFiles = async (req, res) => {

    let hdduuid = await query_promise()
    getFileList(`/media/${hdduuid}/record`).then((list) => {

        console.log(list);
        if (list) {

            res.status(200).json({
                message: "Successfull",
                success: true,
                data: list
            });
        } else {
            res.status(409).json({
                message: "Error",
                success: false
            });
        }
    })

    // let listfiles = `find /media/7DC22FF8624B9FD7/record -regextype egrep -type f -iregex '.*\.(mp4)$' -printf "%f,"`
    // codeexec(listfiles, function (results) {
    //     console.log(results);
    //     if (results) {

    //         res.status(200).json({
    //             message: "Successfull",
    //             success: true,
    //             data: results
    //         });
    //     } else {
    //         res.status(409).json({
    //             message: "Error",
    //             success: false
    //         });
    //     }
    // })

};

const convertFiles = async () => {

    let promises = await new Promise((resolve, reject) => {
        videoQueue.getNonConverted((err, data) => {
            if (err) {
                console.log(err);
                resolve([])
            } else {
                console.log(data);

                resolve(data)
            }
        })
    })
    // let filelist = await Promise.all(promises)
    console.log(promises);
    return promises;

}

let itemsProcessing = false;

export const getNonConvertedTS = async (req, res) => {
    console.log(itemsProcessing);

    if (!itemsProcessing) {
        convertFiles().then(async (list) => {
            if (list.length > 0) {

                res.status(200).json({
                    message: "Successfull",
                    success: true,
                    data: list
                });
            } else {
                res.status(409).json({
                    message: "Error",
                    success: false
                });
            }
        })
    } else {
        res.status(200).json({
            message: "Successfull",
            success: true,
            data: []
        });
    }

};

export const startConvert = async (req, res) => {
    convertFiles().then(async (list) => {
        if (list.length > 0) {
            console.log('------------------------------------------------------------start', list);
            // await sql.query('select value from hdd_id where id=1', async (err, res) => {
            //     if (err) {
            //         console.log("error on update status of record: ", err);
            //         return null;
            //     }
            //     console.log("data: ", res[0].value.split('/').pop());
            // let hdduuid = `7DC22FF8624B9FD7`

            let vidgroups = {};

            await list.reduce(async (a, file) => {
                console.log('second');
                // Wait for the previous item to finish processing
                await a;
                let groupid = file.groupid;
                if (vidgroups.hasOwnProperty(groupid)) {
                    vidgroups[groupid].push(file.filename);
                } else {
                    vidgroups[groupid] = [file.filename];
                }
            }, Promise.resolve());
            console.log('test: ', vidgroups);

            // for (const vidgroup in vidgroups) {
            //     console.log(vidgroup);
            // }
            let hdduuid = await query_promise();

            await Object.entries(vidgroups).reduce(async (a, group, index) => {
                await a;
                if (index + 1 < vidgroups.length) { itemsProcessing = true }

                if (group[1].length > 1) {
                    console.log('combining group: ', group[0]);
                    codeexecConvert(`ffmpeg -i "concat:${group[1].map((name) => { return `/media/${hdduuid}/record-ts/${name}|` }).join('')}" -c copy -y '/media/${hdduuid}/record-ts/${group[1][0].slice(0, -3)}~cmb.ts'`, async function (results) {
                        console.log('combine----------------------', results);
                    })

                    group[1].map(async (name) => {
                        await videoQueue.updateConverted(name, (err, data) => {
                            if (err) {
                                console.log(err);
                            } else {
                                console.log(data);
                            }
                        })
                    })

                    let duration = 0;
                    group[1].map((name) => {
                        console.log(list.find(o => o.filename === name).duration);

                        duration += parseInt(list.find(o => o.filename === name).duration);
                    })
                    let vidquery = `INSERT INTO video_queue (filename,status,duration,groupid) VALUES('${group[1][0].slice(0, -3)}~cmb.ts','waiting','${duration}','${group[0]}')`
                    await sql.query(vidquery, (err, res) => {
                        if (err) {
                            console.log("error on inserting data to video queue: ", err);
                            return;
                        }
                        console.log("inserted data to video queue: ", res);
                    });

                    console.log('conversion started...');

                    codeexecConvert(`ffmpeg -i '/media/${hdduuid}/record-ts/${group[1][0].slice(0, -3)}~cmb.ts' -c copy -y '/media/${hdduuid}/record/${group[1][0].slice(0, -3)}~cmb.mp4'`, async function (results) {
                        console.log('conversion----------------------', results);

                    })

                    await videoQueue.updateConverted(group[1][0].slice(0, -3) + '~cmb.ts', (err, data) => {
                        if (err) {
                            console.log(err);
                        } else {
                            console.log(data);
                        }
                    })

                } else {
                    codeexecConvert(`ffmpeg -i '/media/${hdduuid}/record-ts/${group[1][0]}' -c copy -y '/media/${hdduuid}/record/${group[1][0].slice(0, -2)}mp4'`, async function (results) {
                        console.log('conversion----------------------', results);

                    })
                    await videoQueue.updateConverted(group[1][0], (err, data) => {
                        if (err) {
                            console.log(err);
                        } else {
                            console.log(data);
                        }
                    })
                }
                if (index + 1 == vidgroups.length) { itemsProcessing = false }

            }, Promise.resolve())

            console.log('--------------------------------------------------------------end');
            res.status(200).json({
                message: "Successfull",
                success: true,
                data: list
            });
            // });


        } else {
            res.status(409).json({
                message: "Error",
                success: false
            });
        }
    })

};


// Not Using
// export const updateDB = async (req, res) => {

//     try {
//         var data = req.body.ssid;
//         console.log(data);

//         let status = 200
//         let message = 'created'
//         let allok = new Promise((resolve, reject) => {
//             disSettings.create(data, (err, data) => {
//                 if (err) {
//                     if (err.kind === "not_found") {
//                         status = 404
//                         message = `Not found Setting with id ${req.params.id}.`
//                     } else {
//                         status = 500
//                         message = "Error retrieving Setting with id " + req.params.id;
//                     }
//                 } else {
//                     resolve();
//                 }

//             });

//         })
//         allok.then(() => {
//             console.log("2");
//             res.send({
//                 success: true,
//                 code: status,
//                 data: message
//             });
//         })

//     } catch (err) {
//         console.log(err);
//         return res.status(500).json({
//             message: "Unable to create ssid.",
//             success: false
//         });
//     }
// };

export const getList = (req, res, next) => {

    encodeSettings.getAll(req.params.id, (err, data) => {
        if (err)
            res.status(500).send({
                message:
                    err.message || "Some error occurred while retrieving tutorials."
            });
        else res.send(data);
    });
}


export const uploadVideoOneDrive = async (req, res) => {
    if (req.body.filename.substr(-5) == "2.mp4") { isDual = true }
    // get module and topic
    let nameArr = req.body.filename.split('~');

    var client_id = "bdf4e5b5-c98f-45d1-92f6-5d6540f71821";
    var redirect_uri = "http://localhost:3000/home";
    var client_secret = "bdb828d4-446b-43b6-9297-c443c266f724";

    var authcode = await getAuthCode();
    var refreshToken = await getRefreshToken(client_id, client_secret, redirect_uri, authcode)
    let hdduuid = await query_promise()
    var file = `/media/${hdduuid}/record/${req.body.filename}`; // Filename you want to upload.
    var onedrive_folder = 'SampleFolder'; // Folder on OneDrive
    var onedrive_filename = file; // If you want to change the filename on OneDrive, please set this.

    function resUpload() {
        request.post({
            url: 'https://login.microsoftonline.com/common/oauth2/v2.0/token',
            form: {
                client_id: client_id,
                redirect_uri: redirect_uri,
                client_secret: client_secret,
                grant_type: "refresh_token",
                refresh_token: refresh_token,
            },
        }, function (error, response, body) { // Here, it creates the session.
            request.post({
                url: 'https://graph.microsoft.com/v1.0/drive/root:/' + onedrive_folder + '/' + onedrive_file + ':/createUploadSession',
                headers: {
                    'Authorization': "Bearer " + JSON.parse(body).access_token,
                    'Content-Type': "application/json",
                },
                body: '{"item": {"@microsoft.graph.conflictBehavior": "rename", "name": "' + onedrive_filename + '"}}',
            }, function (er, re, bo) {
                uploadFile(JSON.parse(bo).uploadUrl);
            });
        });
    }

    function uploadFile(uploadUrl) { // Here, it uploads the file by every chunk.
        async.eachSeries(getparams(), function (st, callback) {
            setTimeout(function () {
                fs.readFile(file, function read(e, f) {
                    request.put({
                        url: uploadUrl,
                        headers: {
                            'Content-Length': st.clen,
                            'Content-Range': st.cr,
                        },
                        body: f.slice(st.bstart, st.bend + 1),
                    }, function (er, re, bo) {
                        console.log(bo);
                    });
                });
                callback();
            }, st.stime);
        });
    }

    function getparams() {
        var allsize = fs.statSync(file).size;
        var sep = allsize < (60 * 1024 * 1024) ? allsize : (60 * 1024 * 1024) - 1;
        var ar = [];
        for (var i = 0; i < allsize; i += sep) {
            var bstart = i;
            var bend = i + sep - 1 < allsize ? i + sep - 1 : allsize - 1;
            var cr = 'bytes ' + bstart + '-' + bend + '/' + allsize;
            var clen = bend != allsize - 1 ? sep : allsize - i;
            var stime = allsize < (60 * 1024 * 1024) ? 5000 : 10000;
            ar.push({
                bstart: bstart,
                bend: bend,
                cr: cr,
                clen: clen,
                stime: stime,
            });
        }
        return ar;
    }

    resUpload()
}

const getAuthCode = (client_id, redirect_uri) => {
    try {
        return axios.get(`https://login.live.com/oauth20_authorize.srf?client_id=${client_id}&scope=onedrive.readwrite&response_type=code&redirect_uri=${redirect_uri}`)
    } catch (error) {
        console.error(error)
    }
}

const getRefreshToken = async (client_id, client_secret, redirect_uri, code) => {
    try {
        let config = {
            headers: formData.getHeaders(),
            'Content-Type': application / x - www - form - urlencoded
        }
        let data = { client_id: client_id, redirect_uri: redirect_uri, client_secret: client_secret, code: code }
        const res = await axios.post(`https://login.live.com/oauth20_token.srf`, data, config)
        console.log(res);
        return res.refresh_token;
    } catch (error) {
        console.error(error)
    }
}
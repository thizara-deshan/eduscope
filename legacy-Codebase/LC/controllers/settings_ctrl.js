import { createRequire } from 'module';
import sql from "../models/db.js";
const require = createRequire(import.meta.url);
const exec = require('child_process').exec
const spawn = require('child_process').spawn
const drivelist = require('drivelist');
const set_ip_address = require('set-ip-address');
const { NginxConfFile } = require("nginx-conf");
const simpleGit = require('simple-git');
// import nginx conf file
const filenamenginx = '/etc/nginx/sites-available/ums4fe';
const path = require('path')
const readXlsxFile = require("read-excel-file/node");
import encodeSettings from '../models/encodeSettings.js';
import bcrypt from 'bcrypt'
import essSettings from '../models/essSettings.js';
import disSettings from '../models/disSettings.js';
import fusSettings from '../models/fusSettings.js';
import ssSettings from '../models/ssSettings.js';
import devSettings from '../models/devSettings.js';
import lssSettings from '../models/lssSettings.js';
import sysSettings from '../models/sysSettings.js';
import hddid from '../models/hddid.js';
import Users from '../models/users.js';
import Admins from '../models/admin.js';

var codeexec = function (code, callback) {
    var results = true
    try {
        exec(code, (err, stdout, stderr) => {
            console.log("inside2");

            if (err !== null) {
                console.log(`exec error: ${err}`);
                results = false;
            } else {
                console.log("inside else");
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

// This function will output the lines from the script 
// AS is runs, AND will return the full combined output
// as well as exit code when it's done (using the callback).
function run_script(command, callback) {
    console.log("Starting Process.");
    var child = spawn(command);

    var scriptOutput = "";

    child.stdout.setEncoding('utf8');
    child.stdout.on('data', function (data) {
        console.log('stdout: ' + data);

        data = data.toString();
        scriptOutput += data;
    });

    child.stderr.setEncoding('utf8');
    child.stderr.on('data', function (data) {
        console.log('stderr: ' + data);

        data = data.toString();
        scriptOutput += data;
    });

    child.on('close', function (code) {
        callback(scriptOutput, code);
    });
}

// Power Off
export const PowerOff = (req, res, next) => {

    let stringval = `sudo shutdown -h now`;

    codeexec(stringval, function (results) {
        console.log(results);
        if (results) {
            res.status(200).json({
                data: results,
                message: "Successfull",
                success: true
            });
        } else {
            res.status(200).json({
                data: results,
                message: "Successfull",
                success: true
            });
        }
    })
}

// Es
export const ApplyEs = async (req, res) => {

    try {
        var dataArr = Object.entries(req.body);
        let status = 200
        let message = 'updated'
        let allok = new Promise((resolve, reject) => {
            console.log("1");

            dataArr.forEach((data, index, array) => {
                encodeSettings.updateById(req.params.id, data, (err, data) => {
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
            console.log("2");
            res.send({
                success: true,
                code: status,
                data: message
            });
        })

    } catch (err) {
        console.log(err);
        return res.status(500).json({
            message: "Unable to create encodeSettings.",
            success: false
        });
    }
};

export const GetEs = (req, res, next) => {

    encodeSettings.getAll(req.params.id, (err, data) => {
        if (err)
            res.status(500).send({
                message:
                    err.message || "Some error occurred while retrieving tutorials."
            });
        else {
            data.push({ title: 'domain', s_value: process.env.UPLOAD_DOMAIN })
            res.send(data);
        }
    });
}

// Ess
export const ApplyEss = async (req, res) => {

    try {
        var dataArr = Object.entries(req.body);
        let status = 200
        let message = 'updated'
        let allok = new Promise((resolve, reject) => {
            console.log("1");

            dataArr.forEach((data, index, array) => {
                essSettings.updateById(req.params.id, data, (err, data) => {
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
            console.log("2");
            res.send({
                success: true,
                code: status,
                data: message
            });
        })

    } catch (err) {
        console.log(err);
        return res.status(500).json({
            message: "Unable to create encodeSettings.",
            success: false
        });
    }
};

export const GetEss = (req, res, next) => {

    essSettings.getAll(req.params.id, (err, data) => {
        if (err)
            res.status(500).send({
                message:
                    err.message || "Some error occurred while retrieving tutorials."
            });
        else res.send(data);
    });
}


// Dis
export const ApplyDis = async (req, res) => {
    const data = req.body;
    let curIP;
    codeexec(`ip -o -4 addr list eth0 | awk '{print $4}' | cut -d/ -f1`, function (results) {
        // console.log(results);
        curIP = results.split('\n')[0].trim();
        console.log('after exec ip', curIP);
        console.log(curIP);
        console.log(data.ipadd);
        console.log(curIP !== data.ipadd.trim());

        if (data.ipadd && data.subnet && data.dgate && data.dns && data.ipassign == 'manual' && curIP !== data.ipadd.trim()) {

            const dnsArr = data.dns.split(',');
            console.log(dnsArr);

            let eth0 = {
                interface: 'eth0',
                ip_address: data.ipadd,
                prefix: data.subnet,
                gateway: data.dgate,
                nameservers: dnsArr
            }
            // let eth0_rtsp = {}
            // if (data.ipadd_rtsp && data.subnet_rtsp) {
            //     eth0_rtsp = {
            //         interface: 'eth0',
            //         ip_address: data.ipadd_rtsp,
            //     }
            // }

            set_ip_address.configure([eth0]).then(async () => {
                console.log('done writing config files');
                let newIP;
                await set_ip_address.restartService().then(() => {
                    console.log('Network Restarted');
                    newIP = data.ipadd.trim()
                }).catch((err) => {
                    console.log(err);
                    newIP = curIP
                })
                setTimeout(() => {
                    if (curIP !== data.ipadd.trim()) {
                        console.log('creating new build');

                        codeexec(`sed -i "s/REACT_APP_SERVER_IP=.*/REACT_APP_SERVER_IP=${newIP}/g" /root/src/UMS4/lc-frontend/.env; sudo npm --prefix /root/src/UMS4/lc-frontend/ run build && sudo rm -r /var/www/ums4fe/build; sudo cp -r /root/src/UMS4/lc-frontend/build /var/www/ums4fe/build`, function (results) {
                            console.log(results);
                        })
                    }
                }, 5000);


            })
        }
    })

    try {
        const dataArr = Object.entries(req.body);
        let status = 200
        let message = 'updated'
        let allok = new Promise((resolve, reject) => {
            console.log("1");

            dataArr.forEach((data, index, array) => {
                disSettings.updateById(req.params.id, data, (err, data) => {
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
            console.log("2");
            res.send({
                success: true,
                code: status,
                data: message
            });
        })

    } catch (err) {
        console.log(err);
        return res.status(500).json({
            message: "Unable to create encodeSettings.",
            success: false
        });
    }
};

function get_ipdata_promise() {
    return new Promise((resolve, reject) => {
        let dataObj = { ipadd: '', subnet: '', dgate: '', dns: '' };
        codeexec(`ip -o -4 addr list eth0 | awk '{print $4}' | cut -d/ -f1`, function (results) {
            console.log(results);
            dataObj.ipadd = results.split('\n');
            codeexec(`ip -o -4 addr list eth0 | awk '{print $4}' | cut -d/ -f2`, function (results) {
                console.log(results);
                dataObj.subnet = results.split('\n');
                codeexec(`ip route | awk '/eth0 proto static/ { print $3 }'`, function (results) {
                    console.log(results);
                    dataObj.dgate = results.slice(0, -1);
                    codeexec(`networkctl status eth0 | grep -A1 DNS | cut -d ':' -f2 | tr -d " \t"`, function (results) {
                        console.log(results);
                        // results.split("\n").join(",").slice(0, -1);
                        console.log(results);
                        dataObj.dns = results.split("\n").join(",").slice(0, -1);
                        resolve(dataObj)
                    })
                })
            })
        })



    });
}

export const GetDis = async (req, res, next) => {

    let dataObj = await get_ipdata_promise();

    try {
        console.log('data object------', dataObj);

        const dataArr = Object.entries(dataObj);
        let status = 200
        let message = 'updated'
        let allok = new Promise((resolve, reject) => {
            console.log("1");

            dataArr.forEach((data, index, array) => {
                if (Array.isArray(data[1])) {
                    data[1] = data[1].toString()
                }
                disSettings.updateById(req.params.id, data, (err, data) => {
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
            console.log("2");
            disSettings.getAll(req.params.id, (err, data) => {
                if (err)
                    res.status(500).send({
                        message:
                            err.message || "Some error occurred while retrieving tutorials."
                    });
                else res.send(data);
            });
        })

    } catch (err) {
        console.log(err);
        return res.status(500).json({
            message: "Unable to create encodeSettings.",
            success: false
        });
    }


}


// Fus
export const ApplyFus = async (req, res) => {

    try {
        if (req.body.iu == '1') {
            console.log('instant upload on');
            process.env.UPLOAD = 'instant';
            codeexec(`sed -i "s/UPLOAD=.*/UPLOAD=instant/g" /root/src/UMS4/LC/.env`, function (results) {
                console.log(results);
            })
        } else if (req.body.su == '1') {
            console.log('scheduled upload on');
            process.env.UPLOAD = 'scheduled';
            codeexec(`sed -i "s/UPLOAD=.*/UPLOAD=scheduled/g" /root/src/UMS4/LC/.env`, function (results) {
                console.log(results);
            })
        } else {
            console.log('upload false');
            process.env.UPLOAD = false;
            codeexec(`sed -i "s/UPLOAD=.*/UPLOAD=false/g" /root/src/UMS4/LC/.env`, function (results) {
                console.log(results);
            })
        }
        var dataArr = Object.entries(req.body);
        let status = 200
        let message = 'updated'
        console.log(dataArr);

        let allok = new Promise((resolve, reject) => {
            console.log("1");

            dataArr.forEach((data, index, array) => {
                fusSettings.updateById(req.params.id, data, (err, data) => {
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
            console.log("2");
            res.send({
                success: true,
                code: status,
                data: message
            });
        })

    } catch (err) {
        console.log(err);
        return res.status(500).json({
            message: "Unable to create encodeSettings.",
            success: false
        });
    }
};

export const GetFus = (req, res, next) => {

    fusSettings.getAll(req.params.id, (err, data) => {
        if (err)
            res.status(500).send({
                message:
                    err.message || "Some error occurred while retrieving tutorials."
            });
        else {
            data.push({ title: 'domain', s_value: process.env.UPLOAD_DOMAIN })
            res.send(data);
        }
    });
}


// Fu
export const UpdateFirm = (req, res, next) => {

    const USER = 'educheck890';
    const EMAIL = 'pulzappcheck890@gmail.com'
    let isChanged = false;

    simpleGit(path.resolve(process.cwd() + '/../')).addConfig('user.name', USER).addConfig('user.email', EMAIL).exec(() => console.log('Starting pull...'))
        .fetch('origin', 'main', (err, update) => {
            console.log(update);
            console.log(err);
            if (update && update.updated.length > 0) {
                console.log('Changes Available');
                isChanged = true;
            } else if (err) {
                console.log(err);
                res.send({
                    success: true,
                    code: 502,
                    message: 'Cannot get update from Server'
                });
            }
        }).exec(() => console.log('fetching done.')).reset('hard', ['origin/main']).exec(() => {
            if (isChanged) {

                codeexec(`ip -o -4 addr list eth0 | awk '{print $4}' | cut -d/ -f1`, function (results) {
                    let IP = results.split('\n')[0].trim();
                    codeexec(`sudo npm install && sed -i "s/REACT_APP_SERVER_IP=.*/REACT_APP_SERVER_IP=${IP}/g" /root/src/UMS4/lc-frontend/.env; sudo npm --prefix /root/src/UMS4/lc-frontend/ run build && sudo rm -r /var/www/ums4fe/build; sudo cp -r /root/src/UMS4/lc-frontend/build /var/www/ums4fe/build`, function (results) {
                        console.log('Frontend Build: ', results);

                        codeexec('sudo npm install && sudo service ums4server restart', (results) => {
                            console.log('Backend Build: ', results);
                        });
                    })
                })
                res.send({
                    success: true,
                    code: 200,
                    message: 'Updates Available'
                });
                isChanged = false;
            } else {
                res.send({
                    success: true,
                    code: 204,
                    message: 'No Updates Available'
                });
            }
        });

    // Revert to previous commit
    // git reset --hard HEAD^
    // 2
}



// Ss
export const ApplySs = async (req, res) => {

    try {
        var dataArr = Object.entries(req.body);
        let status = 200
        let message = 'updated'
        console.log(dataArr);

        let allok = new Promise((resolve, reject) => {
            console.log("1");

            dataArr.forEach((data, index, array) => {
                ssSettings.updateById(req.params.id, data, (err, data) => {
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
            console.log("2");
            res.send({
                success: true,
                code: status,
                data: message
            });
        })

    } catch (err) {
        console.log(err);
        return res.status(500).json({
            message: "Unable to create encodeSettings.",
            success: false
        });
    }
};

export const GetSs = (req, res, next) => {

    ssSettings.getAll(req.params.id, (err, data) => {
        if (err)
            res.status(500).send({
                message:
                    err.message || "Some error occurred while retrieving tutorials."
            });
        else res.send(data);
    });
}


// Dev
export const ApplyDev = async (req, res) => {

    try {
        console.log('----ddd', req.body.sdon);
        console.log(req.body.sdpath);
        console.log(process.env.SDCARD);


        // if (req.body.sdon == '1') {
        // console.log('sdon');
        process.env.SDCARD = req.body.sdpath;
        codeexec(`sed -i "s#SDCARD=.*#SDCARD=${req.body.sdpath}#g" /root/src/UMS4/LC/.env`, function (results) {
            console.log(results);
        })
        // } else {
        //     console.log('sdoff');
        //     process.env.SDCARD = false;
        //     codeexec(`sed -i "s/SDCARD=.*/SDCARD=false/g" /root/src/UMS4/LC/.env`, function (results) {
        //         console.log(results);
        //     })
        // }

        // if (req.body.domain != '') {
        // console.log('domain');
        process.env.UPLOAD_DOMAIN = req.body.domain;
        codeexec(`sed -i "s/UPLOAD_DOMAIN=.*/UPLOAD_DOMAIN=${req.body.domain}/g" /root/src/UMS4/LC/.env`, function (results) {
            console.log(results);
        })
        // }
        console.log('value', process.env.SDCARD);

        console.log((process.env.SDCARD == 'false'));

        var dataArr = Object.entries(req.body);
        let status = 200
        let message = 'updated'
        console.log(dataArr);

        let allok = new Promise((resolve, reject) => {
            console.log("1");

            dataArr.forEach((data, index, array) => {
                devSettings.updateById(req.params.id, data, (err, data) => {
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
            console.log("2");
            res.send({
                success: true,
                code: status,
                data: message
            });
        })

    } catch (err) {
        console.log(err);
        return res.status(500).json({
            message: "Unable to create encodeSettings.",
            success: false
        });
    }
};

export const GetDev = (req, res, next) => {

    devSettings.getAll(req.params.id, (err, data) => {
        if (err)
            res.status(500).send({
                message:
                    err.message || "Some error occurred while retrieving tutorials."
            });
        else {
            // add upload domain value
            data.push({ title: 'domain', s_value: process.env.UPLOAD_DOMAIN })
            res.send(data);
        }
    });
}

export const GetDevPaths = (req, res, next) => {
    let datastring = '';
    let status = 200;
    drivelist.list().then((drives) => {
        let allok = new Promise((resolve, reject) => {
            drives.forEach((drive, index, array) => {
                console.log(drive);
                if (drive.isUSB) {
                    datastring += 'Device Name: ' + drive.description + '\n' + 'Path: ' + drive.devicePath + '\n' + 'Size : ' + Math.round((drive.size) / (1073741824), 2) + 'GB\n\n';
                }

                if (index === array.length - 1) resolve();
            });
        })
        allok.then(() => {
            console.log(datastring);
            res.send({
                success: true,
                code: status,
                data: datastring
            });
        })

    }).catch((err) => {
        console.log(err);
        res.status(500).send({
            message:
                err.message || "Some error occurred while retrieving paths."
        });
    })

}


// Lss
export const ApplyLss = async (req, res) => {

    try {
        var dataArr = Object.entries(req.body);
        let status = 200
        let message = 'updated'
        console.log(dataArr);

        let allok = new Promise((resolve, reject) => {
            console.log("1");

            dataArr.forEach((data, index, array) => {
                lssSettings.updateById(req.params.id, data, (err, data) => {
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
            console.log("2");
            res.send({
                success: true,
                code: status,
                data: message
            });
        })

    } catch (err) {
        console.log(err);
        return res.status(500).json({
            message: "Unable to create encodeSettings.",
            success: false
        });
    }
};

export const GetLss = (req, res, next) => {

    lssSettings.getAll(req.params.id, (err, data) => {
        if (err)
            res.status(500).send({
                message:
                    err.message || "Some error occurred while retrieving tutorials."
            });
        else res.send(data);
    });
}

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


export const GetStorage = async (req, res, next) => {
    let hdduuid = await query_promise()
    let stringval = `df --output=size,avail,pcent /media/${hdduuid} | tail -n +2`;
    console.log('------------------------------', stringval);



    codeexec(stringval, function (results) {
        console.log(results);
        if (results) {
            res.status(200).json({
                data: results,
                message: "Successfull",
                success: true
            });
            return results
        } else {
            res.status(409).json({
                message: "Error",
                success: false
            });
            return false
        }
    })
}


// Sys
export const ApplySys = async (req, res) => {

    try {
        var dataArr = Object.entries(req.body);
        let status = 200
        let message = 'updated'
        console.log(dataArr);

        let allok = new Promise((resolve, reject) => {
            console.log("1");

            dataArr.forEach((data, index, array) => {
                sysSettings.updateById(req.params.id, data, (err, data) => {
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
            console.log("2");
            res.send({
                success: true,
                code: status,
                data: message
            });
        })

    } catch (err) {
        console.log(err);
        return res.status(500).json({
            message: "Unable to create encodeSettings.",
            success: false
        });
    }
};

export const GetSys = (req, res, next) => {

    sysSettings.getAll(req.params.id, (err, data) => {
        if (err)
            res.status(500).send({
                message:
                    err.message || "Some error occurred while retrieving tutorials."
            });
        else res.send(data);
    });
}


// Ssid list
export const cnSsid = async (req, res) => {

    try {
        var data = req.body.ssid;
        console.log(data);

        let status = 200
        let message = 'created'
        let allok = new Promise((resolve, reject) => {
            disSettings.create(data, (err, data) => {
                if (err) {
                    if (err.kind === "not_found") {
                        status = 404
                        message = `Not found Setting with id ${req.params.id}.`
                    } else {
                        status = 500
                        message = "Error retrieving Setting with id " + req.params.id;
                    }
                } else {
                    resolve();
                }

            });

        })
        allok.then(() => {
            console.log("2");
            res.send({
                success: true,
                code: status,
                data: message
            });
        })

    } catch (err) {
        console.log(err);
        return res.status(500).json({
            message: "Unable to create ssid.",
            success: false
        });
    }
};

export const GetSsid = (req, res, next) => {

    disSettings.getSsid(req.params.id, (err, data) => {
        if (err)
            res.status(500).send({
                message:
                    err.message || "Some error occurred while retrieving tutorials."
            });
        else res.send(data);
    });
}


// Create HDD UUID
export const cnUuid = async (req, res) => {

    try {

        let status = 200
        let message = 'created'



        drivelist.list().then((drives) => {
            drives.forEach((drive) => {
                console.log(drive);
                let compareval = '/dev/sda';
                if ((process.env.SDCARD != 'false')) { compareval = '/dev/sdb' }
                console.log((process.env.SDCARD == 'false'));
                console.log(compareval);

                if (drive.isUSB && drive.device == compareval) {
                    const mountPath = drive.mountpoints[0].path;
                    const name = drive.description;
                    hddid.create(1, name, mountPath, async (err, data) => {
                        if (err) {
                            if (err.kind === "not_found") {
                                status = 404
                                message = `Not found ${req.params.id}.`
                            } else {
                                status = 500
                                message = "Error retrieving " + req.params.id;
                            }
                        } else {
                            let ngnxstatus = await NginxConfFile.create(filenamenginx, function (err, conf) {
                                if (err || !conf) {
                                    console.log(err);
                                    status = 500
                                    message = "Error updating nginx conf: " + err;
                                    return;
                                }

                                // reading values
                                // console.log('location3: ' + conf);
                                // console.log('location1: ' + conf.nginx.server);
                                // console.log('location1: ' + conf.nginx.server.location[0]);
                                console.log('location4: ' + conf.nginx.server?.[0].location?.[0]);
                                // console.log('location1: ' + conf.nginx.server);

                                // location /record/ {
                                //     root /media/025627F75627E9DD/;
                                //     autoindex on;
                                // }

                                conf.nginx.server?.[0].location?.[4]._remove('root');
                                // conf.nginx.server[0]._add('location', `/record/ `);

                                // conf.nginx.server?.[0]._add('location', '/record/');
                                conf.nginx.server?.[0].location?.[4]._add('root', `${mountPath}`);
                                // conf.nginx.server?.[0].location?.[4]._add('autoindex', `on`);

                                const onFlushed = () => {
                                    console.log('finished writing to disk');
                                    codeexec('sudo systemctl restart nginx', (results) => {
                                        console.log('nginx restarted', results);
                                        codeexec('sudo service ums4server restart', (results) => {
                                            console.log('server restarted', results);
                                            return true;
                                        })
                                    })
                                };

                                conf.on('flushed', onFlushed);

                                conf.flush();
                            });
                            res.send({
                                success: true,
                                code: status,
                                data: message
                            });
                        }
                    });
                }
            })
        })

    } catch (err) {
        console.log(err);
        return res.status(500).json({
            message: "Unable to create ssid.",
            success: false
        });
    }
};


// Format HDD
export const formatHdd = async (req, res) => {

    try {
        let hdduuid = await query_promise()
        let stringval = `source=$(findmnt /media/${hdduuid} -no source) && sudo umount -fl $source; sudo mkfs.ntfs -f $source && uuid=$(sudo blkid $source -sUUID -ovalue) && sudo mkdir /media/$uuid && sudo mount -U $uuid /media/$uuid && mkdir /media/$uuid/record; mkdir /media/$uuid/record-ts; echo "UUID=$uuid /media/$uuid auto nosuid,nodev,nofail,x-gvfs-show 0 0" | sudo tee -a /etc/fstab`;

        codeexec(stringval, function (results) {
            console.log('format result: ', results);
            if (results) {
                res.status(200).json({
                    data: results,
                    message: "Successfull",
                    success: true
                });
            } else {
                res.status(200).json({
                    data: results,
                    message: "Failed Running format pipeline",
                    success: false
                });
            }
        })

        // Unmount Hard Disk
        // stringval = 'sudo umount -fl /dev/sda2';
        // codeexec(stringval, function (results) {
        //     console.log('unmounting: ', results);
        //     if (results) {
        //         //Quick Format Hard Disk
        //         stringval = 'sudo mkfs.ntfs -f /dev/sda2';
        //         codeexec(stringval, function (results) {
        //             console.log('formating: ', results);
        //             if (results) {
        //                 stringval = 'sudo blkid /dev/sda2 -sUUID -ovalue'
        //                 codeexec(stringval, function (results) {
        //                     console.log('uuid: ', results);
        //                     if (results) {
        //                         res.status(200).json({
        //                             data: results,
        //                             message: "Successfull",
        //                             success: true
        //                         });
        //                     } else {
        //                         res.status(200).json({
        //                             data: results,
        //                             message: "Failed In getting uuid",
        //                             success: false
        //                         });
        //                     }
        //                 })
        //             } else {
        //                 res.status(200).json({
        //                     data: results,
        //                     message: "Failed In Formating",
        //                     success: false
        //                 });
        //             }
        //         })
        //     } else {
        //         res.status(200).json({
        //             data: results,
        //             message: "Failed In Unmount",
        //             success: false
        //         });
        //     }
        // })

    } catch (err) {
        console.log(err);
        return res.status(500).json({
            message: "Unable to create ssid.",
            success: false
        });
    }
};


// Users
export const umCnUser = async (req, res) => {

    try {
        var data = req.body;
        console.log(data);

        let status = 200
        let message = 'created'
        let allok = new Promise(async (resolve, reject) => {
            let pass = await bcrypt.hash(data.pass, 10)
            Users.create(data.name, data.username, pass, (err, data) => {
                if (err) {
                    if (err.kind === "not_found") {
                        status = 404
                        message = `Not found Setting with id ${req.params.id}.`
                    } else {
                        status = 500
                        message = "Error retrieving Setting with id " + req.params.id;
                    }
                } else {
                    status = 200
                    message = "Successfully created" + req.params.id;
                    resolve();
                }
            })

        })
        allok.then(() => {
            console.log("2");
            res.send({
                success: true,
                code: status,
                data: message
            });
        })

    } catch (err) {
        console.log(err);
        return res.status(500).json({
            message: "Unable to create ssid.",
            success: false
        });
    }
};

export const umUploadExcel = async (req, res) => {

    try {
        if (req.file == undefined) {
            return res.status(400).send("Please upload an excel file!");
        }
        let path = "/root/src/uploads/" + req.file.filename;
        readXlsxFile(path).then(async (rows) => {
            // skip header
            rows.shift();
            let users = [];
            let goodtogo = true;

            // var bar = new Promise((resolve, reject) => {
            for (const row of rows) {
                if (row[0] == null || row[1] == null || row[2] == null) {
                    goodtogo = false;
                    return res.status(400).send({
                        message: "Invalid Format!",
                        success: false,
                    });
                } else {
                    let isDuplicate = users.indexOf(row[1])
                    console.log(isDuplicate);
                    if (isDuplicate > -1) {
                        goodtogo = false;
                        return res.status(400).send({
                            message: "Duplicate Usernames on File",
                            success: false,
                        });
                    } else {
                        users.push(row[1])
                        row[2] = await bcrypt.hash(row[2], 10)
                    }
                }
            }
            console.log(rows);

            // bar.then(() => {
            if (goodtogo) {
                Users.bulkCreate(rows, (err, data) => {
                    if (err) {
                        console.log('sql err', err);
                        res.status(500).send({
                            message: "Fail to import data into database!",
                            success: false,
                            err_code: err.code,
                        });
                    } else {
                        res.status(200).send({
                            message: "Uploaded the file successfully: " + req.file.originalname,
                        });
                    }
                })
            }
            // })
        });
    } catch (err) {
        console.log(err);
        return res.status(500).json({
            message: "Could not upload the file: " + req.file.originalname,
            success: false
        });
    }
};


export const umUpUser = async (req, res) => {

    try {
        var data = req.body;
        console.log(data);

        let status = 200
        let message = 'updated'
        let allok = new Promise(async (resolve, reject) => {
            let pass = await bcrypt.hash(data.pass, 10)

            Users.updateById(data.id, data.name, data.username, pass, data.flogin, (err, data) => {
                if (err) {
                    if (err.kind === "not_found") {
                        status = 404
                        message = `Not found Setting with id ${req.params.id}.`
                    } else {
                        status = 500
                        message = "Error retrieving Setting with id " + req.params.id;
                    }
                    reject()
                } else {
                    resolve();
                }
            })


        })
        allok.then(() => {
            console.log("2");
            res.send({
                success: true,
                code: status,
                data: message
            });
        }).catch((err) => {
            console.log(err);
            console.log('errr: ', status);
            res.send({
                success: false,
                code: status,
                data: message
            });
        })

    } catch (err) {
        console.log(err);
        return res.status(500).json({
            message: "Unable to create ssid.",
            success: false
        });
    }
};

export const umLdUsers = async (req, res) => {

    try {
        var limit = req.body;
        console.log(limit);

        let status = 200
        let message = 'created'
        let allok = new Promise((resolve, reject) => {
            Users.getAll(limit, (err, data) => {
                if (err) {
                    if (err.kind === "not_found") {
                        status = 404
                        message = `Not found Setting with id ${req.params.id}.`
                    } else {
                        status = 500
                        message = "Error retrieving Setting with id " + req.params.id;
                    }
                } else {
                    res.send(data)
                    resolve();
                }
            })


        })
        // allok.then(() => {
        //     console.log("2");
        //     res.send({
        //         success: true,
        //         code: status,
        //         data: message
        //     });
        // })

    } catch (err) {
        console.log(err);
        return res.status(500).json({
            message: "Unable to create ssid.",
            success: false
        });
    }
};

export const umCountUsers = async (req, res) => {

    try {

        let status = 200
        let message = 'created'
        let allok = new Promise((resolve, reject) => {
            Users.getAllCount((err, data) => {
                if (err) {
                    if (err.kind === "not_found") {
                        status = 404
                        message = `Not found Setting with id ${req.params.id}.`
                    } else {
                        status = 500
                        message = "Error retrieving Setting with id " + req.params.id;
                    }
                } else {
                    res.send(data)
                    resolve();
                }
            })

        })
        // allok.then(() => {
        //     console.log("2");
        //     res.send({
        //         success: true,
        //         code: status,
        //         data: message
        //     });
        // })

    } catch (err) {
        console.log(err);
        return res.status(500).json({
            message: "Unable to create ssid.",
            success: false
        });
    }
};

export const umRemoveUsers = async (req, res) => {

    try {
        var id = req.body.id;

        let status = 200
        let message = 'created'
        let allok = new Promise((resolve, reject) => {
            Users.remove(id, (err, data) => {
                if (err) {
                    if (err.kind === "not_found") {
                        status = 404
                        message = `Not found Setting with id ${req.params.id}.`
                    } else {
                        status = 500
                        message = "Error retrieving Setting with id " + req.params.id;
                    }
                } else {
                    // res.send(data)
                    resolve();
                }
            })


        })
        allok.then(() => {
            console.log("2");
            res.send({
                success: true,
                code: status,
                data: message
            });
        })

    } catch (err) {
        console.log(err);
        return res.status(500).json({
            message: "Unable to create ssid.",
            success: false
        });
    }
};

// admins
export const umCnAdmin = async (req, res) => {

    try {
        var data = req.body;
        console.log(data);

        let status = 200
        let message = 'created'
        let allok = new Promise(async (resolve, reject) => {
            let pass = await bcrypt.hash(data.pass, 10)
            Admins.create(data.name, data.username, pass, (err, data) => {
                if (err) {
                    if (err.kind === "not_found") {
                        status = 404
                        message = `Not found Setting with id ${req.params.id}.`
                    } else {
                        status = 500
                        message = "Error retrieving Setting with id " + req.params.id;
                    }
                } else {
                    status = 200
                    message = "Successfully created" + req.params.id;
                    resolve();
                }
            })

        })
        allok.then(() => {
            console.log("2");
            res.send({
                success: true,
                code: status,
                data: message
            });
        })

    } catch (err) {
        console.log(err);
        return res.status(500).json({
            message: "Unable to create ssid.",
            success: false
        });
    }
};

export const umUpAdmin = async (req, res) => {

    try {
        var data = req.body;
        console.log(data);

        let status = 200
        let message = 'updated'
        let allok = new Promise(async (resolve, reject) => {
            let pass = await bcrypt.hash(data.pass, 10)
            Admins.updateById(data.id, data.name, data.username, pass, (err, data) => {
                if (err) {
                    if (err.kind === "not_found") {
                        status = 404
                        message = `Not found Setting with id ${req.params.id}.`
                    } else {
                        status = 500
                        message = "Error retrieving Setting with id " + req.params.id;
                    }
                } else {
                    resolve();
                }
            })
        })
        allok.then(() => {
            console.log("2");
            res.send({
                success: true,
                code: status,
                data: message
            });
        })
    } catch (err) {
        console.log(err);
        return res.status(500).json({
            message: "Unable to create ssid.",
            success: false
        });
    }
};

export const umLdAdmins = async (req, res) => {

    try {
        var limit = req.body;
        console.log(limit);

        let status = 200
        let message = 'created'
        let allok = new Promise((resolve, reject) => {
            Admins.getAll(limit, (err, data) => {
                if (err) {
                    if (err.kind === "not_found") {
                        status = 404
                        message = `Not found Setting with id ${req.params.id}.`
                    } else {
                        status = 500
                        message = "Error retrieving Setting with id " + req.params.id;
                    }
                } else {
                    res.send(data)
                    resolve();
                }
            })
        })

    } catch (err) {
        console.log(err);
        return res.status(500).json({
            message: "Unable to create ssid.",
            success: false
        });
    }
};

// export const umCountAdmins = async (req, res) => {

//     try {

//         let status = 200
//         let message = 'created'
//         let allok = new Promise((resolve, reject) => {
//             Admins.getAllCount((err, data) => {
//                 if (err) {
//                     if (err.kind === "not_found") {
//                         status = 404
//                         message = `Not found Setting with id ${req.params.id}.`
//                     } else {
//                         status = 500
//                         message = "Error retrieving Setting with id " + req.params.id;
//                     }
//                 } else {
//                     res.send(data)
//                     resolve();
//                 }
//             })

//         })
//         // allok.then(() => {
//         //     console.log("2");
//         //     res.send({
//         //         success: true,
//         //         code: status,
//         //         data: message
//         //     });
//         // })

//     } catch (err) {
//         console.log(err);
//         return res.status(500).json({
//             message: "Unable to create ssid.",
//             success: false
//         });
//     }
// };


export const umRemoveAdmins = async (req, res) => {

    try {
        var id = req.body.id;

        let status = 200
        let message = 'created'
        let allok = new Promise((resolve, reject) => {
            Admins.remove(id, (err, data) => {
                if (err) {
                    if (err.kind === "not_found") {
                        status = 404
                        message = `Not found Setting with id ${req.params.id}.`
                    } else {
                        status = 500
                        message = "Error retrieving Setting with id " + req.params.id;
                    }
                } else {
                    // res.send(data)
                    resolve();
                }
            })


        })
        allok.then(() => {
            console.log("2");
            res.send({
                success: true,
                code: status,
                data: message
            });
        })

    } catch (err) {
        console.log(err);
        return res.status(500).json({
            message: "Unable to create ssid.",
            success: false
        });
    }
};
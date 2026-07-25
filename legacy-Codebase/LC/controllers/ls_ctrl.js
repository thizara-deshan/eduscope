import { createRequire } from 'module';
const require = createRequire(import.meta.url);
import Ls from '../models/ls.js';
const NodeWebcam = require("node-webcam");

// Ls
export const ApplyLs = async (req, res) => {

    try {
        var dataArr = Object.entries(req.body);
        let status = 200
        let message = 'updated'
        let allok = new Promise((resolve, reject) => {
            console.log("1");

            dataArr.forEach((data, index, array) => {
                Ls.updateById(req.params.id, data, (err, data) => {
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
            message: "Unable to create Ls.",
            success: false
        });
    }
};

export const GetLs = (req, res, next) => {

    Ls.getAll(req.params.id, (err, data) => {
        if (err)
            res.status(500).send({
                message:
                    err.message || "Some error occurred"
            });
        else res.send(data);
    });
}


export const GetDevices = (req, res, next) => {

    var opts = {

        //Picture related

        width: 1280,

        height: 720,

        quality: 100,

        // Number of frames to capture
        // More the frames, longer it takes to capture
        // Use higher framerate for quality. Ex: 60

        frames: 60,


        //Delay in seconds to take shot
        //if the platform supports miliseconds
        //use a float (0.1)
        //Currently only on windows

        delay: 0,


        //Save shots in memory

        saveShots: true,


        // [jpeg, png] support varies
        // Webcam.OutputTypes

        output: "jpeg",


        //Which camera to use
        //Use Webcam.list() for results
        //false for default device

        device: false,


        // [location, buffer, base64]
        // Webcam.CallbackReturnTypes

        callbackReturn: "base64",


        //Logging

        verbose: false,

    };


    //Creates webcam instance

    var Webcam = NodeWebcam.create(opts);
    Webcam.list((list) => { console.log(list); })
    Webcam.capture("test_picture", function (err, data) {
        if (err) {
            console.log(err);
            res.status(500).send({
                message:
                    err.message || "Some error occurred"
            });
        } else {


            res.send(data);
        }
    });
    // Webcam.list(async function (list) {
    //     var NewCam = await NodeWebcam.create({ device: list[0] });
    //     NewCam.capture("test_picture", function (err, data) {
    //         if (err) {
    //             console.log(err);
    //             res.status(500).send({
    //                 message:
    //                     err.message || "Some error occurred"
    //             });
    //         } else {
    //             res.send(data);
    //         }
    //     });
    // });

}
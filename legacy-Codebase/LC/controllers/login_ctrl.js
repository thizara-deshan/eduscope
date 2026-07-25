import { createRequire } from 'module';
const require = createRequire(import.meta.url);
import Lmc from '../models/lmc.js';
const NodeWebcam = require("node-webcam");
import { SECRET } from '../config/index.js'
import bcrypt from 'bcrypt'
import jwt from 'jsonwebtoken'
import axios from 'axios'
const https = require('https');
import Admin from '../models/admin.js';
import User from '../models/users.js';
import InstituteUser from '../models/institute-users.js';
const md5 = require('md5');

//user login
export const userLogin = async (req, res) => {
    let userCreds = req.body
    let { username, password } = userCreds;
    // First Check if the username is in the database
    const agent = new https.Agent({
        rejectUnauthorized: false
    });
    console.log('pw--', password);

    let user = User;
    let isInstitute = username.split('@')[1] === 'sliit.lk'

    if (isInstitute) {
        user = InstituteUser
        password = md5(password)
    }

    user.findByUsername(username, async (err, data) => {
        if (err)
            return res.status(404).json({
                message: "Invalid login credentials.",
                success: false
            });
        else {
            console.log(data);
            let user = data;
            let isMatched = await bcrypt.compare(password, user.password)
            console.log(isMatched);
            if (!isMatched) {
                return res.status(404).json({
                    message: "Invalid login credentials.",
                    success: false
                });
            } else {
                let token = jwt.sign(
                    {
                        user_id: user.userid,
                        role: 'user',
                        username: user.username,
                        name: user.name,
                    },
                    SECRET,
                    { expiresIn: "7 days" }
                );

                let result = {
                    username: user.username,
                    user_id: user.userid,
                    name: user.name,
                    flogin: isInstitute ? 1 : user.flogin,
                    role: 'user',
                    token: `Bearer ${token}`,
                    expiresIn: 168
                };

                return res.status(200).json({
                    ...result,
                    message: "Hurray! You are now logged in.",
                    success: true
                });
            }
        }
    });


    // try {
    //     axios.get(`https://${process.env.UPLOAD_DOMAIN}/external_service.php?key=bkgu6786GHBj68h&type=full_login_list`, { httpsAgent: agent }).then(async (list) => {
    //         const userarry = list.data.user;
    //         let isMatched = false;
    //         console.log(username);
    //         let user;
    //         userarry.forEach((userdata, index) => {
    //             if (userdata.username === username && userdata.password === password) {
    //                 isMatched = true;
    //                 user = userdata
    //             }
    //         });
    //         if (!isMatched) {
    //             return res.status(404).json({
    //                 message: "Invalid login credentials.",
    //                 success: false
    //             });
    //         } else {
    //             let token = jwt.sign(
    //                 {
    //                     user_id: user.id,
    //                     role: 'user',
    //                     username: user.username,
    //                 },
    //                 SECRET,
    //                 { expiresIn: "7 days" }
    //             );

    //             let result = {
    //                 username: user.username,
    //                 role: 'user',
    //                 token: `Bearer ${token}`,
    //                 expiresIn: 168
    //             };

    //             return res.status(200).json({
    //                 ...result,
    //                 message: "Hurray! You are now logged in.",
    //                 success: true
    //             });
    //         }
    //     })

    // } catch (error) {
    //     console.error(error);
    //     return res.status(500).json({
    //         message: "Unable to connect to sliit server",
    //         success: false
    //     });
    // }

};


//admin login
export const adminLogin = async (req, res) => {
    let userCreds = req.body
    let { username, password } = userCreds;
    // First Check if the username is in the database
    const agent = new https.Agent({
        rejectUnauthorized: false
    });
    console.log('pw--', password);
    let admin;
    Admin.findByUsername(username, async (err, data) => {
        if (err)
            return res.status(400).json({
                message: "Invalid login credentials.",
                success: false
            });
        else {
            console.log(data);
            let user = data;
            let isMatched = await bcrypt.compare(password, user.password)
            console.log(isMatched);
            if (!isMatched) {
                return res.status(403).json({
                    message: "Invalid login credentials.",
                    success: false
                });
            } else {
                let token = jwt.sign(
                    {
                        user_id: user.userid,
                        role: username == 'root' ? 'dev-admin' : 'admin',
                        username: user.username,
                    },
                    SECRET,
                    { expiresIn: "7 days" }
                );

                let result = {
                    username: user.username,
                    role: username == 'root' ? 'dev-admin' : 'admin',
                    token: `Bearer ${token}`,
                    expiresIn: 168
                };

                return res.status(200).json({
                    ...result,
                    message: "Hurray! You are now logged in.",
                    success: true
                });
            }
        }
    });




};
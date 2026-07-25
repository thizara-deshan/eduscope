import express from 'express';

import passport from 'passport';

import * as sdCtrl from '../controllers/sd_ctrl.js';

const router = express.Router();

/**

 *  Passport middleware

 */

const userAuth = passport.authenticate("jwt", { session: false });

const checkRole = roles => (req, res, next) => {
    if (!roles.includes(req.user.role)) {
        res.status(401).json("Unauthorized");
        // console.log("Unauthorised");
        return;
    } else next();
}


//test authenticated route

router.post(
    "/admin-protectd",
    userAuth, checkRole(["admin"]),
    async (req, res) => {
        return res.status(200).json("Hello Admin");
    }

);

router.get('/sdmodules', userAuth, sdCtrl.GetModules);
router.get('/sdlechalls', userAuth, sdCtrl.GetLecHalls);


export default router;
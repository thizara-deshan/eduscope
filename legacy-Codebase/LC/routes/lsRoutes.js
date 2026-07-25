import express from 'express';

import passport from 'passport';

import * as lsCtrl from '../controllers/ls_ctrl.js';

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

router.patch('/lsapply/:id', userAuth, lsCtrl.ApplyLs);
router.get('/lsget/:id', userAuth, lsCtrl.GetLs);
// router.get('/lsgetdevices', userAuth, lsCtrl.GetDevices);


export default router;
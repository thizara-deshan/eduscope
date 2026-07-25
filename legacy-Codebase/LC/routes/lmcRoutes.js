import express from 'express';

import passport from 'passport';

import * as lmcCtrl from '../controllers/lmc_ctrl.js';

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

router.patch('/lmcapply/:id', userAuth, lmcCtrl.ApplyLmc);
router.get('/lmcget/:id', userAuth, lmcCtrl.GetLmc);
// router.get('/lmcgetdevices', userAuth, lmcCtrl.GetDevices);


export default router;
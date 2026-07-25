import express from 'express';

import passport from 'passport';

import * as captureSetupCtrl from '../controllers/capture_setup_ctrl.js';

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


router.patch('/csapply/:id', userAuth, captureSetupCtrl.ApplyCs);
router.get('/csget/:id', userAuth, captureSetupCtrl.GetCs);
router.post('/cscreatesnaps', userAuth, captureSetupCtrl.createSnaps);
router.post('/cschangesnaps', userAuth, captureSetupCtrl.changeSnaps);
router.get('/getdevices/:type', userAuth, captureSetupCtrl.GetDevices);


export default router;
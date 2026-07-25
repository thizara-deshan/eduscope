import express from 'express';

import passport from 'passport';

import * as fmCtrl from '../controllers/fm_ctrl.js';

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


router.get('/fmload', userAuth, fmCtrl.LoadFiles);
router.post('/fmupload', userAuth, fmCtrl.uploadVideo);
router.post('/fmcopy', userAuth, fmCtrl.copyVideo);
router.post('/fmdelete2', userAuth, checkRole(['admin', 'dev-admin']), fmCtrl.deleteVideo);
// router.get('/fmstopcopy', fmCtrl.stopCopyVideo);
// router.post('/fmupdatedb', fmCtrl.updateDB);
router.get('/fmgetlist', userAuth, fmCtrl.getList);
router.get('/fmgetnctslist', userAuth, fmCtrl.getNonConvertedTS);
router.get('/fmstartconvert', userAuth, fmCtrl.startConvert);


export default router;
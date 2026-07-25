import express from 'express';

import passport from 'passport';

import * as adminController from '../controllers/admin_ctrl.js';
import * as loginController from '../controllers/login_ctrl.js';
import * as settingsController from '../controllers/settings_ctrl.js';

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

// login endpoints
router.post('/login', loginController.userLogin)
router.post('/resetpass', settingsController.umUpUser)
router.post('/admin-login', loginController.adminLogin)


// record endpoints
router.post('/start', userAuth, adminController.ShellStart);
router.post('/stop', userAuth, adminController.ShellStop);
router.get('/isError', adminController.isErrorFunc);
router.get('/chkstatus', userAuth, adminController.checkStatus);
router.post('/uprecstatus', userAuth, adminController.updateRecStatus);
router.post('/uppausestatus', userAuth, adminController.updatePauseStatus);
router.post('/upgroupid', userAuth, adminController.updateGroupID);

// stream endpoints
router.post('/startstream', userAuth, adminController.ShellStartStream);
router.get('/stopstream', userAuth, adminController.ShellStopStream);
// router.get('/isErrorStream', adminController.isErrorFuncStream);


export default router;
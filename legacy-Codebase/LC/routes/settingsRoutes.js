import express from 'express';
import passport from 'passport'
import upload from "../middleware/upload.js";
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


router.get('/poweroff', userAuth, settingsController.PowerOff);

// Es
router.patch('/esapply/:id', userAuth, checkRole(['admin', 'dev-admin']), settingsController.ApplyEs);
router.get('/esget/:id', userAuth, settingsController.GetEs);

// Ess
router.patch('/essapply/:id', userAuth, checkRole(['admin', 'dev-admin']), settingsController.ApplyEss);
router.get('/essget/:id', userAuth, checkRole(['admin', 'dev-admin']), settingsController.GetEss);

// Dis
router.patch('/disapply/:id', userAuth, checkRole(['admin', 'dev-admin']), settingsController.ApplyDis);
router.get('/disget/:id', userAuth, settingsController.GetDis);

// Fus
router.patch('/fusapply/:id', userAuth, checkRole(['admin', 'dev-admin']), settingsController.ApplyFus);
router.get('/fusget/:id', userAuth, checkRole(['admin', 'dev-admin']), settingsController.GetFus);

// Fu
router.get('/fuupdate', userAuth, checkRole(['admin', 'dev-admin']), settingsController.UpdateFirm);

// Ss
router.patch('/ssapply/:id', userAuth, checkRole(['admin', 'dev-admin']), settingsController.ApplySs);
router.get('/ssget/:id', userAuth, checkRole(['admin', 'dev-admin']), settingsController.GetSs);

// Dev
router.patch('/devapply/:id', userAuth, checkRole(['dev-admin']), settingsController.ApplyDev);
router.get('/devget/:id', userAuth, checkRole(['dev-admin']), settingsController.GetDev);
router.get('/devgetpaths', userAuth, checkRole(['dev-admin']), settingsController.GetDevPaths);

// Lss
router.patch('/lssapply/:id', userAuth, checkRole(['admin', 'dev-admin']), settingsController.ApplyLss);
router.get('/lssget/:id', userAuth, checkRole(['admin', 'dev-admin']), settingsController.GetLss);
router.get('/lssgetstorage', userAuth, settingsController.GetStorage);

// Sys
router.patch('/sysapply/:id', userAuth, checkRole(['admin', 'dev-admin']), settingsController.ApplySys);
router.get('/sysget/:id', userAuth, checkRole(['admin', 'dev-admin']), settingsController.GetSys);

// Ssid list
router.post('/ssidnew', userAuth, checkRole(['admin', 'dev-admin']), settingsController.cnSsid);
router.get('/ssidget', userAuth, checkRole(['admin', 'dev-admin']), settingsController.GetSsid);

// gen hard disk id
router.get('/newhddid', userAuth, checkRole(['admin', 'dev-admin']), settingsController.cnUuid);

// format hard disk
router.get('/formathdd', userAuth, checkRole(['admin', 'dev-admin']), settingsController.formatHdd);

// Um
router.post('/umcreateuser', userAuth, checkRole(['admin', 'dev-admin']), settingsController.umCnUser);
router.post('/umuploadexcel', userAuth, checkRole(['admin', 'dev-admin']), upload.single("file"), settingsController.umUploadExcel);
router.post('/umupdateuser', userAuth, checkRole(['admin', 'dev-admin']), settingsController.umUpUser);
router.post('/umloadeusers', userAuth, checkRole(['admin', 'dev-admin']), settingsController.umLdUsers);
router.get('/umcounteusers', userAuth, checkRole(['admin', 'dev-admin']), settingsController.umCountUsers);
router.post('/umremoveeusers', userAuth, checkRole(['admin', 'dev-admin']), settingsController.umRemoveUsers);

router.post('/umcreateadmin', userAuth, checkRole(['admin', 'dev-admin']), settingsController.umCnAdmin);
router.post('/umupdateadmin', userAuth, checkRole(['admin', 'dev-admin']), settingsController.umUpAdmin);
router.post('/umloadeadmins', userAuth, checkRole(['admin', 'dev-admin']), settingsController.umLdAdmins);
// router.get('/umcounteadmins', userAuth, checkRole(['admin','dev-admin']), settingsController.umCountAdmins);
router.post('/umremoveeadmins', userAuth, checkRole(['admin', 'dev-admin']), settingsController.umRemoveAdmins);

export default router;
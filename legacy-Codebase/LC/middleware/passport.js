import { SECRET } from '../config/index.js'
import pspjwt from 'passport-jwt'
const { Strategy, ExtractJwt } = pspjwt
import Admin from '../models/admin.js';
import User from '../models/users.js';
import InstituteUser from '../models/institute-users.js';

const opts = {
    jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
    secretOrKey: SECRET,
    failWithError: true
};


export default (passport) => {
    try {
        passport.use(
            new Strategy(opts, async (payload, done) => {

                //temp assign user role. This should request the database and get the user details as user
                // let user = { role: 'admin' }
                if (payload.role == 'user') {
                    let user = User;
                    if (payload.username.split('@')[1] === 'sliit.lk') {
                        user = InstituteUser;
                    }

                    user.findByUsername(payload.username, (err, data) => {
                        if (err)
                            return done(null, false);
                        else {
                            return done(null, data);
                        }
                    });
                } else {
                    Admin.findByUsername(payload.username, (err, data) => {
                        if (err)
                            return done(null, false);
                        else {
                            return done(null, payload);
                        }
                    });
                }
            })
        );
    } catch (error) {
        console.log(error);
        return res.status(500).json({
            success: false,
            error: error.message
        });
    }
};
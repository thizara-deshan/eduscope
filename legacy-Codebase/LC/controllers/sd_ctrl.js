import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const https = require('https');
import axios from 'axios'

export const GetModules = (req, res, next) => {
    const agent = new https.Agent({
        rejectUnauthorized: false
    });
    try {
        axios.get(`https://${process.env.UPLOAD_DOMAIN}/external_service.php?key=${process.env.UPLOAD_DOMAIN.split('.')[1] == 'sliit' ? 'bkgu6786GHBj68h' : 'nvdsv5876tHVGjv'}&&type=full_module_list`, { httpsAgent: agent }).then(async (list) => {
            const modulelist = list.data.module;
            return res.status(200).json({
                message: "Hurray! You are now logged in.",
                success: true,
                data: modulelist
            });

        })

    } catch (error) {
        console.error(error);
        return res.status(500).json({
            message: "Unable to connect to sliit server",
            success: false
        });
    }
}

export const GetLecHalls = (req, res, next) => {
    const agent = new https.Agent({
        rejectUnauthorized: false
    });
    try {
        axios.get(`https://${process.env.UPLOAD_DOMAIN}/external_service.php?key=bkgu6786GHBj68h&&type=full_lecture_hall_list`, { httpsAgent: agent }).then(async (list) => {
            const lecture_hall_list = list.data.lecture_hall;
            return res.status(200).json({
                message: "Hurray! You are now logged in.",
                success: true,
                data: lecture_hall_list
            });

        })

    } catch (error) {
        console.error(error);
        return res.status(500).json({
            message: "Unable to connect to sliit server",
            success: false
        });
    }
}



import sql from "./db.js"
import moment from 'moment'

// constructor
const CaptureSetup = function (setting) {
    this.title = setting.title;
    this.s_value = setting.s_value;
    this.updated_at = setting.updated_at;
};

CaptureSetup.create = (newCaptureSetup, result) => {
    sql.query("INSERT INTO capturesetup SET ?", newCaptureSetup, (err, res) => {
        if (err) {
            console.log("error: ", err);
            result(err, null);
            return;
        }

        console.log("created setting: ", { id: res.insertId, ...newCaptureSetup });
        result(null, { id: res.insertId, ...newCaptureSetup });
    });
};

CaptureSetup.findById = (id, result) => {

    sql.query(`SELECT * FROM capturesetup WHERE id = ${id}`, (err, res) => {
        if (err) {
            console.log("error: ", err);
            result(err, null);
            return;
        }

        if (res.length) {
            console.log("found setting: ", res[0]);
            result(null, res[0]);
            return;
        }

        // not found CaptureSetup with the id
        result({ kind: "not_found" }, null);
    });
};

CaptureSetup.getAll = (userid, result) => {
    let query = `SELECT * FROM capturesetup WHERE userid = ${userid}`;


    sql.query(query, (err, res) => {
        if (err) {
            console.log("error: ", err);
            result(null, err);
            return;
        }

        console.log("capturesetup: ", res);
        result(null, res);
    });
};


CaptureSetup.updateById = (id, setting, result) => {
    let updated_at = moment().format().toString();

    sql.query(
        `UPDATE capturesetup SET s_value = ?, updated_at = '${updated_at}' WHERE userid = ${id} AND title = ?`,
        [setting[1], setting[0]],
        (err, res) => {
            if (err) {
                console.log("error: ", err);
                result(null, err);
                return;
            }

            if (res.affectedRows == 0) {
                // not found CaptureSetup with the id
                result({ kind: "not_found" }, null);
                return;
            }

            console.log("updated setting: ", { id: id, ...setting });
            result(null, { id: id, ...setting });
        }
    );
};

// CaptureSetup.remove = (id, result) => {
//     sql.query("DELETE FROM capturesetup WHERE id = ?", id, (err, res) => {
//         if (err) {
//             console.log("error: ", err);
//             result(null, err);
//             return;
//         }

//         if (res.affectedRows == 0) {
//             // not found CaptureSetup with the id
//             result({ kind: "not_found" }, null);
//             return;
//         }

//         console.log("deleted setting with id: ", id);
//         result(null, res);
//     });
// };

// CaptureSetup.removeAll = result => {
//     sql.query("DELETE FROM capturesetup", (err, res) => {
//         if (err) {
//             console.log("error: ", err);
//             result(null, err);
//             return;
//         }

//         console.log(`deleted ${res.affectedRows} capturesetup`);
//         result(null, res);
//     });
// };

export default CaptureSetup;
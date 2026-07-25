import sql from "./db.js"
import moment from 'moment'

// constructor
const Settings = function (setting) {
    this.title = setting.title;
    this.s_value = setting.s_value;
    this.updated_at = setting.updated_at;
};

Settings.create = (newSettings, result) => {
    sql.query("INSERT INTO settings SET ?", newSettings, (err, res) => {
        if (err) {
            console.log("error: ", err);
            result(err, null);
            return;
        }

        console.log("created setting: ", { id: res.insertId, ...newSettings });
        result(null, { id: res.insertId, ...newSettings });
    });
};

Settings.findById = (id, result) => {

    sql.query(`SELECT * FROM settings WHERE id = ${id} AND submenu='lss'`, (err, res) => {
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

        // not found Settings with the id
        result({ kind: "not_found" }, null);
    });
};

Settings.getAll = (userid, result) => {
    let query = `SELECT * FROM settings WHERE userid = ${userid} AND submenu='lss'`;


    sql.query(query, (err, res) => {
        if (err) {
            console.log("error: ", err);
            result(null, err);
            return;
        }

        console.log("settings: ", res);
        result(null, res);
    });
};


Settings.updateById = (id, setting, result) => {
    let updated_at = moment().format().toString();

    sql.query(
        `UPDATE settings SET s_value = ?, updated_at = '${updated_at}' WHERE userid = ${id} AND title = ? AND submenu='lss'`,
        [setting[1], setting[0]],
        (err, res) => {
            if (err) {
                console.log("error: ", err);
                result(null, err);
                return;
            }

            if (res.affectedRows == 0) {
                // not found Settings with the id
                result({ kind: "not_found" }, null);
                return;
            }

            console.log("updated setting: ", { id: id, ...setting });
            result(null, { id: id, ...setting });
        }
    );
};

// Settings.remove = (id, result) => {
//     sql.query("DELETE FROM settings WHERE id = ?", id, (err, res) => {
//         if (err) {
//             console.log("error: ", err);
//             result(null, err);
//             return;
//         }

//         if (res.affectedRows == 0) {
//             // not found Settings with the id
//             result({ kind: "not_found" }, null);
//             return;
//         }

//         console.log("deleted setting with id: ", id);
//         result(null, res);
//     });
// };

// Settings.removeAll = result => {
//     sql.query("DELETE FROM settings", (err, res) => {
//         if (err) {
//             console.log("error: ", err);
//             result(null, err);
//             return;
//         }

//         console.log(`deleted ${res.affectedRows} settings`);
//         result(null, res);
//     });
// };

export default Settings;
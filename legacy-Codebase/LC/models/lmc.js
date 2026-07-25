import sql from "./db.js"
import moment from 'moment'

// constructor
const Lmc = function (setting) {
    this.title = setting.title;
    this.s_value = setting.s_value;
    this.updated_at = setting.updated_at;
};

Lmc.create = (newLmc, result) => {
    sql.query("INSERT INTO capturesetup SET ?", newLmc, (err, res) => {
        if (err) {
            console.log("error: ", err);
            result(err, null);
            return;
        }

        console.log("created setting: ", { id: res.insertId, ...newLmc });
        result(null, { id: res.insertId, ...newLmc });
    });
};

Lmc.findById = (id, result) => {

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

        // not found Lmc with the id
        result({ kind: "not_found" }, null);
    });
};

Lmc.getAll = (userid, result) => {
    let query = `SELECT * FROM lmc WHERE userid = ${userid}`;


    sql.query(query, (err, res) => {
        if (err) {
            console.log("error: ", err);
            result(null, err);
            return;
        }

        console.log("lmc: ", res);
        result(null, res);
    });
};


Lmc.updateById = (id, setting, result) => {
    let updated_at = moment().format().toString();

    sql.query(
        `UPDATE lmc SET s_value = ?, updated_at = '${updated_at}' WHERE userid = ${id} AND title = ?`,
        [setting[1], setting[0]],
        (err, res) => {
            if (err) {
                console.log("error: ", err);
                result(null, err);
                return;
            }

            if (res.affectedRows == 0) {
                // not found Lmc with the id
                result({ kind: "not_found" }, null);
                return;
            }

            console.log("updated setting: ", { id: id, ...setting });
            result(null, { id: id, ...setting });
        }
    );
};

// Lmc.remove = (id, result) => {
//     sql.query("DELETE FROM lmc WHERE id = ?", id, (err, res) => {
//         if (err) {
//             console.log("error: ", err);
//             result(null, err);
//             return;
//         }

//         if (res.affectedRows == 0) {
//             // not found Lmc with the id
//             result({ kind: "not_found" }, null);
//             return;
//         }

//         console.log("deleted setting with id: ", id);
//         result(null, res);
//     });
// };

// Lmc.removeAll = result => {
//     sql.query("DELETE FROM lmc", (err, res) => {
//         if (err) {
//             console.log("error: ", err);
//             result(null, err);
//             return;
//         }

//         console.log(`deleted ${res.affectedRows} lmc`);
//         result(null, res);
//     });
// };

export default Lmc;
import sql from "./db.js"
import moment from 'moment'

// constructor
const Record_Status = function (setting) {
    this.record = setting.record;
    this.status = setting.status;
    this.userid = setting.userid;
};

// Record_Status.create = (newRecord_Status, result) => {
//     sql.query("INSERT INTO record_status SET ?", newRecord_Status, (err, res) => {
//         if (err) {
//             console.log("error: ", err);
//             result(err, null);
//             return;
//         }

//         console.log("created setting: ", { id: res.insertId, ...newRecord_Status });
//         result(null, { id: res.insertId, ...newRecord_Status });
//     });
// };

Record_Status.findById = (id, result) => {

    sql.query(`SELECT * FROM record_status WHERE record = ${id}`, (err, res) => {
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

        // not found Record_Status with the id
        result({ kind: "not_found" }, null);
    });
};

Record_Status.getTime = (id, result) => {

    sql.query(`SELECT time FROM record_status WHERE record = ${id}`, (err, res) => {
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

        // not found Record_Status with the id
        result({ kind: "not_found" }, null);
    });
};

Record_Status.getAll = (userid, result) => {
    let query = `SELECT * FROM record_status WHERE userid = ${userid}`;


    sql.query(query, (err, res) => {
        if (err) {
            console.log("error: ", err);
            result(null, err);
            return;
        }

        console.log("record_status: ", res);
        result(null, res);
    });
};


Record_Status.updateById = (id, status, result) => {
    sql.query(
        `UPDATE record_status SET status = ${status} WHERE record=${id}`,
        (err, res) => {
            if (err) {
                console.log("error: ", err);
                result(null, err);
                return;
            }

            if (res.affectedRows == 0) {
                // not found Record_Status with the id
                result({ kind: "not_found" }, null);
                return;
            }

            console.log("updated setting: ", { id: id });
            result(null, { id: id });
        }
    );
};

Record_Status.updatePauseById = (id, result) => {
    sql.query(
        `UPDATE record_status SET pauseval = ${id} WHERE record=1`,
        (err, res) => {
            if (err) {
                console.log("error: ", err);
                result(null, err);
                return;
            }

            if (res.affectedRows == 0) {
                // not found Record_Status with the id
                result({ kind: "not_found" }, null);
                return;
            }

            console.log("updated setting: ", { id: id });
            result(null, { id: id });
        }
    );
};
// Record_Status.remove = (id, result) => {
//     sql.query("DELETE FROM record_status WHERE id = ?", id, (err, res) => {
//         if (err) {
//             console.log("error: ", err);
//             result(null, err);
//             return;
//         }

//         if (res.affectedRows == 0) {
//             // not found Record_Status with the id
//             result({ kind: "not_found" }, null);
//             return;
//         }

//         console.log("deleted setting with id: ", id);
//         result(null, res);
//     });
// };

// Record_Status.removeAll = result => {
//     sql.query("DELETE FROM record_status", (err, res) => {
//         if (err) {
//             console.log("error: ", err);
//             result(null, err);
//             return;
//         }

//         console.log(`deleted ${res.affectedRows} record_status`);
//         result(null, res);
//     });
// };

export default Record_Status;
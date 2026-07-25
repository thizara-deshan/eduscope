import sql from "./db.js"
import moment from 'moment'

// constructor
const Led_Status = function (setting) {
    this.led = setting.led;
    this.status = setting.status;
};

// Led_Status.create = (newLed_Status, result) => {
//     sql.query("INSERT INTO led_status SET ?", newLed_Status, (err, res) => {
//         if (err) {
//             console.log("error: ", err);
//             result(err, null);
//             return;
//         }

//         console.log("created setting: ", { id: res.insertId, ...newLed_Status });
//         result(null, { id: res.insertId, ...newLed_Status });
//     });
// };

Led_Status.findById = (id, result) => {

    sql.query(`SELECT * FROM led_status WHERE led = ${id}`, (err, res) => {
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

        // not found Led_Status with the id
        result({ kind: "not_found" }, null);
    });
};

Led_Status.getAll = (userid, result) => {
    let query = `SELECT * FROM lmc`;


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


Led_Status.updateById = (id, setting, result) => {
    let userid = moment().format().toString();

    sql.query(
        `UPDATE lmc SET status = ? WHERE led = ?`,
        [setting, id],
        (err, res) => {
            if (err) {
                console.log("error: ", err);
                result(null, err);
                return;
            }

            if (res.affectedRows == 0) {
                // not found Led_Status with the id
                result({ kind: "not_found" }, null);
                return;
            }

            console.log("updated setting: ", { id: id, ...setting });
            result(null, { id: id, ...setting });
        }
    );
};

// Led_Status.remove = (id, result) => {
//     sql.query("DELETE FROM lmc WHERE id = ?", id, (err, res) => {
//         if (err) {
//             console.log("error: ", err);
//             result(null, err);
//             return;
//         }

//         if (res.affectedRows == 0) {
//             // not found Led_Status with the id
//             result({ kind: "not_found" }, null);
//             return;
//         }

//         console.log("deleted setting with id: ", id);
//         result(null, res);
//     });
// };

// Led_Status.removeAll = result => {
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

export default Led_Status;
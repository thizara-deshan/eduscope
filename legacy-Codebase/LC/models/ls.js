import sql from "./db.js"
import moment from 'moment'

// constructor
const Ls = function (setting) {
    this.title = setting.title;
    this.s_value = setting.s_value;
    this.updated_at = setting.updated_at;
};

Ls.create = (newLs, result) => {
    sql.query("INSERT INTO ls SET ?", newLs, (err, res) => {
        if (err) {
            console.log("error: ", err);
            result(err, null);
            return;
        }

        console.log("created setting: ", { id: res.insertId, ...newLs });
        result(null, { id: res.insertId, ...newLs });
    });
};

Ls.findById = (id, result) => {

    sql.query(`SELECT * FROM ls WHERE id = ${id}`, (err, res) => {
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

        // not found Ls with the id
        result({ kind: "not_found" }, null);
    });
};

Ls.getAll = (userid, result) => {
    let query = `SELECT * FROM ls WHERE userid = ${userid}`;


    sql.query(query, (err, res) => {
        if (err) {
            console.log("error: ", err);
            result(null, err);
            return;
        }

        console.log("ls: ", res);
        result(null, res);
    });
};


Ls.updateById = (id, setting, result) => {
    let updated_at = moment().format().toString();

    sql.query(
        `UPDATE ls SET s_value = ?, updated_at = '${updated_at}' WHERE userid = ${id} AND title = ?`,
        [setting[1], setting[0]],
        (err, res) => {
            if (err) {
                console.log("error: ", err);
                result(null, err);
                return;
            }

            if (res.affectedRows == 0) {
                // not found Ls with the id
                result({ kind: "not_found" }, null);
                return;
            }

            console.log("updated setting: ", { id: id, ...setting });
            result(null, { id: id, ...setting });
        }
    );
};

// Ls.remove = (id, result) => {
//     sql.query("DELETE FROM ls WHERE id = ?", id, (err, res) => {
//         if (err) {
//             console.log("error: ", err);
//             result(null, err);
//             return;
//         }

//         if (res.affectedRows == 0) {
//             // not found Ls with the id
//             result({ kind: "not_found" }, null);
//             return;
//         }

//         console.log("deleted setting with id: ", id);
//         result(null, res);
//     });
// };

// Ls.removeAll = result => {
//     sql.query("DELETE FROM ls", (err, res) => {
//         if (err) {
//             console.log("error: ", err);
//             result(null, err);
//             return;
//         }

//         console.log(`deleted ${res.affectedRows} ls`);
//         result(null, res);
//     });
// };

export default Ls;
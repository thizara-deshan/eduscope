import sql from "./db.js"
import moment from 'moment'

// constructor
const Admin = function (admin) {
    this.username = admin.username;
    this.password = admin.password;
    this.userid = admin.userid;
};


Admin.create = (name, username, password, result) => {
    sql.query(`INSERT INTO admins (name, username, password) VALUES('${name}','${username}','${password}')`, (err, res) => {
        if (err) {
            console.log("error: ", err);
            result(err, null);
            return;
        }

        result(null, { id: res.insertId });
    });
};

Admin.findByUsername = (username, result) => {
    console.log(username);

    sql.query(`SELECT * FROM admins WHERE username = '${username}'`, (err, res) => {
        if (err) {
            console.log("error: ", err);
            result(err, null);
            return;
        }

        if (res.length) {
            console.log("found admin: ", res[0]);
            result(null, res[0]);
            return;
        }

        // not found Admin with the id
        result({ kind: "not_found" }, null);
    });
};

Admin.getAll = (limit, result) => {
    let query = `SELECT * FROM admins ORDER BY userid LIMIT ${limit[0]},${limit[1]}`;

    sql.query(query, (err, res) => {
        if (err) {
            console.log("error: ", err);
            result(null, err);
            return;
        }

        console.log("users: ", res);
        result(null, res);
    });
};

Admin.updateById = (id, name, username, pass, result) => {

    sql.query(
        `UPDATE admins SET password = '${pass}', username = '${username}',name='${name}' WHERE userid = ${id}`,
        (err, res) => {
            if (err) {
                console.log("error: ", err);
                result(null, err);
                return;
            }

            if (res.affectedRows == 0) {
                // not found Admin with the id
                result({ kind: "not_found" }, null);
                return;
            }

            console.log("updated admin: ", { id: id });
            result(null, { id: id });
        }
    );
};


Admin.remove = (id, result) => {
    sql.query("DELETE FROM admins WHERE userid = ?", id, (err, res) => {
        if (err) {
            console.log("error: ", err);
            result(null, err);
            return;
        }

        if (res.affectedRows == 0) {
            // not found User with the id
            result({ kind: "not_found" }, null);
            return;
        }

        console.log("deleted user with id: ", id);
        result(null, res);
    });
};

// Admin.removeAll = result => {
//     sql.query("DELETE FROM admins", (err, res) => {
//         if (err) {
//             console.log("error: ", err);
//             result(null, err);
//             return;
//         }

//         console.log(`deleted ${res.affectedRows} admins`);
//         result(null, res);
//     });
// };

export default Admin;
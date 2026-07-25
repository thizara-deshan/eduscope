import sql from "./db.js"
import moment from 'moment'

// constructor
const InstituteUser = function (user) {
    this.username = user.username;
    this.password = user.password;
    this.userid = user.userid;
};

InstituteUser.findByUsername = (username, result) => {
    console.log(username);

    sql.query(`SELECT * FROM instituteusers WHERE username = '${username}'`, (err, res) => {
        if (err) {
            console.log("error: ", err);
            result(err, null);
            return;
        }

        if (res.length) {
            console.log("found user: ", res[0]);
            result(null, res[0]);
            return;
        }

        // not found InstituteUser with the id
        result({ kind: "not_found" }, null);
    });
};

InstituteUser.create = (userid, username, password, result) => {
    sql.query(`INSERT INTO instituteusers (userid, name, username, password) VALUES('${userid}','${username}','${username}','${password}') ON DUPLICATE KEY UPDATE userid='${userid}',name='${username}', username='${username}', password='${password}'`, (err, res) => {
        if (err) {
            console.log("error: ", err);
            result(err, null);
            return;
        }

        result(null, { id: res.insertId });
    });
};

InstituteUser.bulkCreate = (userarray, result) => {
    sql.query(`INSERT INTO instituteusers (name, username, password) VALUES ?`, [userarray], (err, res) => {
        if (err) {
            console.log("error: ", err);
            result(err, null);
            return;
        }

        result(null, { id: res.insertId });
    });
};



InstituteUser.getAll = (limit, result) => {
    let query = `SELECT * FROM instituteusers ORDER BY userid LIMIT ${limit[0]},${limit[1]}`;

    sql.query(query, (err, res) => {
        if (err) {
            console.log("error: ", err);
            result(null, err);
            return;
        }

        console.log("instituteusers: ", res);
        result(null, res);
    });
};

InstituteUser.updateById = (id, name, username, pass, result) => {

    sql.query(
        `UPDATE instituteusers SET password = '${pass}', username = '${username}',name='${name}' WHERE userid = ${id}`,
        (err, res) => {
            if (err) {
                console.log("error: ", err);
                result(null, err);
                return;
            }

            if (res.affectedRows == 0) {
                // not found InstituteUser with the id
                result({ kind: "not_found" }, null);
                return;
            }

            console.log("updated user: ", { id: id });
            result(null, { id: id });
        }
    );
};

InstituteUser.remove = (id, result) => {
    sql.query("DELETE FROM instituteusers WHERE userid = ?", id, (err, res) => {
        if (err) {
            console.log("error: ", err);
            result(null, err);
            return;
        }

        if (res.affectedRows == 0) {
            // not found InstituteUser with the id
            result({ kind: "not_found" }, null);
            return;
        }

        console.log("deleted user with id: ", id);
        result(null, res);
    });
};


InstituteUser.getAllCount = (result) => {
    let query = `SELECT COUNT(*) AS userCount FROM instituteusers`;

    sql.query(query, (err, res) => {
        if (err) {
            console.log("error: ", err);
            result(null, err);
            return;
        }

        console.log("instituteusers: ", res);
        result(null, res);
    });
};

// InstituteUser.removeAll = result => {
//     sql.query("DELETE FROM instituteusers", (err, res) => {
//         if (err) {
//             console.log("error: ", err);
//             result(null, err);
//             return;
//         }

//         console.log(`deleted ${res.affectedRows} instituteusers`);
//         result(null, res);
//     });
// };

export default InstituteUser;
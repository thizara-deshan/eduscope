import sql from "./db.js"
import moment from 'moment'

// constructor
const User = function (user) {
    this.username = user.username;
    this.password = user.password;
    this.userid = user.userid;
};

User.findByUsername = (username, result) => {
    console.log(username);

    sql.query(`SELECT * FROM users WHERE username = '${username}'`, (err, res) => {
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

        // not found User with the id
        result({ kind: "not_found" }, null);
    });
};

User.create = (name, username, password, result) => {
    sql.query(`INSERT INTO users (name, username, password) VALUES('${name}','${username}','${password}')`, (err, res) => {
        if (err) {
            console.log("error: ", err);
            result(err, null);
            return;
        }

        result(null, { id: res.insertId });
    });
};

User.bulkCreate = (userarray, result) => {
    sql.query(`INSERT INTO users (name, username, password) VALUES ?`, [userarray], (err, res) => {
        if (err) {
            console.log("error: ", err);
            result(err, null);
            return;
        }

        result(null, { id: res.insertId });
    });
};



User.getAll = (limit, result) => {
    let query = `SELECT * FROM users ORDER BY userid LIMIT ${limit[0]},${limit[1]}`;

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

User.updateById = (id, name, username, pass, flogin, result) => {

    sql.query(
        `UPDATE users SET password = '${pass}', username = '${username}',name='${name}',flogin=${flogin} WHERE userid = ${id}`,
        (err, res) => {
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

            console.log("updated user: ", { id: id });
            result(null, { id: id });
        }
    );
};

User.remove = (id, result) => {
    sql.query("DELETE FROM users WHERE userid = ?", id, (err, res) => {
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


User.getAllCount = (result) => {
    let query = `SELECT COUNT(*) AS userCount FROM users`;

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

// User.removeAll = result => {
//     sql.query("DELETE FROM users", (err, res) => {
//         if (err) {
//             console.log("error: ", err);
//             result(null, err);
//             return;
//         }

//         console.log(`deleted ${res.affectedRows} users`);
//         result(null, res);
//     });
// };

export default User;
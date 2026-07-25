import sql from "./db.js"
import moment from 'moment'

// constructor
const HddId = function (setting) {
    this.title = setting.title;
    this.s_value = setting.s_value;
    this.updated_at = setting.updated_at;
};

HddId.create = (id, name, value, result) => {
    sql.query(`INSERT INTO hdd_id (id, name, value) VALUES(${id},'${name}','${value}') ON DUPLICATE KEY UPDATE name='${name}', value='${value}'`, (err, res) => {
        if (err) {
            console.log("error: ", err);
            result(err, null);
            return;
        }

        console.log("created setting: ", { id: res.insertId });
        result(null, { id: res.insertId });
    });
};

HddId.findById = (id, result) => {

    sql.query(`SELECT value FROM hdd_id WHERE id = ${id}`, (err, res) => {
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

        // not found HddId with the id
        result({ kind: "not_found" }, null);
    });
};


HddId.updateById = (id, value, result) => {
    console.log(value);

    sql.query(
        `UPDATE hdd_id SET value = '${value}' WHERE id = ${id}`,
        (err, res) => {
            if (err) {
                console.log("error: ", err);
                result(null, err);
                return;
            }

            if (res.affectedRows == 0) {
                // not found HddId with the id
                result({ kind: "not_found" }, null);
                return;
            }

            console.log("updated setting: ", { id: id });
            result(null, { id: id });

        }
    );
};


HddId.remove = (id, result) => {
    sql.query("DELETE FROM hdd_id WHERE id = ?", id, (err, res) => {
        if (err) {
            console.log("error: ", err);
            result(null, err);
            return;
        }

        if (res.affectedRows == 0) {
            // not found HddId with the id
            result({ kind: "not_found" }, null);
            return;
        }

        console.log("deleted hdd_id with id: ", id);
        result(null, res);
    });
};

HddId.removeAll = result => {
    sql.query("DELETE FROM hdd_id", (err, res) => {
        if (err) {
            console.log("error: ", err);
            result(null, err);
            return;
        }

        console.log(`deleted ${res.affectedRows} hdd_id`);
        result(null, res);
    });
};

export default HddId;
import sql from "./db.js"
import moment from 'moment'

// constructor
const VideoQueue = function (setting) {
    this.title = setting.title;
    this.s_value = setting.s_value;
    this.updated_at = setting.updated_at;
};

VideoQueue.create = (newSettings, result) => {
    sql.query("INSERT INTO video_queue SET ?", newSettings, (err, res) => {
        if (err) {
            console.log("error: ", err);
            result(err, null);
            return;
        }

        console.log("created setting: ", { id: res.insertId, ...newSettings });
        result(null, { id: res.insertId, ...newSettings });
    });
};

VideoQueue.findById = (id, result) => {

    sql.query(`SELECT * FROM video_queue WHERE id = ${id}`, (err, res) => {
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

        // not found VideoQueue with the id
        result({ kind: "not_found" }, null);
    });
};

VideoQueue.findByName = (name, result) => {
    // console.log('filename---', name);

    sql.query(`SELECT status FROM video_queue WHERE filename = '${name}'`, (err, res) => {
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

        // not found VideoQueue with the id
        result({ kind: "not_found" }, null);
    });
};

VideoQueue.getNonConverted = (result) => {
    // SELECT filename,duration FROM video_queue WHERE converted=0
    sql.query(`SELECT filename,duration,pauseval,groupid FROM video_queue WHERE converted=0 ORDER BY pauseval`, (err, res) => {
        if (err) {
            console.log("error: ", err);
            result(err, null);
            return;
        }

        if (res.length) {
            console.log("found setting in DB: ");
            result(null, res);
            return;
        }

        // not found VideoQueue with the id
        result({ kind: "not_found" }, null);
    });
};

VideoQueue.getAll = (userid, result) => {
    let query = `SELECT * FROM video_queue`;


    sql.query(query, (err, res) => {
        if (err) {
            console.log("error: ", err);
            result(null, err);
            return;
        }

        // console.log("video_queue: ", res);
        result(null, res);
    });
};


VideoQueue.updateById = (id, status, result) => {
    console.log(status);

    sql.query(
        `UPDATE video_queue SET status = '${status}' WHERE id = ${id}`,
        (err, res) => {
            if (err) {
                console.log("error: ", err);
                result(null, err);
                return;
            }

            if (res.affectedRows == 0) {
                // not found VideoQueue with the id
                result({ kind: "not_found" }, null);
                return;
            }

            console.log("updated setting: ", { id: id });
            result(null, { id: id });

        }
    );
};

VideoQueue.updateByName = (name, status, result) => {
    console.log(status);

    sql.query(
        `UPDATE video_queue SET status = '${status}' WHERE filename = '${name}'`,
        (err, res) => {
            if (err) {
                console.log("error: ", err);
                result(null, err);
                return;
            }

            if (res.affectedRows == 0) {
                // not found VideoQueue with the id
                result({ kind: "not_found" }, null);
                return;
            }

            console.log("updated setting: ", { name: name });
            result(null, { name: name });

        }
    );
};

VideoQueue.updateVidId = (id, videoid, result) => {
    console.log(videoid);

    sql.query(
        `UPDATE video_queue SET videoid = '${videoid}' WHERE id = ${id}`,
        (err, res) => {
            if (err) {
                console.log("error: ", err);
                result(null, err);
                return;
            }

            if (res.affectedRows == 0) {
                // not found VideoQueue with the id
                result({ kind: "not_found" }, null);
                return;
            }

            console.log("updated setting: ", { id: id });
            result(null, { id: id });

        }
    );
};

VideoQueue.updateConverted = (name, result) => {
    sql.query(
        `UPDATE video_queue SET converted=1 WHERE filename = '${name}'`,
        (err, res) => {
            if (err) {
                console.log("error: ", err);
                result(null, err);
                return;
            }

            if (res.affectedRows == 0) {
                // not found VideoQueue with the id
                result({ kind: "not_found" }, null);
                return;
            }

            console.log("updated setting: ", { name: name });
            result(null, { name: name });

        }
    );
};


VideoQueue.remove = (id, result) => {
    sql.query("DELETE FROM video_queue WHERE id = ?", id, (err, res) => {
        if (err) {
            console.log("error: ", err);
            result(null, err);
            return;
        }

        if (res.affectedRows == 0) {
            // not found VideoQueue with the id
            result({ kind: "not_found" }, null);
            return;
        }

        console.log("deleted video_queue with id: ", id);
        result(null, res);
    });
};

VideoQueue.removeAll = result => {
    sql.query("DELETE FROM video_queue", (err, res) => {
        if (err) {
            console.log("error: ", err);
            result(null, err);
            return;
        }

        console.log(`deleted ${res.affectedRows} video_queue`);
        result(null, res);
    });
};

VideoQueue.updateVidQGroupId = (id, result) => {
    sql.query(
        `UPDATE video_queue SET groupid = '${id}', pauseval = 0 order by id desc limit 1`,
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

export default VideoQueue;
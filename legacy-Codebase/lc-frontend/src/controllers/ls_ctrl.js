// import axios
import axios from "axios";

// import config
import Config from "./Config";

const api = {
    lsapply: "ls/lsapply",
    lsget: "ls/lsget",
};

class LsCtrl {
    api;

    async LsApply(data) {
        console.log(data);

        const config = {
            headers: { Authorization: `${localStorage.getItem('usertoken')}` }
        };
        return new Promise((resolve, reject) => {
            axios.patch(`${Config.host}${Config.port}${api.lsapply}/${data.userid}`, data, config)
                .then((Response) => {
                    resolve(Response.data)
                })
                .catch(err => {
                    reject(err)
                })
        })
    }

    async LsGet(params) {
        const config = {
            headers: { Authorization: `${localStorage.getItem('usertoken')}` }
        };
        return new Promise((resolve, reject) => {
            return axios.get(`${Config.host}${Config.port}${api.lsget}/${params}`, config)
                .then(result => {
                    if (result.status === 200) {
                        resolve(result.data)
                    } else {
                        resolve([])
                    }
                })
                .catch(err => {
                    reject(err)
                })
        })
    }

}
export default new LsCtrl();

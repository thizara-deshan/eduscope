// import axios
import axios from "axios";

// import config
import Config from "./Config";

const api = {
    lmcapply: "lmc/lmcapply",
    lmcget: "lmc/lmcget",
};

class LmcCtrl {
    api;

    async LmcApply(data) {
        console.log(data.userid);

        const config = {
            headers: { Authorization: `${localStorage.getItem('usertoken')}` }
        };
        return new Promise((resolve, reject) => {
            axios.patch(`${Config.host}${Config.port}${api.lmcapply}/${data.userid}`, data, config)
                .then((Response) => {
                    resolve(Response.data)
                })
                .catch(err => {
                    reject(err)
                })
        })
    }

    async LmcGet(params) {
        const config = {
            headers: { Authorization: `${localStorage.getItem('usertoken')}` }
        };
        return new Promise((resolve, reject) => {
            return axios.get(`${Config.host}${Config.port}${api.lmcget}/${params}`, config)
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
export default new LmcCtrl();

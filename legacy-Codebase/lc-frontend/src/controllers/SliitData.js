// import axios
import axios from "axios";

// import config
import Config from "./Config";

const api = {
    sdmodules: "sd/sdmodules",
    sdlechalls: "sd/sdlechalls",
};

class SliitData {
    api;

    async SdModules() {

        const config = {
            headers: { Authorization: `${localStorage.getItem('usertoken')}` }
        };
        return new Promise((resolve, reject) => {
            axios.get(`${Config.host}${Config.port}${api.sdmodules}`, config)
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

    async SdLecHalls() {
        const config = {
            headers: { Authorization: `${localStorage.getItem('usertoken')}` }
        };
        return new Promise((resolve, reject) => {
            return axios.get(`${Config.host}${Config.port}${api.sdlechalls}`, config)
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
export default new SliitData();

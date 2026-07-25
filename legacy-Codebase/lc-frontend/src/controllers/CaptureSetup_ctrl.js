// import axios
import axios from "axios";

// import config
import Config from "./Config";

const api = {
    csapply: "caps/csapply",
    csget: "caps/csget",
    cscreatesnaps: "caps/cscreatesnaps",
    cschangesnaps: "caps/cschangesnaps",
    getdevices: "caps/getdevices"
};

class CaptureSetupCtrl {
    api;

    async CsApply(data) {
        console.log(data.userid);

        const config = {
            headers: { Authorization: `${localStorage.getItem('usertoken')}` }
        };
        return new Promise((resolve, reject) => {
            axios.patch(`${Config.host}${Config.port}${api.csapply}/${data.userid}`, data, config)
                .then((Response) => {
                    resolve(Response.data)
                })
                .catch(err => {
                    reject(err)
                })
        })
    }

    async CsGet(params) {
        const config = {
            headers: { Authorization: `${localStorage.getItem('usertoken')}` }
        };
        return new Promise((resolve, reject) => {
            return axios.get(`${Config.host}${Config.port}${api.csget}/${params}`, config)
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

    async CsSnaps(data, rtdata) {
        console.log("awaaaaa");
        console.log(rtdata);
        console.log('hdbdh--------', data);

        data = { data, ...rtdata }

        const config = {
            headers: { Authorization: `${localStorage.getItem('usertoken')}` }
        };
        return new Promise((resolve, reject) => {
            return axios.post(`${Config.host}${Config.port}${api.cscreatesnaps}`, data, config)
                .then(result => {
                    if (result.status === 200) {
                        resolve(result)
                    } else {
                        resolve([])
                    }
                })
                .catch(err => {
                    reject(err)
                })
        })
    }

    async CsChangeSnaps(data, rtdata) {
        console.log("awaaaaa");
        data = { data, ...rtdata }
        console.log(data);

        const config = {
            headers: { Authorization: `${localStorage.getItem('usertoken')}` }
        };
        return new Promise((resolve, reject) => {
            return axios.post(`${Config.host}${Config.port}${api.cschangesnaps}`, data, config)
                .then(result => {
                    if (result.status === 200) {
                        resolve(result)
                    } else {
                        resolve([])
                    }
                })
                .catch(err => {
                    reject(err)
                })
        })
    }

    async getDevices(type) {

        const config = {
            headers: { Authorization: `${localStorage.getItem('usertoken')}` }
        };
        return new Promise((resolve, reject) => {
            return axios.get(`${Config.host}${Config.port}${api.getdevices}/${type}`, config)
                .then(result => {
                    if (result.status === 200) {
                        resolve(result)
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


export default new CaptureSetupCtrl();

// import axios
import axios from "axios";

// import config
import Config from "./Config";

const api = {
    fmload: "fm/fmload",
    fmgetnctslist: "fm/fmgetnctslist",
    fmstartconvert: "fm/fmstartconvert",
    fmupload: "fm/fmupload",
    fmcopy: "fm/fmcopy",
    fmdelete2: "fm/fmdelete2",
    // fmstopcopy: "fm/fmstopcopy",
    // fmupdatedb: "fm/fmupdatedb",
    fmget: "fm/fmget",
};

class FmCtrl {
    api;

    async FmLoadFiles() {

        const config = {
            headers: { Authorization: `${localStorage.getItem('usertoken')}` }
        };
        return new Promise((resolve, reject) => {
            axios.get(`${Config.host}${Config.port}${api.fmload}`, config)
                .then((result) => {
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

    async FmGetNonConvertedTS() {

        const config = {
            headers: { Authorization: `${localStorage.getItem('usertoken')}` }
        };
        return new Promise((resolve, reject) => {
            axios.get(`${Config.host}${Config.port}${api.fmgetnctslist}`, config)
                .then((result) => {
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

    async FmStartConvertTS() {

        const config = {
            headers: { Authorization: `${localStorage.getItem('usertoken')}` }
        };
        return new Promise((resolve, reject) => {
            axios.get(`${Config.host}${Config.port}${api.fmstartconvert}`, config)
                .then((result) => {
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

    async FmUploadFiles(data) {
        console.log(data);

        const config = {
            headers: {
                Authorization: `${localStorage.getItem('usertoken')}`
            }
        };
        return new Promise((resolve, reject) => {
            axios.post(`${Config.host}${Config.port}${api.fmupload}`, data, config)
                .then((result) => {
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

    async FmCopyFiless(data) {
        console.log(data);

        const config = {
            headers: {
                Authorization: `${localStorage.getItem('usertoken')}`
            }
        };
        return new Promise((resolve, reject) => {
            axios.post(`${Config.host}${Config.port}${api.fmcopy}`, data, config)
                .then((result) => {
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

    async FmDeleteFiless(data) {
        console.log(data);
        console.log('delete');

        const config = {
            headers: {
                Authorization: `${localStorage.getItem('usertoken')}`
            }
        };
        return new Promise((resolve, reject) => {
            axios.post(`${Config.host}${Config.port}${api.fmdelete2}`, data, config)
                .then((result) => {
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

    // async FmStopCopyFiless() {

    //     const config = {
    //         headers: { Authorization: `${localStorage.getItem('usertoken')}` }
    //     };
    //     return new Promise((resolve, reject) => {
    //         axios.get(`${Config.host}${Config.port}${api.fmstopcopy}`, config)
    //             .then((result) => {
    //                 if (result.status === 200) {
    //                     resolve(result.data)
    //                 } else {
    //                     resolve([])
    //                 }
    //             })
    //             .catch(err => {
    //                 reject(err)
    //             })
    //     })
    // }

    // async FmUpdateDB(data) {

    //     const config = {
    //         headers: { Authorization: `${localStorage.getItem('usertoken')}` }
    //     };
    //     return new Promise((resolve, reject) => {
    //         axios.post(`${Config.host}${Config.port}${api.fmupload}`, data, config)
    //             .then((result) => {
    //                 if (result.status === 200) {
    //                     resolve(result.data)
    //                 } else {
    //                     resolve([])
    //                 }
    //             })
    //             .catch(err => {
    //                 reject(err)
    //             })
    //     })
    // }


}
export default new FmCtrl();

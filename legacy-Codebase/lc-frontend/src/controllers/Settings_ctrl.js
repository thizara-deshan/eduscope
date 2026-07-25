// import axios
import axios from "axios";

// import config
import Config from "./Config";
import md5 from 'md5'

const api = {
    poweroff: "settings/poweroff",
    esapply: "settings/esapply",
    esget: "settings/esget",
    essapply: "settings/essapply",
    essget: "settings/essget",
    disapply: "settings/disapply",
    disget: "settings/disget",
    fusapply: "settings/fusapply",
    fusget: "settings/fusget",
    fuupdate: "settings/fuupdate",
    ssapply: "settings/ssapply",
    ssget: "settings/ssget",
    devapply: "settings/devapply",
    devget: "settings/devget",
    devgetpaths: "settings/devgetpaths",
    lssapply: "settings/lssapply",
    lssget: "settings/lssget",
    lssgetStorage: "settings/lssgetstorage",
    sysapply: "settings/sysapply",
    sysget: "settings/sysget",
    newhddid: "settings/newhddid",
    formathdd: "settings/formathdd",
    ssidnew: "settings/ssidnew",
    ssidget: "settings/ssidget",
    umcreateuser: "settings/umcreateuser",
    umupdateuser: "settings/umupdateuser",
    umloadeusers: "settings/umloadeusers",
    umcounteusers: "settings/umcounteusers",
    umremoveeusers: "settings/umremoveeusers",
    umcreateadmin: "settings/umcreateadmin",
    umupdateadmin: "settings/umupdateadmin",
    umloadeadmins: "settings/umloadeadmins",
    // umcounteadmins: "settings/umcounteadmins",
    umremoveeadmins: "settings/umremoveeadmins",
    umuploadexcel: "settings/umuploadexcel",
};

class SettingsCtrl {
    api;

    async PowerOff() {
        const config = {
            headers: { Authorization: `${localStorage.getItem('usertoken')}` }
        };
        return new Promise((resolve, reject) => {
            return axios.get(`${Config.host}${Config.port}${api.poweroff}`, config)
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

    // Es
    async EsApply(data) {
        console.log(data.userid);

        const config = {
            headers: { Authorization: `${localStorage.getItem('usertoken')}` }
        };
        return new Promise((resolve, reject) => {
            axios.patch(`${Config.host}${Config.port}${api.esapply}/${data.userid}`, data, config)
                .then((Response) => {
                    resolve(Response.data)
                })
                .catch(err => {
                    reject(err)
                })
        })
    }

    async EsGet(params) {
        const config = {
            headers: { Authorization: `${localStorage.getItem('usertoken')}` }
        };
        return new Promise((resolve, reject) => {
            return axios.get(`${Config.host}${Config.port}${api.esget}/${params}`, config)
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

    // Ess
    async EssApply(data) {
        console.log(data.userid);

        const config = {
            headers: { Authorization: `${localStorage.getItem('usertoken')}` }
        };
        return new Promise((resolve, reject) => {
            axios.patch(`${Config.host}${Config.port}${api.essapply}/${data.userid}`, data, config)
                .then((Response) => {
                    resolve(Response.data)
                })
                .catch(err => {
                    reject(err)
                })
        })
    }

    async EssGet(params) {
        const config = {
            headers: { Authorization: `${localStorage.getItem('usertoken')}` }
        };
        return new Promise((resolve, reject) => {
            return axios.get(`${Config.host}${Config.port}${api.essget}/${params}`, config)
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

    // Dis
    async DissApply(data) {
        console.log(data.userid);

        const config = {
            headers: { Authorization: `${localStorage.getItem('usertoken')}` }
        };
        return new Promise((resolve, reject) => {
            axios.patch(`${Config.host}${Config.port}${api.disapply}/${data.userid}`, data, config)
                .then((Response) => {
                    resolve(Response.data)
                })
                .catch(err => {
                    reject(err)
                })
        })
    }

    async DissGet(params) {
        const config = {
            headers: { Authorization: `${localStorage.getItem('usertoken')}` }
        };
        return new Promise((resolve, reject) => {
            return axios.get(`${Config.host}${Config.port}${api.disget}/${params}`, config)
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

    // Ssid List
    async SsidNew(data) {
        data = { ssid: data }
        const config = {
            headers: { Authorization: `${localStorage.getItem('usertoken')}` }
        };
        return new Promise((resolve, reject) => {
            axios.post(`${Config.host}${Config.port}${api.ssidnew}`, data, config)
                .then((Response) => {
                    resolve(Response.data)
                })
                .catch(err => {
                    reject(err)
                })
        })
    }

    async SsidGet(params) {
        const config = {
            headers: { Authorization: `${localStorage.getItem('usertoken')}` }
        };
        return new Promise((resolve, reject) => {
            return axios.get(`${Config.host}${Config.port}${api.ssidget}`, config)
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

    // Fus
    async FusApply(data) {
        console.log(data.userid);

        const config = {
            headers: { Authorization: `${localStorage.getItem('usertoken')}` }
        };
        return new Promise((resolve, reject) => {
            axios.patch(`${Config.host}${Config.port}${api.fusapply}/${data.userid}`, data, config)
                .then((Response) => {
                    resolve(Response.data)
                })
                .catch(err => {
                    reject(err)
                })
        })
    }

    async FusGet(params) {
        const config = {
            headers: { Authorization: `${localStorage.getItem('usertoken')}` }
        };
        return new Promise((resolve, reject) => {
            return axios.get(`${Config.host}${Config.port}${api.fusget}/${params}`, config)
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

    // Fu
    async FuUpdate() {
        const config = {
            headers: { Authorization: `${localStorage.getItem('usertoken')}` }
        };
        return new Promise((resolve, reject) => {
            return axios.get(`${Config.host}${Config.port}${api.fuupdate}`, config)
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

    // Ss
    async SsApply(data) {
        console.log(data.userid);

        const config = {
            headers: { Authorization: `${localStorage.getItem('usertoken')}` }
        };
        return new Promise((resolve, reject) => {
            axios.patch(`${Config.host}${Config.port}${api.ssapply}/${data.userid}`, data, config)
                .then((Response) => {
                    resolve(Response.data)
                })
                .catch(err => {
                    reject(err)
                })
        })
    }

    async SsGet(params) {
        const config = {
            headers: { Authorization: `${localStorage.getItem('usertoken')}` }
        };
        return new Promise((resolve, reject) => {
            return axios.get(`${Config.host}${Config.port}${api.ssget}/${params}`, config)
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

    // Dev
    async DevApply(data) {
        console.log(data.userid);

        const config = {
            headers: { Authorization: `${localStorage.getItem('usertoken')}` }
        };
        return new Promise((resolve, reject) => {
            axios.patch(`${Config.host}${Config.port}${api.devapply}/${data.userid}`, data, config)
                .then((Response) => {
                    resolve(Response.data)
                })
                .catch(err => {
                    reject(err)
                })
        })
    }

    async DevGet(params) {
        const config = {
            headers: { Authorization: `${localStorage.getItem('usertoken')}` }
        };
        return new Promise((resolve, reject) => {
            return axios.get(`${Config.host}${Config.port}${api.devget}/${params}`, config)
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

    async DevGetPaths() {
        const config = {
            headers: { Authorization: `${localStorage.getItem('usertoken')}` }
        };
        return new Promise((resolve, reject) => {
            return axios.get(`${Config.host}${Config.port}${api.devgetpaths}`, config)
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

    // Lss
    async LssApply(data) {
        console.log(data.userid);

        const config = {
            headers: { Authorization: `${localStorage.getItem('usertoken')}` }
        };
        return new Promise((resolve, reject) => {
            axios.patch(`${Config.host}${Config.port}${api.lssapply}/${data.userid}`, data, config)
                .then((Response) => {
                    resolve(Response.data)
                })
                .catch(err => {
                    reject(err)
                })
        })
    }

    async LssGet(params) {
        const config = {
            headers: { Authorization: `${localStorage.getItem('usertoken')}` }
        };
        return new Promise((resolve, reject) => {
            return axios.get(`${Config.host}${Config.port}${api.lssget}/${params}`, config)
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

    async getStorage() {
        const config = {
            headers: { Authorization: `${localStorage.getItem('usertoken')}` }
        };
        return new Promise((resolve, reject) => {
            return axios.get(`${Config.host}${Config.port}${api.lssgetStorage}`, config)
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

    // Sys
    async SysApply(data) {
        console.log(data.userid);

        const config = {
            headers: { Authorization: `${localStorage.getItem('usertoken')}` }
        };
        return new Promise((resolve, reject) => {
            axios.patch(`${Config.host}${Config.port}${api.sysapply}/${data.userid}`, data, config)
                .then((Response) => {
                    resolve(Response.data)
                })
                .catch(err => {
                    reject(err)
                })
        })
    }

    async SysGet(params) {
        const config = {
            headers: { Authorization: `${localStorage.getItem('usertoken')}` }
        };
        return new Promise((resolve, reject) => {
            return axios.get(`${Config.host}${Config.port}${api.sysget}/${params}`, config)
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

    async GenNewID() {
        const config = {
            headers: { Authorization: `${localStorage.getItem('usertoken')}` }
        };
        return new Promise((resolve, reject) => {
            return axios.get(`${Config.host}${Config.port}${api.newhddid}`, config)
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

    async FormatHDD() {
        const config = {
            headers: { Authorization: `${localStorage.getItem('usertoken')}` }
        };
        return new Promise((resolve, reject) => {
            return axios.get(`${Config.host}${Config.port}${api.formathdd}`, config)
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

    // Um
    async UmCreateUser(data) {

        const config = {
            headers: { Authorization: `${localStorage.getItem('usertoken')}` }
        };
        return new Promise((resolve, reject) => {
            axios.post(`${Config.host}${Config.port}${api.umcreateuser}`, data, config)
                .then((Response) => {
                    resolve(Response.data)
                })
                .catch(err => {
                    reject(err)
                })
        })
    }

    async UmUpdateUser(data, id) {
        data.id = id;

        const config = {
            headers: { Authorization: `${localStorage.getItem('usertoken')}` }
        };
        return new Promise((resolve, reject) => {
            axios.post(`${Config.host}${Config.port}${api.umupdateuser}`, data, config)
                .then((Response) => {
                    resolve(Response.data)
                })
                .catch(err => {
                    reject(err)
                })
        })
    }

    async UmLoadUsers(data) {

        const config = {
            headers: { Authorization: `${localStorage.getItem('usertoken')}` }
        };
        return new Promise((resolve, reject) => {
            axios.post(`${Config.host}${Config.port}${api.umloadeusers}`, data, config)
                .then((Response) => {
                    resolve(Response.data)
                })
                .catch(err => {
                    reject(err)
                })
        })
    }

    async UmCountUsers(data) {

        const config = {
            headers: { Authorization: `${localStorage.getItem('usertoken')}` }
        };
        return new Promise((resolve, reject) => {
            axios.get(`${Config.host}${Config.port}${api.umcounteusers}`, config)
                .then((Response) => {
                    resolve(Response.data)
                })
                .catch(err => {
                    reject(err)
                })
        })
    }

    async UmRemoveUsers(data) {

        const config = {
            headers: { Authorization: `${localStorage.getItem('usertoken')}` }
        };
        return new Promise((resolve, reject) => {
            axios.post(`${Config.host}${Config.port}${api.umremoveeusers}`, data, config)
                .then((Response) => {
                    resolve(Response.data)
                })
                .catch(err => {
                    reject(err)
                })
        })
    }


    // admin um

    async UmCreateAdmin(data) {
        const config = {
            headers: { Authorization: `${localStorage.getItem('usertoken')}` }
        };
        return new Promise((resolve, reject) => {
            axios.post(`${Config.host}${Config.port}${api.umcreateadmin}`, data, config)
                .then((Response) => {
                    resolve(Response.data)
                })
                .catch(err => {
                    reject(err)
                })
        })
    }

    async UmUpdateAdmin(data, id) {
        data.id = id;
        console.log('=======jdjj', data);

        const config = {
            headers: { Authorization: `${localStorage.getItem('usertoken')}` }
        };
        return new Promise((resolve, reject) => {
            axios.post(`${Config.host}${Config.port}${api.umupdateadmin}`, data, config)
                .then((Response) => {
                    resolve(Response.data)
                })
                .catch(err => {
                    reject(err)
                })
        })
    }

    async UmLoadAdmins(data) {

        const config = {
            headers: { Authorization: `${localStorage.getItem('usertoken')}` }
        };
        return new Promise((resolve, reject) => {
            axios.post(`${Config.host}${Config.port}${api.umloadeadmins}`, data, config)
                .then((Response) => {
                    resolve(Response.data)
                })
                .catch(err => {
                    reject(err)
                })
        })
    }

    // async UmCountAdmins(data) {

    //     const config = {
    //         headers: { Authorization: `${localStorage.getItem('usertoken')}` }
    //     };
    //     return new Promise((resolve, reject) => {
    //         axios.get(`${Config.host}${Config.port}${api.umcounteadmins}`, config)
    //             .then((Response) => {
    //                 resolve(Response.data)
    //             })
    //             .catch(err => {
    //                 reject(err)
    //             })
    //     })
    // }

    async UmRemoveAdmins(data) {

        const config = {
            headers: { Authorization: `${localStorage.getItem('usertoken')}` }
        };
        return new Promise((resolve, reject) => {
            axios.post(`${Config.host}${Config.port}${api.umremoveeadmins}`, data, config)
                .then((Response) => {
                    resolve(Response.data)
                })
                .catch(err => {
                    reject(err)
                })
        })
    }

    async UmUploadExcel(formdata) {

        const config = {
            headers: {
                Authorization: `${localStorage.getItem('usertoken')}`,
                'Content-Type': 'multipart/form-data',
            }
        };
        return new Promise((resolve, reject) => {
            axios.post(`${Config.host}${Config.port}${api.umuploadexcel}`, formdata, config)
                .then((Response) => {
                    console.log(Response);
                    resolve(Response)
                })
                .catch(err => {
                    console.log(err.response.data);
                    reject(err.response.data)
                })
        })
    }
}
export default new SettingsCtrl();

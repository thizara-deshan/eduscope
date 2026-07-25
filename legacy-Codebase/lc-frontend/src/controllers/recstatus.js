// user class functions

// import axios

import axios from "axios";



// import config

import Config from "./Config";



const api = {

  start: "admin/start",

  stop: "admin/stop",

  chkerr: "admin/isError",

  chkstatus: "admin/chkstatus",
  uprecstatus: "admin/uprecstatus",
  uppausestatus: "admin/uppausestatus",
  upgroupid: "admin/upgroupid"

};



class RecordStatus {

  api;



  async startRec(data, csdata) {
    console.log("----------dd----", csdata);

    data = { ...data, ...csdata }


    const config = {

      headers: { Authorization: `${localStorage.getItem('usertoken')}` }

    };

    return new Promise((resolve, reject) => {

      axios.post(`${Config.host}${Config.port}${api.start}`, data, config)

        .then((Response) => {

          resolve(Response)

        })

        .catch(err => {

          reject(err)

        })

    })

  }





  async checkError() {

    const config = {

      headers: { Authorization: `${localStorage.getItem('usertoken')}` }

    };

    return new Promise((resolve, reject) => {

      axios.get(`${Config.host}${Config.port}${api.chkerr}`, config)

        .then((Response) => {

          resolve(Response)

        })

        .catch(err => {

          reject(err)

        })

    })

  }



  async stopRec(data, csdata) {

    data = { ...data, ...csdata }

    const config = {

      headers: { Authorization: `${localStorage.getItem('usertoken')}` }

    };

    return new Promise((resolve, reject) => {

      axios.post(`${Config.host}${Config.port}${api.stop}`, data, config)

        .then((Response) => {

          resolve(Response.data)

        })

        .catch(err => {

          reject(err)

        })

    })

  }




  async checkStatus() {

    const config = {

      headers: { Authorization: `${localStorage.getItem('usertoken')}` }

    };

    return new Promise((resolve, reject) => {

      axios.get(`${Config.host}${Config.port}${api.chkstatus}`, config)

        .then((Response) => {

          resolve(Response)

        })

        .catch(err => {

          reject(err)

        })

    })

  }

  async upRecStatus(data) {

    const config = {

      headers: { Authorization: `${localStorage.getItem('usertoken')}` }

    };

    return new Promise((resolve, reject) => {

      axios.post(`${Config.host}${Config.port}${api.uprecstatus}`, data, config)

        .then((Response) => {

          resolve(Response)

        })

        .catch(err => {

          reject(err)

        })

    })

  }

  async upPauseStatus(data) {

    const config = {

      headers: { Authorization: `${localStorage.getItem('usertoken')}` }

    };

    return new Promise((resolve, reject) => {

      axios.post(`${Config.host}${Config.port}${api.uppausestatus}`, data, config)

        .then((Response) => {

          resolve(Response)

        })

        .catch(err => {

          reject(err)

        })

    })

  }

  async upgroupID() {

    const config = {

      headers: { Authorization: `${localStorage.getItem('usertoken')}` }

    };

    return new Promise((resolve, reject) => {

      axios.post(`${Config.host}${Config.port}${api.upgroupid}`, null, config)

        .then((Response) => {

          resolve(Response)

        })

        .catch(err => {

          reject(err)

        })

    })

  }

}

export default new RecordStatus();


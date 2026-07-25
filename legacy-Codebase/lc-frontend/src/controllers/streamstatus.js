// user class functions

// import axios

import axios from "axios";

// import config

import Config from "./Config";



const api = {

  start: "admin/startstream",

  stop: "admin/stopstream",

  chkerr: "admin/isErrorStream"

};



class StreamStatus {

  api;



  async startStream(data) {

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



  async stopStream() {

    const config = {

      headers: { Authorization: `${localStorage.getItem('usertoken')}` }

    };

    return new Promise((resolve, reject) => {

      axios.get(`${Config.host}${Config.port}${api.stop}`, config)

        .then((Response) => {

          resolve(Response.data)

        })

        .catch(err => {

          reject(err)

        })

    })

  }









}

export default new StreamStatus();


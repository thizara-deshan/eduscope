// import axios
import axios from "axios";

// import config
import Config from "./Config";

const api = {
  signin: "admin/login",
  resetpass: "admin/resetpass",
}

class Login {
  api;
  userLogout = () => {
    localStorage.removeItem("usertoken");
    window.location.replace('/home')
  }

  getCurrentUser = () => {
    const token = localStorage.getItem("usertoken");
    let isUser;
    if (token) {
      isUser = true;
    } else {
      isUser = false;
    }
    return isUser;
  }

  userSignIn = async (username, password) => {
    var requestData = {
      username: username,
      password: password,
    };
    var userData = {};
    var resp = 600;
    await axios.post(`${Config.host}${Config.port}${api.signin}`, requestData)
      .then(
        (Response) => {
          console.log('response', Response);

          resp = Response.data;
          userData = Response.data.success;
          resp.flogin && localStorage.setItem("usertoken", Response.data.token);
        }
      )
      .catch((err) => {
        console.error(err);
        try {
          console.error(err);
          resp = err.response.status;
        } catch (error) {
          resp = 600;
        }
      });

    if (resp === 200) {
      return userData;
    }
    return resp;
  }

  resetPass = async (id, name, username, password) => {
    console.log(id, name);

    var requestData = {
      id: id,
      name: name,
      username: username,
      pass: password,
      flogin: true
    };
    let resp = 600;
    await axios.post(`${Config.host}${Config.port}${api.resetpass}`, requestData)
      .then(
        (Response) => {
          console.log('response', Response);
          resp = Response.data.code;
        }
      )
      .catch((err) => {
        console.error(err);
        console.error(err);
        resp = err.response.status;
      });

    return resp;
  }
}

export default new Login();

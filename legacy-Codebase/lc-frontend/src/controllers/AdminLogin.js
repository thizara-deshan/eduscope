// import axios
import axios from "axios";

// import config
import Config from "./Config";

const api = {
  signin: "admin/admin-login",
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
          localStorage.setItem("usertoken", Response.data.token);
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
}

export default new Login();

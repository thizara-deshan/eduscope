
class Config {
  host;
  port;
  constructor() {
    //backend server details

    this.host = `http://${process.env.REACT_APP_SERVER_IP}`;
    this.port = ":3000/api/";
  }

}

var obj = new Config();
export default obj;

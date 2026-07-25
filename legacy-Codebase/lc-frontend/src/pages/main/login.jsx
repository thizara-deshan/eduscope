import React, { useState, useEffect } from "react";
import {
  Row,
  Col,
  Button,
  Alert,
  Container,
  Label,
  FormGroup,
} from "reactstrap";
import { Link, useHistory } from "react-router-dom";
import { Modal } from 'antd';
import { AvForm, AvField } from "availity-reactstrap-validation";
import { withRouter } from 'react-router-dom'
// import images
import logodark from "../../assets/images/logo.png";
import LoginUser from "../../controllers/login"
import welcome from "../../assets/images/logo.png";
import useAuth from "../../useAuth";

const Login = () => {
  const { loginUser, loading, user } = useAuth();
  const [usernameval, setUsernameval] = useState("");
  const [passval, setPassval] = useState("");
  const [reseting, setReseting] = useState("");
  const [newpassval, setNewPassval] = useState("");
  const [confirmpassval, setConfirmPassval] = useState("");
  const [error, setError] = useState("");
  const [successAlert, setSuccessAlert] = useState("");
  const [userData, setUserData] = useState({});
  const [resetModal, setResetModal] = useState(false);
  const history = useHistory();

  useEffect(() => {
    if (user) {
      history.push("/home");
    }
  }, [])
  //on username change
  const usernameValueChange = (e) => {
    setUsernameval(e.currentTarget.value);
  };

  //on password change
  const passValueChange = (e) => {
    setPassval(e.currentTarget.value);
  };

  //on new password change
  const newpassValueChange = (e) => {
    let value = e.currentTarget.value
    let regex = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)[a-zA-Z\d]{8,}$/
    setNewPassval(value);
    if (!regex.test(value)) {
      setError('Password should have at least 8 characters, one digit, one lower case and one upper case')
    } else {
      setError('')
    }
  };

  //on confirm password change
  const confirmpassValueChange = (e) => {
    setConfirmPassval(e.currentTarget.value);
    if (newpassval !== e.currentTarget.value) {
      setError("Passwords Mismatched")
    } else {
      setError('')
    }
  };

  //On submit button
  const onLogin = async (e) => {
    e.preventDefault();
    //call login controller function
    var status = await loginUser(LoginUser, usernameval, passval);
    console.log(status);

    switch (true) {
      // password not match
      case (status == 403):
        await setError(
          "Inavlid Password"
        );
        return -1;
      // user not found
      case (status == 400):
        await setError(
          "Inavlid Username"
        );
        return -1;
      // network error
      case (status == 600):
        setError("Please check your network connection");
        return -1;
      case (typeof status === 'object' && status !== null):
        //success redirect
        if (status.flogin) {
          history.push("/home");
        } else {
          setError("")
          setResetModal(true);
          setUserData(status)
        }
        // window.location.replace('/home')
        break;
      default:
        setError("check username or password")
        return -1;
    }
  }

  //On submit button
  const onPassReset = async (e) => {
    e.preventDefault();
    setReseting('loading')
    //call login controller function
    if (newpassval === confirmpassval) {
      LoginUser.resetPass(userData.user_id, userData.name, userData.username, newpassval).then((res) => {
        console.log(res);
        if (res == 200) {
          localStorage.setItem("usertoken", userData.token);
          setError('')
          setReseting('done')
          setSuccessAlert('Password Reset Successful')
          setTimeout(() => {
            history.push('/home')
          }, 2000);
        } else {
          setReseting('')
          setError('Error While Resetting Password')
        }
      }).catch((err) => {
        console.log(err);
        setReseting('')
        setError('Error While Resetting Password')
      })
    } else {
      setReseting('')
      setError(`Passwords Mismatched`);
    }
  }

  return (
    <React.Fragment>
      <div>
        <Container className="p-0">
          <Row className="no-gutters">
            <Modal
              title="Reset Password"
              centered
              visible={resetModal}
              footer={null}
              closable={false}
            >
              <AvForm
                className="form-horizontal"
                onValidSubmit={(e) => {
                  onPassReset(e);
                }
                }
              >
                <FormGroup className="auth-form-group-custom mb-4">
                  <i className="ri-lock-2-line auti-custom-input-icon"></i>
                  <Label htmlFor="newpassword">New Password</Label>
                  <AvField
                    name="newpass"
                    value=""
                    type="password"
                    className="form-control"
                    onChange={(e) => newpassValueChange(e)}
                    id="newpass"
                    placeholder="Enter a New Password"
                  />
                </FormGroup>
                <FormGroup className="auth-form-group-custom mb-4">
                  <i className="ri-lock-2-line auti-custom-input-icon"></i>
                  <Label htmlFor="confirmpassword">Confirm Password</Label>
                  <AvField
                    name="confirmpass"
                    value=""
                    type="password"
                    className="form-control"
                    onChange={(e) => confirmpassValueChange(e)}
                    id="confirmpass"
                    placeholder="Confirm password"
                  />
                </FormGroup>
                {error && <Alert color="danger">{error}</Alert>}
                {successAlert && <Alert color="success">{successAlert}</Alert>}
                <div className="mt-4 text-center">
                  <Button
                    className="w-100 waves-effect bg-gami waves-light"
                    style={{ background: "#000080" }}
                    type="submit"
                    disabled={reseting == 'loading' ? true : reseting == 'done' ? true : false}
                  >
                    {reseting == 'loading' ? <span className="spinner-border spinner-border-sm mr-2" role="status" aria-hidden="true"></span> : reseting == 'done' ? "Redirecting..." : "Set New Password"}
                  </Button>
                </div>
              </AvForm>
            </Modal>
            <Col lg={12}>
              <div className="authentication-page-content p-4 d-flex align-items-center min-vh-100">
                <div className="w-100">
                  <Col lg={5} className="shadow rounded-3 mx-auto p-3 nopadblock2">
                    <Row className="p-5 nopadblock">
                      <Col lg={12} className="my-auto">
                        <Row className="justify-content-center">
                          <Col lg={12}>
                            <div>
                              <div className="text-center">
                                <div>
                                  <Link to="/login" className="logo">
                                    <img src={logodark} height="45" alt="logo" />
                                  </Link>
                                </div>
                                <h1 className="text-center my-2 fw-bold">WELCOME!</h1>
                                <h4 className="mt-2 badge text-light" style={{ background: "#3D6CFC" }}>Login</h4>
                              </div>
                              {error ? <Alert color="danger">{error}</Alert> : null}
                              <div className="p-2 mt-3">
                                <AvForm
                                  className="form-horizontal"
                                  onValidSubmit={(e) => {
                                    onLogin(e);
                                  }
                                  }
                                >
                                  <FormGroup className="auth-form-group-custom mb-4">
                                    <i className="ri-user-2-line auti-custom-input-icon"></i>
                                    <Label htmlFor="username">Username</Label>
                                    <AvField
                                      name="username"
                                      value=""
                                      type="text"
                                      className="form-control"
                                      id="username"
                                      onChange={(e) => usernameValueChange(e)}
                                      validate={{ required: true }}
                                      placeholder="Enter username"
                                    />
                                  </FormGroup>
                                  <FormGroup className="auth-form-group-custom mb-4">
                                    <i className="ri-lock-2-line auti-custom-input-icon"></i>
                                    <Label htmlFor="userpassword">Password</Label>
                                    <AvField
                                      name="pass"
                                      value=""
                                      type="password"
                                      className="form-control"
                                      onChange={(e) => passValueChange(e)}
                                      id="pass"
                                      placeholder="Enter password"
                                    />
                                  </FormGroup>
                                  <div className="mt-4 text-center">
                                    <Button
                                      className="w-100 waves-effect bg-gami waves-light"
                                      style={{ background: "#000080" }}
                                      type="submit"
                                    >
                                      {loading ? <span className="spinner-border spinner-border-sm mr-2" role="status" aria-hidden="true"></span> : "Log In"}
                                    </Button>
                                  </div>
                                </AvForm>
                              </div>
                            </div>
                          </Col>
                        </Row>
                      </Col>
                    </Row>
                  </Col>
                </div>
              </div>
            </Col>
          </Row>
        </Container>
      </div>
    </React.Fragment>
  );
};

export default withRouter(Login);

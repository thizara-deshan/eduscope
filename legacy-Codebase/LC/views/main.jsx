import React, { useState } from "react";
import {
    Row,
    Col,
    Button,
    Container,
} from "reactstrap";
import { Link, useHistory } from "react-router-dom";
import { withRouter } from 'react-router-dom'
// import images
import logodark from "../../assets/images/logo-dark.png";
import welcome from "../../assets/images/welcome.png";
import useAuth from "../../useAuth";


const Home = () => {


    const history = useHistory();

    return (
        <React.Fragment>
            <div>
                <Container className="p-0">
                    <Row className="no-gutters">
                        <Col lg={12} className="nopadblock">
                            <div className="authentication-page-content p-4 d-flex align-items-center min-vh-100">
                                <div className="w-100">
                                    <Col lg={12} className="shadow rounded-3 p-5 nopadblock2">
                                        <Row className="p-5 nopadblock">
                                            <Col lg={8}>
                                                <h1 className="text-center my-5 fw-bold">WELCOME!</h1>
                                                <img src={welcome} style={{ width: "100%" }} alt="Welcome" />
                                            </Col>
                                            <Col lg={4} className="my-auto">
                                                <Row className="justify-content-center">
                                                    <Col lg={12}>
                                                        <div>
                                                            <div className="text-center">
                                                                <div>
                                                                    <Link to="/home" className="logo">
                                                                        <img src={logodark} height="40" alt="logo" />
                                                                    </Link>
                                                                </div>

                                                                <h4 className="font-size-18 mt-2 badge text-dark bg-gami">Please Select a Portal</h4>
                                                            </div>

                                                            <div className="p-2 mt-3">

                                                                <div className="mt-4 text-center">
                                                                    <Button
                                                                        className="w-50 waves-effect bg-gami waves-light"
                                                                        onClick={() => { history.push('/login/admin') }}
                                                                    >
                                                                        Admin Portal
                                  </Button>
                                                                </div>
                                                                <div className="mt-4 text-center">
                                                                    <Button
                                                                        className="w-50 waves-effect bg-gami waves-light"
                                                                        onClick={() => { history.push('/login/manager') }}
                                                                    >
                                                                        Manager Portal
                                  </Button>
                                                                </div>
                                                                <div className="mt-4 text-center">
                                                                    <Button
                                                                        className="w-50 waves-effect bg-gami waves-light"
                                                                        onClick={() => { history.push('/login/employee') }}
                                                                    >
                                                                        Employee Portal
                                  </Button>
                                                                </div>
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
        </React.Fragment >
    );
};

export default withRouter(Home);

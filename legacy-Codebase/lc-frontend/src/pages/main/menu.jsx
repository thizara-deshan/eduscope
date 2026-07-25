import React, { useState, useEffect, useRef } from "react";
import {
    Row,
    Col,
    Container,
    Label,
    FormGroup,
} from "reactstrap";
import { Link, useHistory } from "react-router-dom";
import { withRouter } from 'react-router-dom'
import { Button as ButtonAnt, Input as InputAnt, Select, PageHeader, Layout, Typography, Statistic, Progress, message, Modal } from 'antd';
import { PoweroffOutlined, ExclamationCircleOutlined } from '@ant-design/icons';
import SettingsCtrl from "../../controllers/Settings_ctrl";
import csImg from "../../assets/images/video-capture.png"
import fmImg from "../../assets/images/documents.png"
import cfsImg from "../../assets/images/settings.png"
import diImg from "../../assets/images/info.png"
import lloImg from "../../assets/images/live.png"
import lsImg from "../../assets/images/stream.png"
import RecordStatus from "../../controllers/recstatus";
import fmCtrl from "../../controllers/fm_ctrl";
import useAuth from "../../useAuth";
import jwt from 'jwt-decode'

const Menu = () => {
    const socket = useRef();
    const { Header, Content } = Layout;
    const { user } = useAuth();
    const userdata = localStorage.getItem('usertoken');
    let username = user.username || jwt(userdata).username;
    let role = user.role || jwt(userdata).role;

    // useEffect = (() => {
    RecordStatus.stopRec().then((result) => {
        console.log(result);
        // socket.current.off("presentation");

        // socket.current.off("presenter");

        // socket.current.emit('startpriv', false);
    })
        .catch(err => {
            console.log(err);
            // socket.current.off("presentation");

            // socket.current.off("presenter");

            // socket.current.emit('startpriv', false);
        })
    // }, [])

    const history = useHistory();
    const handleChange = (value) => {
        console.log(`selected ${value}`);
    }

    useEffect(() => {
        // const newsocket = openSocket(`http://${process.env.REACT_APP_SERVER_IP}:3000`, { transports: ['websocket'] });
        // socket.current = newsocket;

        // fmCtrl.FmStopCopyFiless().then((data) => {
        //     console.log(data);

        // })
        // return () => newsocket.disconnect();

    }, [])

    const key = 'loading'

    const { confirm } = Modal;


    const poweroff = () => {
        console.log('poweroff');
        confirm({
            title: 'Do you want to Power Off the device?',
            icon: <ExclamationCircleOutlined />,
            onOk() {
                message.loading({ content: 'Shutting Down...', key, duration: 0 })
                SettingsCtrl.PowerOff().then((res) => {
                    if (res.success) {
                        message.success({ content: 'Device Shutdown Successfully!', key, duration: 1 })

                    }
                }).catch((err) => {
                    console.log(err);
                    message.success({ content: 'Device Shutdown Successfully!', key, duration: 1 })

                    // message.error({ content: 'Oops! Something went wrong! Please Try Again. Check Connection!', key, duration: 1 })
                })
            },
            onCancel() {
                console.log('Canceled');
            },
        });
    }



    return (
        <React.Fragment>
            <div>
                <Container className='fw-container'>
                    <Row className="no-gutters">
                        <Col lg={12} className="nopadblock">
                            <div className="p-4 d-flex align-items-center min-vh-100">
                                <div className="w-100">
                                    <Col lg={10} className="bg-white maincontainer mx-auto shadow rounded-3 nopadblock2">
                                        <Layout className="bg-white rounded-3">
                                            <Header className="p-0 h-auto">
                                                <div className="site-page-header-ghost-wrapper">
                                                    <PageHeader
                                                        style={{ background: '#001529' }}
                                                        className="page-header-dark"
                                                        ghost={false}
                                                        title="Eduscope UMS"
                                                        subTitle="Main Menu"
                                                        extra={[
                                                            <ButtonAnt key="1" type='text' style={{ color: "#ffffff" }}>
                                                                {username}
                                                            </ButtonAnt>,
                                                            <ButtonAnt key="2" className='cus-btn1' type="primary" onClick={() => { history.push('/home') }}
                                                            >
                                                                Recording Menu
                                                            </ButtonAnt>,
                                                        ]}
                                                    >
                                                    </PageHeader>
                                                </div>
                                            </Header>
                                            <Content className="my-5" style={{ padding: '0 50px' }}>
                                                <Row className="d-flex justify-content-center">
                                                    <Col lg={3} md={6} sm={6} className="mt-5">
                                                        <ButtonAnt className="menu-btn" onClick={() => { history.push('/capturesetup') }}>
                                                            <img src={csImg} />
                                                            Capture Setup
                                                        </ButtonAnt>
                                                    </Col>
                                                    <Col lg={3} md={6} sm={6} className="mt-5">
                                                        <ButtonAnt className="menu-btn" onClick={() => { history.push('/fm') }}>
                                                            <img src={fmImg} />
                                                                File Management
                                                            </ButtonAnt>
                                                    </Col>
                                                    {role != 'user' ? <Col lg={3} md={6} sm={6} className="mt-5">
                                                        <ButtonAnt className="menu-btn" onClick={() => { history.push('/confsettings') }}>
                                                            <img src={cfsImg} />
                                                            Configuration Settings
                                                        </ButtonAnt>
                                                    </Col> : <></>}
                                                    <Col lg={3} md={6} sm={6} className="mt-5">
                                                        <ButtonAnt className="menu-btn" onClick={() => { history.push('/main') }}>
                                                            <img src={diImg} />
                                                               Device Info
                                                        </ButtonAnt>
                                                    </Col>
                                                    <Col lg={3} md={6} sm={6} className="mt-5">
                                                        <ButtonAnt className="menu-btn" onClick={() => { history.push('/lmc') }}>
                                                            <img src={lloImg} />
                                                                Live Meeting Connect
                                                        </ButtonAnt>
                                                    </Col>
                                                    <Col lg={3} md={6} sm={6} className="mt-5">
                                                        <ButtonAnt className="menu-btn" onClick={() => { history.push('/ls') }}>
                                                            <img src={lsImg} />
                                                                Live Streaming
                                                        </ButtonAnt>
                                                    </Col>
                                                </Row>
                                            </Content>
                                        </Layout>
                                    </Col>
                                </div>
                            </div>
                        </Col>
                        <ButtonAnt
                            type="primary"
                            shape="circle"
                            onClick={poweroff}
                            icon={<PoweroffOutlined />}
                            className="powerbtn"
                            title="Shutdown Device"
                            style={{ background: '#1C488C' }}
                            size="large"
                        />
                    </Row>
                </Container>
            </div >
        </React.Fragment >
    );
};

export default withRouter(Menu);

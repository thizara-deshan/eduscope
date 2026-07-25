import React, { useState } from "react";
import {
    Row,
    Col,
    Container
} from "reactstrap";

import {
    withRouter, BrowserRouter as Router, useHistory,
    Switch,
    Route,
    Link
} from 'react-router-dom';

import { Button as ButtonAnt, PageHeader, Layout, Menu } from 'antd';
import Ess from './ess'
import Dis from './dis'
import Es from './es'
import Lss from './lss'
import Fus from './fus'
import Ss from './ss'
import Fu from './fu'
import Us from './us'
import Sys from './sys'
import Dev from './dev'
import Um from './um'

import useAuth from "../../useAuth";
import jwt from 'jwt-decode'


const ConfSettings = () => {
    const { Header, Content, Sider } = Layout;
    const { user } = useAuth();
    const userdata = localStorage.getItem('usertoken');
    let role = user.role || jwt(userdata).role;
    const history = useHistory();
    console.log('-----ss', role);

    return (
        <Router>
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
                                                            subTitle="Configuration Settings"
                                                            extra={[
                                                                <ButtonAnt key="1" className='cus-btn1' type="primary" onClick={() => { history.push('/menu') }}>
                                                                    Main Menu
                                                            </ButtonAnt>,
                                                            ]}
                                                        >
                                                        </PageHeader>
                                                    </div>
                                                </Header>
                                                <Content style={{ margin: '0px 0 0 0' }}>
                                                    <Layout style={{ minHeight: "68vh", height: "100%" }}>
                                                        <Sider className="site-layout-background" width={220} >
                                                            <Menu theme="dark" defaultSelectedKeys={["1"]} mode="inline">
                                                                {/* <Menu.Item key="1">
                                                                    <Link to="/confsettings/ess">
                                                                        <span>Eduscope Stream Setings</span>
                                                                    </Link>
                                                                </Menu.Item> */}
                                                                <Menu.Item key="2">
                                                                    <Link to="/confsettings/dis">
                                                                        {/* <Icon type="fire" /> */}
                                                                        <span>Network Settings</span>
                                                                    </Link>
                                                                </Menu.Item>
                                                                <Menu.Item key="3">
                                                                    <Link to="/confsettings/es">
                                                                        {/* <Icon type="fire" /> */}
                                                                        <span>Encoder Settings</span>
                                                                    </Link>
                                                                </Menu.Item>
                                                                <Menu.Item key="4">
                                                                    <Link to="/confsettings/lss">
                                                                        {/* <Icon type="fire" /> */}
                                                                        <span>Local Storage Settings</span>
                                                                    </Link>
                                                                </Menu.Item>
                                                                <Menu.Item key="5">
                                                                    <Link to="/confsettings/fus">
                                                                        {/* <Icon type="fire" /> */}
                                                                        <span>File Upload Settings</span>
                                                                    </Link>
                                                                </Menu.Item>
                                                                <Menu.Item key="6">
                                                                    <Link to="/confsettings/ss">
                                                                        {/* <Icon type="fire" /> */}
                                                                        <span>Schedule Settings</span>
                                                                    </Link>
                                                                </Menu.Item>
                                                                <Menu.Item key="7">
                                                                    <Link to="/confsettings/fu">
                                                                        {/* <Icon type="fire" /> */}
                                                                        <span>Firmware Update</span>
                                                                    </Link>
                                                                </Menu.Item>
                                                                <Menu.Item key="8">
                                                                    <ButtonAnt style={{ background: "none", border: "none", color: "rgba(255, 255, 255, 0.65)", textAlign: "left", padding: 0 }} onClick={() => { history.push('/lmc') }}>
                                                                        {/* <Icon type="fire" /> */}
                                                                        <span>UAC/UVC Selection</span>
                                                                    </ButtonAnt>
                                                                </Menu.Item>
                                                                <Menu.Item key="9">
                                                                    <Link to="/confsettings/um">
                                                                        {/* <Icon type="fire" /> */}
                                                                        <span>User Management</span>
                                                                    </Link>
                                                                </Menu.Item>
                                                                <Menu.Item key="10">
                                                                    <Link to="/confsettings/sys">
                                                                        {/* <Icon type="fire" /> */}
                                                                        <span>System Settings</span>
                                                                    </Link>
                                                                </Menu.Item>
                                                                {role == 'dev-admin' ? <Menu.Item key="11">
                                                                    <Link to="/confsettings/dev">
                                                                        {/* <Icon type="fire" /> */}
                                                                        <span>Developer Options</span>
                                                                    </Link>
                                                                </Menu.Item> : <></>}
                                                            </Menu>
                                                        </Sider>
                                                        <Content style={{ background: "#fff" }}>
                                                            <div style={{ padding: 24, background: "#fff" }}>
                                                                <Switch>
                                                                    <Route path="/confsettings/ess">
                                                                        <Ess />
                                                                    </Route>
                                                                    <Route path="/confsettings/dis">
                                                                        <Dis />
                                                                    </Route>
                                                                    <Route path="/confsettings/es">
                                                                        <Es />
                                                                    </Route>
                                                                    <Route path="/confsettings/lss">
                                                                        <Lss />
                                                                    </Route>
                                                                    <Route path="/confsettings/fus">
                                                                        <Fus />
                                                                    </Route>
                                                                    <Route path="/confsettings/ss">
                                                                        <Ss />
                                                                    </Route>
                                                                    <Route path="/confsettings/fu">
                                                                        <Fu />
                                                                    </Route>
                                                                    <Route path="/confsettings/us">
                                                                        <Us />
                                                                    </Route>
                                                                    <Route path="/confsettings/um">
                                                                        <Um />
                                                                    </Route>
                                                                    <Route path="/confsettings/sys">
                                                                        <Sys />
                                                                    </Route>
                                                                    <Route path="/confsettings/dev">
                                                                        <Dev />
                                                                    </Route>
                                                                </Switch>
                                                            </div>
                                                        </Content>
                                                    </Layout>
                                                </Content>
                                            </Layout>
                                        </Col>
                                    </div>
                                </div>
                            </Col>
                        </Row>
                    </Container>
                </div>
            </React.Fragment >
        </Router>
    );
};

export default withRouter(ConfSettings);

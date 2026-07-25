import React, { useState, useEffect } from "react";
import {
    Row,
    Col,
    Container,
    Label,
    FormGroup,
} from "reactstrap";
import { Link, useHistory } from "react-router-dom";
import { withRouter } from 'react-router-dom'
import { Button as ButtonAnt, Input as InputAnt, Divider, Select, PageHeader, Input, message, Switch, Slider } from 'antd';
import SettingsCtrl from "../../controllers/Settings_ctrl";

const Ess = () => {

    const [nssval, setNssval] = useState();
    const [fulval, setFulval] = useState();

    const [essOptions, setEssOption] = useState({
        ful: '',
        nss: '',
        url: '',
        username: '',
        pass: '',
        para1: '',
        para2: '',
        userid: ''
    });

    useEffect(() => {
        loadSettings();
    }, []);

    const loadSettings = () => {
        SettingsCtrl.EssGet(1).then((res) => {
            // Get array and create object with needed values
            let data = res.reduce((acc, cur) => ({ ...acc, [cur.title]: cur.s_value }), {})
            console.log(res);

            setEssOption({
                ful: data.ful,
                nss: data.nss,
                url: data.url,
                username: data.username,
                pass: data.pass,
                para1: data.para1,
                para2: data.para2,
                userid: res[0].userid
            })
            if (data.ful == '1') {
                setFulval(true)
            }
            if (data.nss == '1') {
                setNssval(true)
            }
        })
    }

    const apply = () => {
        console.log(essOptions.userid);

        SettingsCtrl.EssApply(essOptions).then((res) => {
            if (res.success) {
                message.success('Settings Applied', 1);
                loadSettings();
            } else {
                message.error('Something went wrong', 1);
            }
        }).catch((err) => {
            console.log(err);
            message.error('Something went wrong', 1);
        })
    }

    const handleonChange = (event) => {
        console.log(event);

        setEssOption({ ...essOptions, [event.target.name]: event.target.value });
        console.log(essOptions);
    }

    useEffect(() => {
        if (!nssval) { setEssOption({ ...essOptions, nss: '0' }); }
        if (!fulval) { setEssOption({ ...essOptions, ful: '0' }); }
    }, [nssval, fulval])

    const nssOnchange = (val) => {
        if (val) {
            setFulval(false);
        }
        setNssval(prevCheck => !prevCheck);
        val ? setEssOption({ ...essOptions, nss: '1' }) : setEssOption({ ...essOptions, nss: '0' });
    }

    const fulOnchange = (val) => {
        if (val) {
            setNssval(false);
        }
        setFulval(prevCheck => !prevCheck);
        val ? setEssOption({ ...essOptions, ful: '1' }) : setEssOption({ ...essOptions, ful: '0' });
    }
    return (
        <React.Fragment>
            <div>
                <PageHeader
                    className="site-page-header"
                    title="Eduscope Stream Settings"
                    extra={[
                        <ButtonAnt key="1" className='cus-btn1' type="primary" onClick={apply}>
                            Apply
                </ButtonAnt>,
                    ]}
                    style={{ padding: "0", marginBottom: "3rem" }}
                />
                <Row>
                    <Col lg={6}>
                        <div className="d-grid">
                            <div className="d-inline my-2">
                                <Label>File Upload Location:</Label><Switch className="mx-3" checked={fulval} name='ful' onChange={fulOnchange} checkedChildren="On" unCheckedChildren="Off" />
                            </div>
                            <div className="d-inline-block my-2">
                                <Label>URL</Label><Input value={essOptions.url} onChange={handleonChange} name='url' disabled={!fulval} placeholder="URL" />
                            </div>
                            <div className="d-inline-block my-2">
                                <Label>Username</Label><Input value={essOptions.username} onChange={handleonChange} name='username' disabled={!fulval} placeholder="Username" />
                            </div>
                            <div className="d-inline-block my-2">
                                <Label>Password</Label><Input.Password value={essOptions.pass} onChange={handleonChange} name='pass' disabled={!fulval} placeholder="Password" />
                            </div>
                        </div>
                    </Col>
                    <Col lg={6}>
                        <div className="d-grid">
                            <div className="d-inline my-2">
                                <Label>Network Storage Setup:</Label><Switch checked={nssval} name='nss' className="mx-3" onChange={nssOnchange} checkedChildren="On" unCheckedChildren="Off" />
                            </div>
                            <div className="d-inline-block my-2">
                                <Label>Parameter 1</Label><Input value={essOptions.para1} name='para1' onChange={handleonChange} disabled={!nssval} placeholder="Parameter 1" />
                            </div>
                            <div className="d-inline-block my-2">
                                <Label>Parameter 2</Label><Input value={essOptions.para2} name='para2' onChange={handleonChange} disabled={!nssval} placeholder="Parameter 2" />
                            </div>
                        </div>
                    </Col>
                </Row>
            </div>
        </React.Fragment >
    );
};

export default withRouter(Ess);

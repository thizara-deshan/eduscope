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
import { Button as ButtonAnt, Input as InputAnt, TimePicker, Select, PageHeader, Input, Progress, Switch, message } from 'antd';
import SettingsCtrl from "../../controllers/Settings_ctrl";

const Ss = () => {

    const [sval, setSval] = useState(false);

    const [ssOptions, setSsOption] = useState({
        sr: '',
        url: '',
        username: '',
        pass: '',
        userid: ''
    });

    useEffect(() => {
        loadSettings();
    }, []);

    const loadSettings = () => {
        SettingsCtrl.SsGet(1).then((res) => {
            // Get array and create object with needed values
            let data = res.reduce((acc, cur) => ({ ...acc, [cur.title]: cur.s_value }), {})
            console.log(res);
            if (data.sr == '1') {
                setSval(true)
            }
            setSsOption({
                sr: data.sr,
                url: data.url,
                username: data.username,
                pass: data.pass,
                userid: res[0].userid
            })
        })
    }

    const apply = () => {
        SettingsCtrl.SsApply(ssOptions).then((res) => {
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

        setSsOption({ ...ssOptions, [event.target.name]: event.target.value });
        console.log(ssOptions);

    }

    const srOnchange = (val) => {
        setSval(prevCheck => !prevCheck);
        val ? setSsOption({ ...ssOptions, sr: '1' }) : setSsOption({ ...ssOptions, sr: '0' });
    }

    return (
        <React.Fragment>
            <div>
                <PageHeader
                    className="site-page-header"
                    title="Schedule Settings"
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
                            <div className="d-inline mb-3">
                                <Label>Schedule Recording:</Label><Switch className="mx-3" checked={sval} onChange={srOnchange} checkedChildren="On" unCheckedChildren="Off" />
                            </div>
                            <div className="d-inline-block my-2">
                                <Label>URL</Label><Input value={ssOptions.url} onChange={handleonChange} name='url' disabled={!sval} placeholder="URL" />
                            </div>
                            <div className="d-inline-block my-2">
                                <Label>Username</Label><Input value={ssOptions.username} onChange={handleonChange} name='username' disabled={!sval} placeholder="Username" />
                            </div>
                            <div className="d-inline-block my-2">
                                <Label>Password</Label><Input.Password value={ssOptions.pass} onChange={handleonChange} name='pass' disabled={!sval} placeholder="Password" />
                            </div>
                        </div>
                    </Col>
                </Row>
            </div>
        </React.Fragment >
    );
};

export default withRouter(Ss);

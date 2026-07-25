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
import { Button as ButtonAnt, Input as InputAnt, TimePicker, Select, PageHeader, Input, Progress, Switch, message, Divider, Alert } from 'antd';
import SettingsCtrl from "../../controllers/Settings_ctrl";

const Dev = () => {

    const { TextArea } = Input;

    const [sval, setSval] = useState(false);
    const [upval, setUpval] = useState(true);
    const [Err, setErr] = useState(false);
    const [devicepaths, setDevicepaths] = useState('');

    const [devOptions, setDevOption] = useState({
        sdon: '',
        sdpath: '',
        domain: '',
        userid: ''
    });

    useEffect(() => {
        loadSettings();
    }, []);

    useEffect(() => {
        if (sval) {
            getDevicepaths()
        } else {
            // if (!devOptions.sdon) {
            console.log('ss');
            // setDevOption({ sdpath: 'false' })
            devOptions.sdpath = false
            // }
        }
        console.log(devOptions.sdpath);

    }, [sval]);



    const loadSettings = () => {
        SettingsCtrl.DevGet(1).then((res) => {
            console.log(res);
            // Get array and create object with needed values
            let data = res.reduce((acc, cur) => ({ ...acc, [cur.title]: cur.s_value }), {})
            if (data.sdon == '1') {
                setSval(true);
                getDevicepaths();
            }
            let domain = data.domain;
            let sdpath = data.sdpath;

            if (data.sdon == '0') { sdpath = '' }
            if (data.domain == 'false') { domain = ''; setUpval(false) }
            setDevOption({
                sdon: data.sdon,
                sdpath: sdpath,
                domain: domain,
                userid: res[0].userid
            })

        })
    }

    const getDevicepaths = () => {
        SettingsCtrl.DevGetPaths().then((res) => {
            console.log(res);

            if (res) {
                setDevicepaths(res.data)
            } else {
                message.error('Something went wrong', 1);
            }
        })
    }

    const apply = () => {
        console.log(devOptions);

        SettingsCtrl.DevApply(devOptions).then((res) => {
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

        setDevOption({ ...devOptions, [event.target.name]: event.target.value });
        console.log(devOptions);
        if (event.target.name == 'domain') {
            let regex = /^[a-z0-9]+([\-\.]{1}[a-z0-9]+)*\.[a-z]{2,5}(:[0-9]{1,5})?(\/.*)?$/;
            setErr(regex.test(event.target.value))
        }
    }

    const switchOnchangeS = (val) => {
        setSval(prevCheck => !prevCheck);
        val ? setDevOption({ ...devOptions, sdon: '1' }) : setDevOption({ ...devOptions, sdon: '0', sdpath: 'false' });
    }

    const switchOnchangeUp = (val) => {
        setUpval(prevCheck => !prevCheck);
        val ? console.log('') : setDevOption({ ...devOptions, domain: 'false' });

    }



    return (
        <React.Fragment>
            <div>
                <PageHeader
                    className="site-page-header"
                    title="Developer Options"
                    extra={[
                        <ButtonAnt key="1" className='cus-btn1' type="primary" onClick={apply}>
                            Apply
                </ButtonAnt>,
                    ]}
                    style={{ padding: "0", marginBottom: "1rem" }}
                />
                <Row>
                    <Col lg={6}>
                        <Divider orientation="left" style={{ borderColor: "#121212", fontWeight: "900", fontWeight: "900" }}>SD CARD OPTIONS</Divider>
                        <div className="d-grid">
                            <div className="d-inline mb-3">
                                <Label>SD Card:</Label><Switch className="mx-3" checked={sval} onChange={switchOnchangeS} name='sdon' checkedChildren="On" unCheckedChildren="Off" />
                            </div>
                            <div className="d-inline-block my-2">
                                <Label>SD Card Path</Label><Input value={devOptions.sdpath} onChange={handleonChange} name='sdpath' disabled={!sval} />
                            </div>
                            <div className="d-inline-block my-2">
                                <Label>Drive Details</Label><TextArea rows={4} value={devicepaths} name='devpaths' readOnly={true} />
                            </div>
                        </div>
                        <Divider orientation="left" style={{ borderColor: "#121212", fontWeight: "900", fontWeight: "900" }}>UPLOAD DOMAIN</Divider>
                        <div className="d-grid">
                            <div className="d-inline mb-3">
                                <Label>Enable Uplaod Domain:</Label><Switch className="mx-3" checked={upval} onChange={switchOnchangeUp} checkedChildren="On" unCheckedChildren="Off" />
                            </div>
                            <div className="d-inline-block my-2">
                                <Label>Domain for API's</Label><Input disabled={!upval} addonBefore='https://' value={devOptions.domain} onChange={handleonChange} name='domain' />
                                {!Err && <Alert message="Enter a valid domain. Ex: test.eduscopestream.com" type="warning" showIcon />}
                            </div>
                        </div>
                    </Col>
                </Row>
            </div>
        </React.Fragment >
    );
};

export default withRouter(Dev);

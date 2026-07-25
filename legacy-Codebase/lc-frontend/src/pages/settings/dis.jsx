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
import { Button as ButtonAnt, Input as InputAnt, Divider, Select, PageHeader, Input, message, Switch, Statistic } from 'antd';
import SettingsCtrl from "../../controllers/Settings_ctrl";
import moment from 'moment';


const Dis = () => {

    const [whval, setWhval] = useState(false);
    const [rtspval, setRtspVal] = useState(false);
    const [rtspval_nc, setRtspVal_nc] = useState(false);
    const [initIP, setInitIP] = useState('');
    const [cnew, setCnew] = useState("");
    const { Option } = Select;
    //ssid list data
    const [ssidlist, setSsidList] = useState([{
        value: "",
        name: "",
        id: ""
    }])

    const { Countdown } = Statistic;

    const [disOptions, setDisOption] = useState({
        ipassign: '',
        ipadd: '',
        subnet: '',
        ipadd_rtsp: '',
        subnet_rtsp: '',
        dgate: '',
        dns: '',
        wifi: '',
        ssid: '',
        username: '',
        pass: '',
        userid: '',
        rtsp: '',
        rtsplink: '',
        rtsplink2: ''
    });

    useEffect(() => {
        loadSettings();
    }, []);

    const loadSettings = () => {
        SettingsCtrl.DissGet(1).then((res) => {
            // Get array and create object with needed values
            let data = res.reduce((acc, cur) => ({ ...acc, [cur.title]: cur.s_value }), {})
            console.log(res);
            if (data.wifi == '1') {
                setWhval(true)
            }
            if (data.rtsp == '1') {
                setRtspVal(true)
            }

            data.ipadd.split(',')[1] ? setRtspVal_nc(true) : setRtspVal_nc(false);
            console.log(data.ipadd.split(',')[1]);

            setDisOption({
                ipassign: data.ipassign,
                ipadd: data.ipadd.split(',')[0],
                subnet: data.subnet.split(',')[0],
                ipadd_rtsp: data.ipadd.split(',')[1] ? data.ipadd.split(',')[1] : '',
                subnet_rtsp: data.subnet.split(',')[1] ? data.subnet.split(',')[1] : '',
                dgate: data.dgate,
                dns: data.dns,
                wifi: data.wifi,
                ssid: data.ssid,
                username: data.username,
                pass: data.pass,
                userid: res[0].userid,
                rtsp: data.rtsp,
                rtsplink: data.rtsplink,
                rtsplink2: data.rtsplink2
            })
            setInitIP(data.ipadd.split(',')[0])
        })
        SettingsCtrl.SsidGet().then((res) => {
            console.log(res);
            setSsidList(res.map((item) => {
                return (
                    {
                        value: item.ssid,
                        name: item.ssid,
                        id: item.id
                    }
                )
            }))
        })
    }

    const apply = () => {
        let allok = true;
        if (cnew.length > 0) {
            disOptions.ssid = cnew;
            SettingsCtrl.SsidNew(cnew).then((res) => {
                if (res.success) {
                    // message.success('Settings Applied', 1);
                    allok = true;
                    loadSettings();
                } else {
                    // message.error('Something went wrong', 1);
                    allok = false;
                }
            }).catch((err) => {
                console.log(err);
                allok = false;
                // message.error('Something went wrong', 1);
            })
        }
        SettingsCtrl.DissApply(disOptions).then((res) => {
            if (res.success) {
                if (allok) {
                    console.log(disOptions.ipadd);
                    console.log(initIP);

                    if (disOptions.ipassign == 'manual' && disOptions.ipadd != initIP) {

                        message.success({ content: (<>New IP will be available in <Countdown format='mm:ss' value={moment().add(5, 'minutes')} />New IP: <b>http://{disOptions.ipadd}:3000</b></>), duration: 310, className: 'ipchangemsg' });

                    } else {
                        message.success('Settings Applied', 1);
                    }
                } else {
                    message.error('Something went wrong while saving ssid', 1);
                }
                setTimeout(() => {
                    loadSettings();
                }, 3000);
            } else {
                message.error('Something went wrong', 1);
            }
        }).catch((err) => {
            console.log(err);
            message.error('Something went wrong', 1);
        })
    }

    const handleonChange = (event) => {
        if (event.target.name == 'ssid') {
            setCnew(event.target.value)
        } else {
            setDisOption({ ...disOptions, [event.target.name]: event.target.value });
        }
    }

    const handleDropDowns = (value, event) => {
        setDisOption({ ...disOptions, [event.name]: value });
        if (event.name == "ssid") { setCnew(value); }
    }

    const whOnchange = (val) => {
        setWhval(prevCheck => !prevCheck);
        val ? setDisOption({ ...disOptions, wifi: '1' }) : setDisOption({ ...disOptions, wifi: '0' });
    }

    const rtspOnchange = (val) => {
        setRtspVal(prevCheck => !prevCheck);
        val ? setDisOption({ ...disOptions, rtsp: '1' }) : setDisOption({ ...disOptions, rtsp: '0' });
    }
    const rtsp_ncOnchange = (val) => {
        setRtspVal_nc(prevCheck => !prevCheck);
    }

    return (
        <React.Fragment>
            <div>
                <PageHeader
                    className="site-page-header"
                    title="Network Settings"
                    extra={[
                        <ButtonAnt key="1" className='cus-btn1' type="primary" onClick={apply}>
                            Apply
                </ButtonAnt>,
                    ]}
                    style={{ padding: "0", marginBottom: "1rem" }}
                />
                <Row>
                    <Col lg={6}>
                        <Divider orientation="left" style={{ borderColor: "#121212", fontWeight: "900", fontWeight: "900", marginBottom: '8px' }}>Device IP Configurations</Divider>
                        <div className="d-grid">
                            {/* <div className="d-inline-block my-2">
                                <Label>IP Assignment</Label>
                                <Select placeholder="IP Assignment" value={disOptions.ipassign} style={{ width: "100%" }} onSelect={(value, event) => handleDropDowns(value, event)}>
                                    <Option name="ipassign" value="dhcp">Automatic(DHCP)</Option>
                                    <Option name="ipassign" value="manual">Manual</Option>
                                </Select>
                            </div> */}
                            <div className="d-inline-block my-2">
                                <Label>IPV4/IPV6 Address</Label><Input disabled={disOptions.ipassign == 'dhcp' ? true : false} value={disOptions.ipadd} onChange={handleonChange} name='ipadd' placeholder="IPV4/IPV6 Address" />
                            </div>
                            <div className="d-inline-block my-2">
                                <Label>Subnet Mask</Label><Input disabled={disOptions.ipassign == 'dhcp' ? true : false} value={disOptions.subnet} onChange={handleonChange} name='subnet' placeholder="Subnet Mask" />
                            </div>
                            <div className="d-inline-block my-2">
                                <Label>Default Gateway</Label><Input disabled={disOptions.ipassign == 'dhcp' ? true : false} value={disOptions.dgate} onChange={handleonChange} name='dgate' placeholder="Default Gateway" />
                            </div>
                            <div className="d-inline-block my-2">
                                <Label>DNS</Label><Input disabled={disOptions.ipassign == 'dhcp' ? true : false} value={disOptions.dns} onChange={handleonChange} name='dns' placeholder="DNS" />
                            </div>
                        </div>

                    </Col>
                    <Col lg={6}>
                        <Divider orientation="left" style={{ borderColor: "#121212", fontWeight: "900", fontWeight: "900" }}>Network Camera</Divider>

                        <div className="d-flex my-3 w-100">
                            <Label>Enable Network Cameras:</Label><Switch className="mx-3" checked={rtspval} onChange={rtspOnchange} checkedChildren="On" unCheckedChildren="Off" />
                        </div>
                        {rtspval && <><div className="d-inline-block my-3 w-100">
                            <Label>RTSP Link</Label><Input disabled={!rtspval} value={disOptions.rtsplink} onChange={handleonChange} name='rtsplink' placeholder="rtsp://XXX.XXX.X.X/X" />
                        </div>
                            <div className="d-inline-block my-3 w-100">
                                <Label>RTSP Link 2</Label><Input disabled={!rtspval} value={disOptions.rtsplink2} onChange={handleonChange} name='rtsplink2' placeholder="rtsp://XXX.XXX.X.X/X" />
                            </div></>}
                        <div className="d-flex my-3 w-100">
                            <Label>Enable Private Network for Cameras:</Label><Switch className="mx-3 " disabled={!rtspval} checked={rtspval_nc} onChange={rtsp_ncOnchange} checkedChildren="On" unCheckedChildren="Off" />
                        </div>
                        {rtspval_nc && <><div className="d-inline-block my-3 w-100">
                            <Label>IPV4/IPV6 Address</Label><Input disabled={!rtspval} value={disOptions.ipadd_rtsp} onChange={handleonChange} name='ipadd_rtsp' placeholder="IPV4/IPV6 Address for RTSP" />
                        </div>
                            <div className="d-inline-block my-3 w-100">
                                <Label>Subnet Mask</Label><Input disabled={!rtspval} value={disOptions.subnet_rtsp} onChange={handleonChange} name='subnet_rtsp' placeholder="Subnet Mask for RTSP" />
                            </div></>}
                        {/* <div className="d-grid">
                            <div className="d-inline my-2">
                                <Label>WiFi Toggle:</Label><Switch className="mx-3" checked={whval} onChange={whOnchange} checkedChildren="On" unCheckedChildren="Off" />
                            </div>
                            <div className="d-inline-block my-2">
                                <Label>SSID</Label>
                                <Select showSearch defaultActiveFirstOption disabled={!whval} placeholder="SSID" value={disOptions.ssid} style={{ width: "100%" }} onSelect={(value, event) => handleDropDowns(value, event)}>
                                    <Option name="ssid" value="new">Create New</Option>
                                    {ssidlist.map(({ name, value, id }) => (
                                        <Option name="ssid" key={id} value={value}>
                                            {name}
                                        </Option>
                                    ))}

                                </Select>
                            </div>
                            <div className={disOptions.ssid == "new" ? "d-inline-block my-2" : "d-none"}>
                                <Label>SSID</Label><Input value={cnew} onChange={handleonChange} name='ssid' disabled={!whval} />
                            </div>
                            <div className="d-inline-block my-2">
                                <Label>Username</Label><Input value={disOptions.username} onChange={handleonChange} name='username' disabled={!whval} />
                            </div>
                            <div className="d-inline-block my-2">
                                <Label>Password</Label><Input.Password value={disOptions.pass} onChange={handleonChange} name='pass' disabled={!whval} />
                            </div>
                            <ButtonAnt className='cus-btn1' disabled={!whval} className="my-4" key="1" type="primary" onClick={() => {
                                console.log("apply");
                            }}>
                                Connect
                            </ButtonAnt>
                        </div> */}
                    </Col>
                </Row>
            </div>
        </React.Fragment >
    );
};

export default withRouter(Dis);

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
import SettingsCtrl from "../../controllers/Settings_ctrl";
import { Button as ButtonAnt, Input as InputAnt, Divider, Select, PageHeader, Input, Typography, Switch, message } from 'antd';

const Es = () => {

    const [encodeOptions, setEncodeOption] = useState({
        bitrate: '',
        vcs: '',
        profile: '',
        frpresentation: '',
        frpresenter: '',
        fformat: '',
        resolution: '',
        userid: ''
    });

    const handleDropDowns = (value, event) => {
        console.log(event.name);

        setEncodeOption({ ...encodeOptions, [event.name]: value });
        console.log(encodeOptions);

    }
    // const handleLoad = (value, event) => {
    //     console.log(event);

    //     setEncodeOption({ ...encodeOptions, [event]: value });

    // }
    const { Option } = Select;

    useEffect(() => {
        loadSettings();

    }, []);

    const loadSettings = () => {
        SettingsCtrl.EsGet(1).then((res) => {
            // Get array and create object with needed values
            let data = res.reduce((acc, cur) => ({ ...acc, [cur.title]: cur.s_value }), {})
            console.log(res);

            setEncodeOption({
                bitrate: data.bitrate,
                vcs: data.vcs,
                profile: data.profile,
                frpresentation: data.frpresentation,
                frpresenter: data.frpresenter,
                fformat: data.fformat,
                resolution: data.resolution,
                userid: res[0].userid
            })
        })
    }

    const applys = () => {
        SettingsCtrl.EsApply(encodeOptions).then((res) => {
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

    return (
        <React.Fragment>
            <div>
                <PageHeader
                    className="site-page-header"
                    title="Encoder Settings"
                    extra={[
                        <ButtonAnt key="1" className='cus-btn1' type="primary" onClick={applys}>
                            Apply
                </ButtonAnt>,
                    ]}
                    style={{ padding: "0", marginBottom: "3rem" }}
                />
                <Row>
                    <Col lg={6}>
                        <div className="d-grid">
                            <div className="d-inline-block my-2">
                                <Label>Bitrate</Label>
                                <Select value={encodeOptions.bitrate} style={{ width: "100%" }} onSelect={(value, event) => handleDropDowns(value, event)}>
                                    <Option name='bitrate' value="4000000">4Mb</Option>
                                    <Option name='bitrate' value="3000000">3Mb</Option>
                                    <Option name='bitrate' value="2000000">2Mb</Option>
                                    <Option name='bitrate' value="1500000">1.5Mb</Option>
                                </Select>
                            </div>
                            <div className="d-inline-block my-2">
                                <Label>Video Compression Standard</Label>
                                <Select disabled={true} value={encodeOptions.vcs} style={{ width: "100%" }} onSelect={(value, event) => handleDropDowns(value, event)}>
                                    <Option name='vcs' value="h264">H.264</Option>
                                    <Option name='vcs' value="h265">H.265</Option>
                                </Select>
                            </div>
                            <div className="d-inline-block my-2">
                                <Label>Profile</Label>
                                <Select disabled={true} value={encodeOptions.profile} style={{ width: "100%" }} onSelect={(value, event) => handleDropDowns(value, event)}>
                                    <Option name='profile' value="0">Baseline</Option>
                                    <Option name='profile' value="2">Main</Option>
                                    <Option name='profile' value="4">High</Option>
                                </Select>
                            </div>
                            <div className="d-inline-block my-2">
                                <Label>Framerate: Presentation</Label>
                                <Select value={encodeOptions.frpresentation} style={{ width: "100%" }} onSelect={(value, event) => handleDropDowns(value, event)}>
                                    <Option name='frpresentation' value="20">20</Option>
                                    <Option name='frpresentation' value="25">25</Option>
                                    <Option name='frpresentation' value="30">30</Option>
                                </Select>
                            </div>
                            <div className="d-inline-block my-2">
                                <Label>Framerate: Presenter</Label>
                                <Select value={encodeOptions.frpresenter} style={{ width: "100%" }} onSelect={(value, event) => handleDropDowns(value, event)}>
                                    <Option name='frpresenter' value="20">20</Option>
                                    <Option name='frpresenter' value="25">25</Option>
                                    <Option name='frpresenter' value="30">30</Option>
                                </Select>
                            </div>
                        </div>
                    </Col>
                    <Col lg={6}>
                        <div className="d-grid">
                            <div className="d-inline-block my-2">
                                <Label>File Format</Label>
                                <Select disabled={true} value={encodeOptions.fformat} style={{ width: "100%" }} onSelect={(value, event) => handleDropDowns(value, event)}>
                                    <Option name='fformat' value="mp4">MP4</Option>
                                    <Option name='fformat' value="ts">TS</Option>
                                </Select>
                            </div>
                            <div className="d-inline-block my-2">
                                <Label>Resolution</Label>
                                <Select disabled={true} value={encodeOptions.resolution} style={{ width: "100%" }} onSelect={(value, event) => handleDropDowns(value, event)}>
                                    <Option name='resolution' value="1080">1080P</Option>
                                    <Option name='resolution' value="720">720P</Option>
                                </Select>
                            </div>
                        </div>
                    </Col>
                </Row>
            </div>
        </React.Fragment >
    );
};

export default withRouter(Es);

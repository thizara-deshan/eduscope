import React, { useMemo, useState, useEffect } from "react";
import {
    Row,
    Col,
    Container,
    Label,
    FormGroup,
} from "reactstrap";
import { withRouter, Link, useHistory } from 'react-router-dom'
import { Button as ButtonAnt, Input as InputAnt, TimePicker, PageHeader, DatePicker, Tag, message, Typography } from 'antd';
import moment from "moment-timezone";
import TimezoneSelect, { allTimezones } from "react-timezone-select";
import SettingsCtrl from "../../controllers/Settings_ctrl";

const Sys = () => {

    const { Text } = Typography;
    const [tz, setTz] = useState(
        Intl.DateTimeFormat().resolvedOptions().timeZone
    );
    const [datetime, setDatetime] = useState(moment());
    const [srval, setIuval] = useState(false);

    useMemo(() => {
        const tzValue = tz.value ?? tz;
        setDatetime(datetime.tz(tzValue));
    }, [tz, datetime]);

    const onChange = (val) => {
        console.log(val);
    }


    const [sysOptions, setSysOption] = useState({
        dl: '',
        userid: ''
    });

    useEffect(() => {
        loadSettings();
    }, []);

    const loadSettings = () => {
        SettingsCtrl.SysGet(1).then((res) => {
            // Get array and create object with needed values
            let data = res.reduce((acc, cur) => ({ ...acc, [cur.title]: cur.s_value }), {})
            setSysOption({
                dl: data.dl,
                userid: res[0].userid
            })
        })
    }

    const apply = () => {
        SettingsCtrl.SysApply(sysOptions).then((res) => {
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

        setSysOption({ ...sysOptions, [event.target.name]: event.target.value });
        console.log(sysOptions);
    }

    return (
        <React.Fragment>
            <div>
                <PageHeader
                    className="site-page-header"
                    title="System Settings"
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
                            <div className="d-inline mt-4">
                                <Label>Date and Time:</Label> <Text code><strong className="mx-2">{tz.value ? tz.value.split("/")[1] : tz.split("/")[1]}:{" "}</strong>
                                    <strong>{datetime.format("DD-MM-YYYY HH:mm")}</strong></Text>
                            </div>
                            <div className="d-inline mt-4">
                                <Label>Time Zone:</Label>
                                <TimezoneSelect
                                    value={tz}
                                    onChange={setTz}
                                    timezones={{
                                        ...allTimezones,
                                        "America/Lima": "Pittsburgh",
                                        "Europe/Berlin": "Frankfurt"
                                    }}
                                />
                            </div>
                            <div className="d-inline mt-4">
                                <Label>Set Date:</Label> <DatePicker onChange={onChange} defaultValue={moment()} />
                            </div>
                            <div className="d-inline mt-4">
                                <Label>Set Time:</Label> <TimePicker onChange={onChange} defaultValue={moment()} format="HH:mm A" />
                            </div>
                            <div className="d-inline mt-4">
                                <Label>Device Location:</Label> <InputAnt value={sysOptions.dl} onChange={handleonChange} name='dl' className="" />
                            </div>
                        </div>
                    </Col>
                    <Col lg={6}>
                        <div className="d-grid">
                            <h5>LICENSE</h5>
                            <div className="d-inline mt-4">
                                <Label>Status:</Label>  <Tag color="#87d068">Genuine</Tag>
                            </div>
                            <div className="d-inline mt-4">
                                <Label>Warranty:</Label>  <Tag color="#87d068">265 Days</Tag>
                            </div>
                            <div className="d-inline mt-4">
                                <Label>Last Checked:</Label>  <strong>{moment().format('DD-MM-YYYY HH:mm')}</strong>
                            </div>
                        </div>
                    </Col>
                </Row>
            </div>
        </React.Fragment >
    );
};

export default withRouter(Sys);

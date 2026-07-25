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
import { Button as ButtonAnt, Input as InputAnt, Divider, Modal, Select, PageHeader, message, Progress, Switch, Typography } from 'antd';
import SettingsCtrl from "../../controllers/Settings_ctrl";

const Lss = () => {

    const { Text } = Typography;
    const [delufval, setDelufval] = useState(true);
    const [rusbval, setRusbval] = useState(false);
    const { Option } = Select;
    const { confirm } = Modal;

    const [storageData, setStorageData] = useState({
        size: 30531596,
        avail: 13497312,
        pecnt: '54%'
    });

    const [lssOptions, setLssOption] = useState({
        duf: '',
        fdd: '',
        userid: ''
    });

    useEffect(() => {
        loadSettings();
        getStorage()
    }, []);

    const key = 'loading'

    const getStorage = () => {
        SettingsCtrl.getStorage().then((res) => {
            let data = res.data.split(' ').filter(i => i);
            setStorageData({
                size: parseInt(data[0]),
                avail: parseInt(data[1]),
                pecnt: data[2]
            })
        })
    }

    const loadSettings = () => {
        SettingsCtrl.LssGet(1).then((res) => {
            // Get array and create object with needed values
            let data = res.reduce((acc, cur) => ({ ...acc, [cur.title]: cur.s_value }), {})
            console.log(res);
            if (data.duf == '1') {
                setDelufval(true)
            }
            setLssOption({
                duf: data.duf,
                fdd: data.fdd,
                userid: res[0].userid
            })
        })
    }

    const apply = () => {
        SettingsCtrl.LssApply(lssOptions).then((res) => {
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

    const genhddid = () => {
        message.loading({ content: 'Setting Up New ID...', key, duration: 0 })
        SettingsCtrl.GenNewID().then((res) => {
            if (res.success) {
                message.loading({ content: 'Restarting Server...', key, duration: 12 }).then(() => message.success({ content: 'ID Updated', key, duration: 1 }))
                loadSettings();
            } else {
                message.error({ content: 'Something went wrong', key, duration: 1 })
            }
        }).catch((err) => {
            console.log(err);
            message.error({ content: 'Something went wrong', key, duration: 1 })
        })
    }

    const confirmFormat = () => {
        // e.preventDefault()
        confirm({
            title: 'Are you sure to format the hard disk?',
            content: 'All files in hard disk will deleted.',
            okText: 'Yes',
            cancelText: 'No',
            onOk() {
                formathdd()
            }
        });

    }

    const formathdd = () => {
        message.loading({ content: 'Formatting Hard Disk...', key, duration: 0 })
        SettingsCtrl.FormatHDD().then((res) => {
            if (res.success) {
                message.success({ content: 'Success! Click "Set New Hard Disk ID"', key, duration: 1 })
                loadSettings();
            } else {
                message.error({ content: 'Something went wrong', key, duration: 1 })
            }
        }).catch((err) => {
            console.log(err);
            message.error({ content: 'Something went wrong', key, duration: 1 })
        })
    }

    const handleDropDowns = (value, event) => {
        console.log(event.name);

        setLssOption({ ...lssOptions, [event.name]: value });
        console.log(lssOptions);

    }

    const delufOnchange = (val) => {
        setDelufval(prevCheck => !prevCheck);
        val ? setLssOption({ ...lssOptions, duf: '1' }) : setLssOption({ ...lssOptions, duf: '0' });

    }

    return (
        <React.Fragment>
            <div>
                <PageHeader
                    className="site-page-header"
                    title="Local Storage Settings"
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
                                <Label>Delete Uploaded Files:</Label><Switch disabled={true} className="mx-3" checked={delufval} onChange={delufOnchange} checkedChildren="On" unCheckedChildren="Off" />
                            </div>

                            <ButtonAnt key="1" className="mt-4 w-50 px-1 cus-btn1" type="default" onClick={confirmFormat}>
                                Format Local Storage
                            </ButtonAnt>
                            <ButtonAnt key="1" className="mt-4 w-50 px-1 cus-btn1" type="default" onClick={genhddid}>
                                Set New Hard Disk ID.
                            </ButtonAnt>
                        </div>
                    </Col>
                    <Col lg={6}>
                        <div className="d-grid">
                            <div className="d-inline-block my-2">
                                <Label>File Deletion Delay</Label>
                                <Select disabled={true} placeholder="IP Assignment" value={lssOptions.fdd} style={{ width: "100%" }} onSelect={(value, event) => handleDropDowns(value, event)}>
                                    <Option name='fdd' value="24H">24H</Option>
                                    <Option name='fdd' value="3Day">3 Day</Option>
                                    <Option name='fdd' value="7Day">7 Day</Option>
                                </Select>
                            </div>
                            <div className="d-inline-block my-2">
                                <Label>Disk Information</Label><Progress strokeLinecap="square" percent={100 - Math.round((storageData.avail / storageData.size) * 100, 2)} />
                                <Text code style={{ color: "#121212" }}>{Math.round(storageData.avail / Math.pow(1024, 2), 2)}GB/{Math.round(storageData.size / Math.pow(1024, 2), 2)}GB Available</Text>
                            </div>

                        </div>
                    </Col>
                </Row>
            </div>
        </React.Fragment >
    );
};

export default withRouter(Lss);

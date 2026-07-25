import React, { useState } from "react";
import {
    Row,
    Col,
    Container,
    Label,
    FormGroup,
} from "reactstrap";
import { withRouter, Link, useHistory } from 'react-router-dom'
import { Button as ButtonAnt, Input as InputAnt, Select, PageHeader, Upload, message, Progress, Statistic, Typography } from 'antd';
import { UploadOutlined } from '@ant-design/icons';
import SettingsCtrl from "../../controllers/Settings_ctrl";
import axios from 'axios';
import moment from 'moment';

const Fu = () => {

    const { Countdown } = Statistic;
    const { Text } = Typography;
    const [loading, setLoading] = useState(false);
    const [updateTxt, setUpdateTxt] = useState('Check for Update');
    const [updateAvailable, setUpdateAvailable] = useState('');
    const [defaultFileList, setDefaultFileList] = useState([]);

    const checkupdate = () => {
        setUpdateTxt('Checking...')
        setLoading(true)

        SettingsCtrl.FuUpdate().then((res) => {
            if (res.success) {
                if (res.code == 200) {
                    setUpdateTxt('Updating...')
                    setUpdateAvailable('Updates Available. Finished In 10mins. Do not Turn off or Go Back.');
                    setTimeout(
                        () => {
                            setUpdateTxt('Check for Update')
                            setLoading(false);
                            setUpdateAvailable('Update Successful. Press Ctrl + F5 to Refresh')
                        },
                        10 * 60 * 1000
                    );
                } else if (res.code == 502) {
                    setUpdateTxt('Check for Update');
                    setUpdateAvailable('Unable to fetch update from Server. Check the device has proper internet connectivity');
                    setLoading(false)
                } else {
                    setUpdateTxt('Check for Update');
                    setUpdateAvailable('No Updates Available.');
                    setLoading(false)
                }
            } else {
                message.error('Error While Updating. Contact Support', 1);
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
                    title="Firmware Update"
                    extra={[
                        <ButtonAnt key="1" className='cus-btn1' type="primary" onClick={() => { console.log("apply"); }}>
                            Apply
                </ButtonAnt>,
                    ]}
                    style={{ padding: "0", marginBottom: "3rem" }}
                />
                <Row>
                    <Col lg={6}>
                        <div className="d-grid">
                            <div className="d-inline mt-1">
                                <ButtonAnt key="1" className='cus-btn1' loading={loading} type="primary" onClick={checkupdate}>
                                    {updateTxt}
                                </ButtonAnt>
                            </div>
                            <Text className={updateAvailable ? "my-2" : "d-none"} code>{updateAvailable}</Text>
                            {updateTxt == 'Updating...' ? <Countdown format='mm:ss' value={moment().add(10, 'minutes')} /> : <></>}
                            {/* <div className="d-inline mt-4">
                                <Label>Upload From File:</Label>
                                <div className="mt-2">
                                    <Upload
                                        customRequest={uploadImage}
                                        onChange={handleOnChange}
                                        defaultFileList={defaultFileList}
                                        beforeUpload={bforeup}
                                    >
                                        {defaultFileList.length >= 1 ? null : <ButtonAnt className='cus-btn1' icon={<UploadOutlined />}>Select File</ButtonAnt>}
                                    </Upload>
                                    <ButtonAnt
                                        className='cus-btn1'
                                        type="primary"
                                        onClick={uploadImage}
                                        disabled={defaultFileList.length === 0}
                                        loading={progress}
                                        style={{ marginTop: 16 }}
                                    >
                                        {progress ? 'Uploading' : 'Start Upload'}
                                    </ButtonAnt>
                                    {progress > 0 ? <Progress percent={progress} /> : null}
                                </div>
                            </div> */}
                        </div>
                    </Col>
                </Row>
            </div>
        </React.Fragment >
    );
};

export default withRouter(Fu);

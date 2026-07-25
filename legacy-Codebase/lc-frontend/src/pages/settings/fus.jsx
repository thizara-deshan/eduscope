import React, { useState, useEffect } from "react";
import {
    Row,
    Col,
    Container,
    Label,
    FormGroup,
} from "reactstrap";
import { Link, useHistory } from "react-router-dom";
import moment from 'moment';
import { withRouter } from 'react-router-dom'
import { Button as ButtonAnt, Input as InputAnt, TimePicker, Select, PageHeader, message, DatePicker, Alert, Switch, Typography } from 'antd';
import SettingsCtrl from "../../controllers/Settings_ctrl";

const Fus = () => {

    const { Text } = Typography;
    const [iuval, setIuval] = useState(false);
    const [suval, setSuval] = useState(false);
    // const [sauval, setSauval] = useState(false);
    const [utval, setUtval] = useState([]);
    const [utval2, setUtval2] = useState([]);
    const [utfval, setUtfval] = useState('');
    const [utfval2, setUtfval2] = useState('');
    const [uidval, setUidval] = useState(0);
    const [upDomain, setUpDomain] = useState(0);
    const { Option } = Select;


    const [fusOptions, setFusOption] = useState({
        iu: '',
        su: '',
        ut: '',
        ut2: '',
        // sau:'',
        userid: ''
    });

    useEffect(() => {
        loadSettings();
    }, []);

    const loadSettings = () => {
        SettingsCtrl.FusGet(1).then((res) => {
            // Get array and create object with needed values
            let data = res.reduce((acc, cur) => ({ ...acc, [cur.title]: cur.s_value }), {})
            console.log(data);
            if (data.iu == '1') {
                setIuval(true)
            }
            if (data.su == '1') {
                setSuval(true)
            } if (data.domain != 'false') {
                setUpDomain(1)
            }
            setUidval(res[0].userid)
            setFusOption({
                iu: data.iu,
                su: data.su,
                ut: data.ut,
                ut2: data.ut2,
                // sau:data.sau,
                userid: res[0].userid
            })
            var arr = (data.ut).split(',');
            var arr2 = (data.ut2).split(',');
            console.log();

            setUtval([moment(moment.unix(arr[0]).format('h A'), 'h A'), moment(moment.unix(arr[1]).format('h A'), 'h A')])
            setUtval2([moment(moment.unix(arr2[0]).format('h A'), 'h A'), moment(moment.unix(arr2[1]).format('h A'), 'h A')])
            console.log(fusOptions);

        })
    }

    const apply = () => {
        // below not needed
        setFusOption({ ...fusOptions, ut: utfval, ut2: utfval2, userid: uidval })

        SettingsCtrl.FusApply(fusOptions).then((res) => {
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

        // setFusOption({ ...fusOptions, [event.target.name]: event.target.value });
        // console.log(fusOptions);

    }

    useEffect(() => {
        console.log(suval);
        if (!suval) { setFusOption({ ...fusOptions, su: '0' }); }
        if (!iuval) { setFusOption({ ...fusOptions, iu: '0' }); }
    }, [suval, iuval])


    const iuOnchange = (val) => {
        if (val) {
            setSuval(false);
        }
        setIuval(prevCheck => !prevCheck);
        val ? setFusOption({ ...fusOptions, iu: '1' }) : setFusOption({ ...fusOptions, iu: '0' });
        console.log(fusOptions);
    }

    const suOnchange = (val) => {
        if (val) {
            setIuval(false);
        }
        setSuval(prevCheck => !prevCheck);
        val ? setFusOption({ ...fusOptions, su: '1' }) : setFusOption({ ...fusOptions, su: '0' });
        console.log(suval);
    }
    // const sauOnchange = (val) => {
    //     setSauval(prevCheck => !prevCheck);
    //     val ? setFusOption({ ...fusOptions, sau: '1' }) : setFusOption({ ...fusOptions, sau: '0' });
    //     console.log(suval);
    // }


    return (
        <React.Fragment>
            <div>
                <PageHeader
                    className="site-page-header"
                    title="File Upload Settings"
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
                            {!upDomain && <Alert message="Uploads Disabled." description="Contact Eduscope to configure uploading settings." type="info" showIcon />}

                            <div className="d-inline mt-4">
                                <Label>Instant Upload:</Label><Switch className="mx-3" checked={iuval} disabled={!upDomain} onChange={iuOnchange} checkedChildren="On" unCheckedChildren="Off" />
                            </div>
                            <div className="d-inline my-4">
                                <Label>Scheduled Upload:</Label><Switch className="mx-3" checked={suval} disabled={!upDomain} onChange={suOnchange} checkedChildren="On" unCheckedChildren="Off" />
                            </div>
                            <div className="d-inline-block my-2">
                                <Label>Upload Timeframe:</Label>
                                <TimePicker.RangePicker className="mx-2" value={utval} onChange={(value, dateString) => {
                                    setUtval([moment(dateString[0], 'h A'), moment(dateString[1], 'h A')]);
                                    console.log(utval);

                                    setUtfval(dateString.toString());
                                    setFusOption({ ...fusOptions, ut: `${value[0].unix()},${value[1].unix()}` });
                                }} disabled={!suval || !upDomain} format='h A' style={{ width: 200 }} />

                            </div>
                            <div className="d-inline-block my-2">
                                <Label>Backup Upload Timeframe:</Label>
                                <TimePicker.RangePicker className="mx-2" value={utval2} onChange={(value, dateString) => {
                                    setUtval2([moment(dateString[0], 'h A'), moment(dateString[1], 'h A')]);
                                    console.log(utval2);

                                    setUtfval2(dateString.toString());
                                    setFusOption({ ...fusOptions, ut2: `${value[0].unix()},${value[1].unix()}` });
                                }} disabled={!suval || !upDomain} format='h A' style={{ width: 200 }} />
                            </div>
                            {/* <div className="d-inline my-4">
                                <Label>Shutdown After Upload:</Label><Switch className="mx-3" checked={sauval} onChange={sauOnchange} disabled={!suval || !upDomain} checkedChildren="On" unCheckedChildren="Off" />
                            </div> */}
                        </div>
                    </Col>
                </Row>
            </div>
        </React.Fragment >
    );
};

export default withRouter(Fus);

import React, { useState } from "react";
import {
    Row,
    Col,
    Container,
    Label,
    FormGroup,
} from "reactstrap";
import { withRouter, Link, useHistory } from 'react-router-dom'
import { Button as ButtonAnt, Input as InputAnt, TimePicker, Select, PageHeader, Input, Progress, Switch, Typography } from 'antd';

const Us = () => {

    const [srval, setIuval] = useState(false);
    const srOnchange = (val) => {
        setIuval(prevCheck => !prevCheck);
    }

    return (
        <React.Fragment>
            <div>
                <PageHeader
                    className="site-page-header"
                    title="UAC/UVC Selection"
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
                            <div className="d-inline mt-4">
                                <Label>Schedule Recording:</Label><Switch className="mx-3" checked={srval} onChange={srOnchange} checkedChildren="On" unCheckedChildren="Off" />
                            </div>
                        </div>
                    </Col>
                </Row>
            </div>
        </React.Fragment >
    );
};

export default withRouter(Us);

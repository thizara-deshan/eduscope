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
import { Button as ButtonAnt, Input as InputAnt, Skeleton, Avatar, PageHeader, Input, List, Divider, message, Modal, Select, Upload } from 'antd';
import SettingsCtrl from "../../controllers/Settings_ctrl";
import InfiniteScroll from 'react-infinite-scroll-component';
import useAuth from "../../useAuth";
import jwt from 'jwt-decode'
import { UploadOutlined } from '@ant-design/icons';

const Um = () => {

    const { Option } = Select;

    const [userArray, setUserArray] = useState([]);
    const [adminArray, setAdminArray] = useState([]);
    const [userCount, setUserCount] = useState(0);
    const [curLimit, setCurLimit] = useState(0);
    const [editStatus, setEditStatus] = useState(null);
    const { confirm } = Modal;
    const { user } = useAuth();
    const userdata = localStorage.getItem('usertoken');
    let role = user.role || jwt(userdata).role;

    const [fileList, setFileList] = useState([]);
    const [uploading, setUploading] = useState(false);
    const [isValidFile, setValidFile] = useState(false);

    const [umOptions, setUmOption] = useState({
        name: '',
        username: '',
        pass: '',
        role: null
    });

    useEffect(() => {
        loadMoreData();
        countUsers();
    }, []);

    const loadMoreData = (limit) => {
        // if (userArray.length < userCount) {
        try {
            SettingsCtrl.UmLoadUsers([0, 1000]).then((res) => {
                // Get array and create object with needed values
                // let data = res.reduce((acc, cur) => ({ ...acc, [cur.title]: cur.s_value }), {})
                console.log(res);
                setUserArray(res)
                // setCurLimit(curLimit + 10)

            })
            let adminlimit = role == 'dev-admin' ? [0, 1000] : [2, 1000]
            SettingsCtrl.UmLoadAdmins(adminlimit).then((res) => {
                // Get array and create object with needed values
                // let data = res.reduce((acc, cur) => ({ ...acc, [cur.title]: cur.s_value }), {})
                console.log('admins', res);
                setAdminArray(res)
                // setCurLimit(curLimit + 10)

            })
        } catch (error) {
            console.log(error);
            message.error('Something went wrong while fetching data', 1)
        }

        // }
    }

    const countUsers = () => {
        SettingsCtrl.UmCountUsers().then((res) => {
            // Get array and create object with needed values
            // let data = res.reduce((acc, cur) => ({ ...acc, [cur.title]: cur.s_value }), {})
            console.log('-----count', res);
            setUserCount(res[0].userCount)
        })
    }

    const buttonclicked = () => {
        console.log(editStatus);
        if (!umOptions.name || !umOptions.pass || !umOptions.username) {
            message.warning('Fill all the fields', 2)
        }
        else {
            if (!editStatus) { createuser() } else { updateuser() }
        }
    }

    const createuser = () => {
        console.log('role------', umOptions.role);

        if (umOptions.role === 'user') {
            SettingsCtrl.UmCreateUser(umOptions).then((res) => {
                if (res.success) {
                    message.success('User Created', 1);
                    loadMoreData();
                    setUmOption({
                        name: '',
                        username: '',
                        pass: '',
                        role: null
                    });
                } else {
                    message.error('Something went wrong', 1);
                }
            }).catch((err) => {
                console.log(err);
                message.error('Something went wrong', 1);
            })
        } else {
            SettingsCtrl.UmCreateAdmin(umOptions).then((res) => {
                if (res.success) {
                    message.success('User Created', 1);
                    loadMoreData();
                    setUmOption({
                        name: '',
                        username: '',
                        pass: '',
                        role: null
                    });
                } else {
                    message.error('Something went wrong', 1);
                }
            }).catch((err) => {
                console.log(err);
                message.error('Something went wrong', 1);
            })
        }
    }

    const updateuser = () => {
        if (umOptions.role === 'user') {
            SettingsCtrl.UmUpdateUser({ ...umOptions, flogin: false }, editStatus).then((res) => {
                if (res.success) {
                    message.success('User Updated', 1);
                    setEditStatus(null)
                    loadMoreData();
                    setUmOption({
                        name: '',
                        username: '',
                        pass: '',
                        role: null
                    });
                } else {
                    message.error('Something went wrong', 1);
                    setEditStatus(null)
                    setUmOption({
                        name: '',
                        username: '',
                        pass: '',
                        role: null
                    });
                }
            }).catch((err) => {
                console.log(err);
                setEditStatus(null)
                setUmOption({
                    name: '',
                    username: '',
                    pass: '',
                    role: null
                });
                message.error('Something went wrong', 1);
            })
        } else {
            SettingsCtrl.UmUpdateAdmin(umOptions, editStatus).then((res) => {
                if (res.success) {
                    message.success('User Updated', 1);
                    setEditStatus(null)
                    loadMoreData();
                    setUmOption({
                        name: '',
                        username: '',
                        pass: '',
                        role: null
                    });
                } else {
                    message.error('Something went wrong', 1);
                    setEditStatus(null)
                    setUmOption({
                        name: '',
                        username: '',
                        pass: '',
                        role: null
                    });
                }
            }).catch((err) => {
                console.log(err);
                setEditStatus(null)
                setUmOption({
                    name: '',
                    username: '',
                    pass: '',
                    role: null
                });
                message.error('Something went wrong', 1);
            })
        }
    }


    const deleteuser = (id, role) => {
        // e.preventDefault()
        confirm({
            title: 'Are you sure to delete this user?',
            // icon: <ExclamationCircleOutlined />,
            // content: 'Unsaved changes detected.',
            okText: 'Yes',
            cancelText: 'No',
            onOk() {
                confirmdel(id, role)
            }
        });

    }

    const confirmdel = (id, role) => {
        if (role == 'user') {
            SettingsCtrl.UmRemoveUsers({ id: id }).then((res) => {
                console.log(res);

                if (res.success) {
                    message.success('User Deleted', 1);
                    loadMoreData();
                } else {
                    message.error('Something went wrong', 1);
                }
            }).catch((err) => {
                console.log(err);
                message.error('Something went wrong', 1);
            })
        } else {
            SettingsCtrl.UmRemoveAdmins({ id: id }).then((res) => {
                console.log(res);

                if (res.success) {
                    message.success('User Deleted', 1);
                    loadMoreData();
                } else {
                    message.error('Something went wrong', 1);
                }
            }).catch((err) => {
                console.log(err);
                message.error('Something went wrong', 1);
            })
        }
    }

    const edituser = (name, username, id, role) => {
        console.log(name, username, id);
        console.log('ssssss');
        setUmOption({ name: name, username: username, role: role });
        setEditStatus(id)
    }

    const handleonChange = (event) => {
        console.log(event);

        setUmOption({ ...umOptions, [event.target.name]: event.target.value });
        console.log(umOptions);

    }

    const handleDropDowns = (value, event) => {
        setUmOption({ ...umOptions, [event.name]: value });
    }
    // const srOnchange = (val) => {
    //     setSval(prevCheck => !prevCheck);
    //     val ? setUmOption({ ...umOptions, sr: '1' }) : setUmOption({ ...umOptions, sr: '0' });
    // }

    const handleUpload = () => {
        const formData = new FormData();
        fileList.forEach((file) => {
            formData.append('file', file);
        });
        setUploading(true);

        SettingsCtrl.UmUploadExcel(formData)
            .then((res) => {
                console.log(res);
                setFileList([]);
                message.success('Users Uploaded successfully.');
            })
            .catch((err) => {
                console.log(err.message);
                let msg = err.message
                if (err.message == 'Fail to import data into database!' && err.err_code == 'ER_DUP_ENTRY') {
                    msg = 'Some or all usernames already exist in the database'
                }
                message.error('Upload failed: ' + msg);
            })
            .finally(() => {
                setUploading(false);
                loadMoreData();
            });
    };

    const props = {
        onRemove: (file) => {
            const index = fileList.indexOf(file);
            const newFileList = fileList.slice();
            newFileList.splice(index, 1);
            setFileList(newFileList);
        },
        beforeUpload: (file) => {
            setFileList([file]);
            const isEXCEL = file.type === 'application/vnd.ms-excel' || file.type === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
            if (!isEXCEL) {
                message.error(`${file.name} is not a Excel file`);
                setValidFile(false)
            } else {
                setValidFile(true)
            }
            return isEXCEL || Upload.LIST_IGNORE;
        },
        fileList,
    };

    return (
        <React.Fragment>
            <div>
                <PageHeader
                    className="site-page-header"
                    title="Schedule Settings"
                    //     extra={[
                    //         <ButtonAnt key="1" className='cus-btn1' type="primary" onClick={apply}>
                    //             Apply
                    // </ButtonAnt>,
                    //     ]}
                    style={{ padding: "0", marginBottom: "1rem" }}
                />
                <Row>
                    <Col lg={6}>
                        <div className="d-grid">
                            <Divider orientation="left" style={{ borderColor: "#121212", fontWeight: "900", fontWeight: "900" }}>Add Single User</Divider>
                            <div className="d-inline-block my-2">
                                <Label>Name</Label><Input autoComplete="new-password" value={umOptions.name} onChange={handleonChange} name='name' placeholder="Name" />
                            </div>
                            <div className="d-inline-block my-2">
                                <Label>Username</Label><Input autoComplete="new-password" value={umOptions.username} onChange={handleonChange} name='username' placeholder="Username" />
                            </div>
                            <div className="d-inline-block my-2">
                                <Label>Password</Label><Input.Password autoComplete="new-password" onChange={handleonChange} name='pass' placeholder="Password" />
                            </div>
                            <div className="d-inline-block my-2">
                                <Label>Role</Label>
                                <Select placeholder="User Role" disabled={editStatus !== null ? true : false} value={umOptions.role} style={{ width: "100%" }} onSelect={(value, event) => handleDropDowns(value, event)}>
                                    <Option name='role' value="user">User</Option>
                                    <Option name='role' value="admin">Admin</Option>
                                </Select>
                            </div>
                            <ButtonAnt key="1" className='cus-btn1' type="primary" onClick={buttonclicked}>{editStatus !== null ? 'Update User' : 'Create User'}</ButtonAnt>
                        </div>

                    </Col>
                    <Col lg={6}>
                        <Divider orientation="left" style={{ borderColor: "#121212", fontWeight: "900", fontWeight: "900" }}>Users</Divider>
                        <div
                            id="scrollableDiv"
                            style={{
                                height: 360,
                                overflow: 'auto',
                                padding: '0 16px',
                                border: '1px solid rgba(140, 140, 140, 0.35)',
                            }}
                        >
                            <InfiniteScroll
                                dataLength={userArray.length}
                                // next={loadMoreData()}
                                hasMore={userArray.length < userCount}
                                loader={<Skeleton avatar paragraph={{ rows: 1 }} active />}
                                // endMessage={<Divider plain>It is all, nothing more 🤐</Divider>}
                                scrollableTarget="scrollableDiv"
                            >
                                <List
                                    dataSource={userArray}
                                    renderItem={item => (
                                        <List.Item key={item.userid}
                                            actions={[<ButtonAnt onClick={() => { edituser(item.name, item.username, item.userid, 'user') }} className="badge font-size-10 mx-1 btn-icon p-2 bg-info-2 text-soft-info"> <i className="fa fa-pencil-alt"></i></ButtonAnt>, <ButtonAnt onClick={() => { deleteuser(item.userid, 'user') }} className="badge  font-size-10  mx-1 btn-icon p-2 bg-danger-2"> <i className="fa fa-trash"></i></ButtonAnt>]}
                                        >
                                            <List.Item.Meta
                                                avatar={<Avatar />}
                                                title={item.name}
                                                description={item.username}
                                            />
                                            {/* <div>Content</div> */}
                                        </List.Item>
                                    )}
                                />

                            </InfiniteScroll>
                        </div>
                    </Col>
                </Row>
                <Row>
                    <Col lg={6}>
                        <div className="d-grid my-3">
                            <Divider orientation="left" style={{ borderColor: "#121212", fontWeight: "900", fontWeight: "900" }}>Add Multiple Users</Divider>
                            <Upload {...props} maxCount={1} className="my-2">
                                <ButtonAnt icon={<UploadOutlined />}>Select Excel File</ButtonAnt>
                            </Upload>
                            <ButtonAnt
                                type="primary" key="1" className='cus-btn1'
                                onClick={handleUpload}
                                disabled={fileList.length === 0 || !isValidFile}
                                loading={uploading}
                                style={{
                                    marginTop: 16,
                                }}
                            >
                                {uploading ? 'Uploading' : 'Start Upload'}
                            </ButtonAnt>
                        </div>
                    </Col>

                    <Col lg={6}>
                        <div className="d-grid my-3">

                            <Divider orientation="left" style={{ borderColor: "#121212", fontWeight: "900", fontWeight: "900" }}>Admins</Divider>
                            <div
                                id="scrollableDiv"
                                style={{
                                    height: 280,
                                    overflow: 'auto',
                                    padding: '0 16px',
                                    border: '1px solid rgba(140, 140, 140, 0.35)',
                                }}
                            >
                                <InfiniteScroll
                                    dataLength={adminArray.length}
                                    // next={loadMoreData()}
                                    // hasMore={adminArray.length < userCount}
                                    loader={<Skeleton avatar paragraph={{ rows: 1 }} active />}
                                    // endMessage={<Divider plain>It is all, nothing more 🤐</Divider>}
                                    scrollableTarget="scrollableDiv"
                                >
                                    <List
                                        dataSource={adminArray}
                                        renderItem={item => (
                                            <List.Item key={item.userid}
                                                actions={[<ButtonAnt onClick={() => { edituser(item.name, item.username, item.userid, 'admin') }} className="badge font-size-10 mx-1 btn-icon p-2 bg-info-2 text-soft-info"> <i className="fa fa-pencil-alt"></i></ButtonAnt>, <ButtonAnt onClick={() => { deleteuser(item.userid, 'admin') }} className="badge  font-size-10  mx-1 btn-icon p-2 bg-danger-2"> <i className="fa fa-trash"></i></ButtonAnt>]}
                                            >
                                                <List.Item.Meta
                                                    avatar={<Avatar />}
                                                    title={item.name}
                                                    description={item.username}
                                                />
                                                {/* <div>Content</div> */}
                                            </List.Item>
                                        )}
                                    />

                                </InfiniteScroll>
                            </div>
                        </div>
                    </Col>

                </Row>
            </div>
        </React.Fragment >
    );
};

export default withRouter(Um);

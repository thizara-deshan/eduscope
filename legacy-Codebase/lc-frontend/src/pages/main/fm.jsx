import React, { useState, useRef, useEffect } from "react";
import {
    Row,
    Col,
    Container,
    Label,
    FormGroup,
} from "reactstrap";
import { Link, useHistory } from "react-router-dom";
import mp4icon from "../../assets/images/mp4.png"
import { withRouter } from 'react-router-dom'
import fmCtrl from "../../controllers/fm_ctrl";
import ReactPlayer from 'react-player/youtube'
// import video from "/media/5083B23C08062C7D/records/feed1.mp4"
import { Button as ButtonAnt, Input as InputAnt, Divider, Modal, Select, PageHeader, Layout, Alert, Progress, Switch, Typography, message, Badge, Checkbox } from 'antd';
import listReactFiles from 'list-react-files'
import SettingsCtrl from "../../controllers/Settings_ctrl";
import moment from 'moment'
import { ClockCircleOutlined, HourglassOutlined, SaveOutlined, CopyOutlined, CheckCircleTwoTone, ExclamationCircleOutlined } from '@ant-design/icons';
import useAuth from "../../useAuth";
import jwt from 'jwt-decode'
import openSocket from 'socket.io-client';
// jsmpeg

const Fm = () => {
    const socket = useRef();
    const { Header, Content } = Layout;
    const { Option } = Select;
    const { logout, user } = useAuth();
    const userdata = localStorage.getItem('usertoken');
    let role = user.role || jwt(userdata).role;
    const userid = user.user_id || jwt(userdata).user_id;

    const { Text } = Typography;
    const { confirm } = Modal;

    const history = useHistory();
    const [files, setFiles] = useState([]);
    // const [files, setFiles] = useState([{ file: "abcde.mp4", fileSizeInBytes: 132456789 }, { file: "abcde~1.mp4", fileSizeInBytes: 132456789 }, { file: "abcde~2.mp4", fileSizeInBytes: 132456789 }, { file: "abcde.mp4", fileSizeInBytes: 132456789 }]);
    const [playFile, setPlayFile] = useState("");
    const [isLoad, setIsLoad] = useState([]);
    const [checkedList, setCheckedList] = useState([]);
    const [checkedSize, setCheckedSize] = useState(0);
    const [finalVal, setFinalVal] = useState(0);
    const [initialUsage, setInitialUsage] = useState(0);
    const [copyPcnt, setCopyPcnt] = useState(0);
    const [sizeAfterCopy, setSizeAfterCopy] = useState(0);
    const [isCheckAll, setIsCheckAll] = useState(false);
    const [chkdisabled, setChkdisabled] = useState(false);
    const [isCopyFinished, setIsCopyFinished] = useState(false);
    const [isDeleteStart, setIsDeleteStart] = useState(false);
    const [isCopyStart, setIsCopyStart] = useState(false);
    const [storageData, setStorageData] = useState({
        size: 0,
        avail: 0,
        pecnt: '0%',
        name: 'No USB Device Found'
    });

    const key = "loading"



    const loadfiles = () => {
        console.log("called");
        message.loading({ content: 'Loading Files', key, duration: 0 })
        fmCtrl.FmLoadFiles().then((res) => {
            console.log(res);
            let resfiles = res.data;
            if (res.data) {
                message.success({ content: 'Files Loaded', key, duration: 1 })
            } else {
                message.error({ content: 'Oops! Something went wrong! Please Try Again.', key, duration: 2 })
            }

            setFiles(resfiles);
        }).catch((err) => {
            console.log(err);
            message.error({ content: 'Oops! Something went wrong! Please Try Again.', key, duration: 2 })
        })
    }


    // const onBackButtonEvent = (e) => {
    //     e.preventDefault();
    //     if (isCopyStart) {
    //         if (window.confirm("Do you want to go back ?")) {
    //             // setfinishStatus(true)
    //             // your logic
    //             history.push("/menu");
    //         } else {
    //             window.history.pushState(null, null, window.location.pathname);
    //             // setfinishStatus(false)
    //         }
    //     }
    // }

    // useEffect(() => {
    //     window.history.pushState(null, null, window.location.pathname);
    //     window.addEventListener('popstate', onBackButtonEvent);
    //     return () => {
    //         window.removeEventListener('popstate', onBackButtonEvent);
    //     };
    // }, []);

    // if (isCopyStart) {
    //     window.history.pushState(null, null, window.location.href);
    //     window.onpopstate = function () {
    //         history.go(1);
    //     };
    //     window.onbeforeunload = function () {
    //         return "Leave this page ?";
    //     }
    // }

    useEffect(async () => {
        const newsocket = await openSocket(`http://${process.env.REACT_APP_SERVER_IP}:3000`, { transports: ['websocket'] });
        socket.current = await newsocket;
        loadfiles();
        // vidRefPresentation.current.srcObject = '/media/5083B23C08062C7D/records/feed1.mp4';
        // vidRefPresentation.current.play();
        socket.current.emit('usbdetection', true);
        // fmCtrl.FmStopCopyFiless().then((data) => {
        //     console.log(data);

        // })
        checknctslist()
        // setInterval(() => {
        socket.current.off("storagedata").on("storagedata", function (info) {
            console.log('called');
            console.log(info);

            let data = info.result.split(' ').filter(i => i);
            // console.log('data---', data);

            setStorageData({
                size: parseInt(data[0]),
                avail: parseInt(data[1]),
                pecnt: data[2],
                name: info.name
            })
            // console.log(storageData);

        });
        // }, 3000);
        return () => {
            socket.current.off("storagedata")
            socket.current.disconnect();
        }

    }, []);

    const checknctslist = () => {
        fmCtrl.FmGetNonConvertedTS().then(async (res) => {
            let list = res.data;
            let duration = 0;
            console.log(list);

            await Promise.all(list.map((file) => {
                duration += parseInt(file.duration);
            }))
            console.log(duration);

            if (list.length > 0) {
                confirm({
                    title: `${list.length} Non Converted TS Files Detected`,
                    // icon: <ExclamationCircleOutlined />,
                    content: <p>Click Yes to Start File Conversion.<br />Estimated Time: {moment.utc(1000 * (duration * 1.12)).format('mm[m]:ss[s]')}</p>,
                    okText: 'Yes',
                    cancelText: 'No',
                    onOk() {
                        confirmconvert(duration)
                    }
                });
            }
        })
    }

    const confirmconvert = (duration) => {
        console.log('convert started');
        message.loading({ content: 'Please wait... File Conversion in progress', key, duration: duration * 1.12 }).then(() => { message.success({ content: 'File Conversion Completed', key, duration: 1 }); loadfiles() })
        fmCtrl.FmStartConvertTS().then((res) => {
            console.log('---fm convert response---', res);

            if (res.success) {
                message.success({ content: 'File Conversion Completed', key, duration: 1 })
                loadfiles()
            }
        }).catch((err) => {
            console.log(err);
            console.log(err.response);
            if (err.response.status != 504) { // if there is response, it means its not a 50x, but 4xx
                message.warning({ content: 'Something went wrong. Try Refresh', key, duration: 1 })
            } else {   // gets activated on 50x errors, since no response from server

            }
        })
    }

    useEffect(() => {
        getCheckedSize()
        setSizeAfterCopy((100 - Math.round((storageData.avail / storageData.size) * 100, 2)) + Math.round(((checkedSize / 1024) / storageData.size) * 100, 2))
    }, [checkedList])

    useEffect(() => {
        setSizeAfterCopy((100 - Math.round((storageData.avail / storageData.size) * 100, 2)) + Math.round(((checkedSize / 1024) / storageData.size) * 100, 2))
    }, [checkedSize])

    useEffect(() => {
        if (isCopyStart) {
            setCopyPcnt(Math.round((((storageData.size - storageData.avail) - initialUsage) / (finalVal - initialUsage) * 100), 2))
            if (isCopyFinished) {
                console.log('finisehd: ', isCopyFinished);
                setCopyPcnt(100)
                message.success({ content: 'Successfully Copied', key, duration: 1 })
                setTimeout(() => {
                    setIsCopyStart(false)
                    setCopyPcnt(0)

                }, 1500);
            }
        }
    }, [storageData])


    const handleChange = (value) => {
        console.log(`selected ${value}`);
    }

    // const uploadFile = (filename, index) => {
    //     console.log("upload--------", index);
    //     // setUploadingArr([...uploadingArr,filename])
    //     // preventDefault
    //     // message.loading({ content: 'Uploading Video...', key, duration: 0 })
    //     setIsLoad([...isLoad, index])
    //     fmCtrl.FmUploadFiles({ filename: filename }).then((res) => {
    //         console.log(res);
    //         if (res.success) {
    //             // fmCtrl.FmUpdateDB({ filename: filename }).then((res) => {
    //             // console.log(res);
    //             // if (res.success) {
    //             message.success({ content: 'Successfully Uploaded', key, duration: 1 })
    //             setIsLoad(isLoad.filter(item => item !== index));


    //             // } else {
    //             // message.error({ content: 'Something Went Wrong while update DB!', key, duration: 2 })
    //             // }
    //             // setFiles(resfiles);
    //             // }).catch((err) => {
    //             // console.log(err);
    //             // message.error({ content: 'Oops! Something went wrong! Please Try Again.', key, duration: 2 })
    //             // })
    //         } else {
    //             message.error({ content: 'Something Went Wrong while uploading!', key, duration: 2 })
    //             setIsLoad(isLoad.filter(item => item !== index))
    //         }
    //         // let resfiles = 'feed1.mp4, feed2.mp4, feed1.mp4, feed2.mp4, feed1.mp4, feed2.mp4, feed1.mp4, feed2.mp4, feed2.mp4'
    //         // let data = resfiles.split(',');
    //         // console.log(data);
    //     }).catch((err) => {
    //         console.log(err);
    //         message.error({ content: 'Something Went Wrong while uploading!', key, duration: 2 })
    //         setIsLoad(isLoad.filter(item => item !== index))
    //     })
    // }

    const copyFiles = async (filename, index) => {
        console.log("upload--------", index);
        // setUploadingArr([...uploadingArr,filename])
        // preventDefault
        // message.loading({ content: 'Uploading Video...', key, duration: 0 })
        let indexList = checkedList.filter(Number.isInteger);
        console.log(indexList);

        let filenameArr = await files.map((file, index) => {
            if (indexList.includes(index)) {
                console.log('filenames--', file.file);
                return file.file;
            }
        }).filter(notUndefined => notUndefined !== undefined)
        console.log(filenameArr);
        setFinalVal((storageData.size - storageData.avail) + (Math.round(checkedSize / 1024, 0)))
        setInitialUsage(storageData.size - storageData.avail)
        setCheckedList([])
        setIsCheckAll(false)
        setCheckedSize(0)
        message.loading({ content: 'Copying Files', key, duration: 0 })
        setIsCopyFinished(false)
        setIsCopyStart(true)

        // setIsLoad([...isLoad, index])
        fmCtrl.FmCopyFiless({ filename: filenameArr }).then((res) => {
            console.log(res);
            if (res.success) {
                // fmCtrl.FmUpdateDB({ filename: filename }).then((res) => {
                // console.log(res);
                // if (res.success) {
                // message.success({ content: 'Successfully Copied', key, duration: 1 })
                setIsLoad(isLoad.filter(item => item !== index));
                setIsCopyFinished(true)

                // } else {
                // message.error({ content: 'Something Went Wrong while update DB!', key, duration: 2 })
                // }
                // setFiles(resfiles);
                // }).catch((err) => {
                // console.log(err);
                // message.error({ content: 'Oops! Something went wrong! Please Try Again.', key, duration: 2 })
                // })
            } else {
                message.error({ content: 'Something Went Wrong while copying!', key, duration: 2 })
                setIsLoad(isLoad.filter(item => item !== index))
            }
            // let resfiles = 'feed1.mp4, feed2.mp4, feed1.mp4, feed2.mp4, feed1.mp4, feed2.mp4, feed1.mp4, feed2.mp4, feed2.mp4'
            // let data = resfiles.split(',');
            // console.log(data);
        }).catch(async (err) => {
            console.log(err);
            if (err.request) {
                console.log('errooor---- ', err.request);

                await new Promise(resolve => {
                    socket.current.on('copysuccess', (data) => {
                        // message.success({ content: 'Successfully Copied', key, duration: 1 })
                        setIsCopyFinished(true)
                        resolve()

                    })

                });
                console.log('test12');

            } else {
                message.error({ content: 'Something Went Wrong while copying!', key, duration: 2 })
            }
            setIsLoad(isLoad.filter(item => item !== index))
        })
    }

    const deleteFiles = (filename, index) => {
        // e.preventDefault()
        confirm({
            title: 'Are you sure to delete?',
            // icon: <ExclamationCircleOutlined />,
            // content: 'Unsaved changes detected.',
            okText: 'Yes',
            cancelText: 'No',
            onOk() {
                confirmdel(filename, index)
            }
        });

    }

    const confirmdel = async (filename, index) => {
        // setUploadingArr([...uploadingArr,filename])
        // preventDefault
        // message.loading({ content: 'Uploading Video...', key, duration: 0 })
        let indexList = checkedList.filter(Number.isInteger);
        console.log(indexList);

        let filenameArr = await files.map((file, index) => {
            if (indexList.includes(index)) {
                console.log('filenames--', file.file);
                return file.file;
            }
        }).filter(notUndefined => notUndefined !== undefined)
        console.log(filenameArr);
        setCheckedList([])
        setIsCheckAll(false)
        setCheckedSize(0)
        message.loading({ content: 'Deleting Files', key, duration: 0 })
        setIsDeleteStart(true)

        // setIsLoad([...isLoad, index])
        fmCtrl.FmDeleteFiless({ filename: filenameArr, userid: userid }).then((res) => {
            console.log(res);
            if (res.success) {
                // fmCtrl.FmUpdateDB({ filename: filename }).then((res) => {
                // console.log(res);
                // if (res.success) {
                message.success({ content: 'Successfully Deleted', key, duration: 1 })
                setIsLoad(isLoad.filter(item => item !== index));
                setIsDeleteStart(false)
                loadfiles();

                // } else {
                // message.error({ content: 'Something Went Wrong while update DB!', key, duration: 2 })
                // }
                // setFiles(resfiles);
                // }).catch((err) => {
                // console.log(err);
                // message.error({ content: 'Oops! Something went wrong! Please Try Again.', key, duration: 2 })
                // })
            } else {
                message.error({ content: 'Something Went Wrong while deleting!', key, duration: 2 })
                setIsLoad(isLoad.filter(item => item !== index))
                setIsDeleteStart(false)

            }
            // let resfiles = 'feed1.mp4, feed2.mp4, feed1.mp4, feed2.mp4, feed1.mp4, feed2.mp4, feed1.mp4, feed2.mp4, feed2.mp4'
            // let data = resfiles.split(',');
            // console.log(data);
        }).catch(async (err) => {
            console.log(err);
            setIsDeleteStart(false)
            if (err.response.status != 504) { // if there is response, it means its not a 50x, but 4xx
                message.warning({ content: 'Something went wrong. Try Refresh', key, duration: 1 })
                console.log('errooor---- ', err);
            } else {
                message.success({ content: 'Successfully Deleted', key, duration: 1 })
                loadfiles();
            }
            setIsLoad(isLoad.filter(item => item !== index))
        })
    }


    // Bytes conversion
    function formatFileSize(bytes, decimalPoint) {
        if (bytes == 0) return '0 Bytes';
        var k = 1000,
            dm = decimalPoint || 2,
            sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB', 'PB', 'EB', 'ZB', 'YB'],
            i = Math.floor(Math.log(bytes) / Math.log(k));
        return parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + ' ' + sizes[i];
    }

    const getCheckedSize = async () => {
        setChkdisabled(true)
        var size = 0;
        console.log('test1', checkedList);

        var temp = await checkedList.filter(notUndefined => notUndefined !== null).map((value) => {

            size = size + files[value].fileSizeInBytes;
            if (files[value].file.substr(-5) == "2.mp4" || files[value].file.substr(-9) == "2~cmb.mp4") {
                size = size + files[value - 1].fileSizeInBytes;
            }
            console.log('size-- ', size);

        })
        console.log('test2');

        setCheckedSize(size)
        setChkdisabled(false)
        return true;

    }

    const onChangeChk = async (e) => {
        const { value, checked } = e.target;
        console.log(storageData);

        if (checked) {
            setCheckedList([...checkedList, value]);
        } else {
            setCheckedList(checkedList.filter(e => e !== value))
        }

        console.log(checkedList.includes(value));
        console.log(checkedList);

    }

    const checkAll = async () => {
        console.log('chl all');
        setIsCheckAll(!isCheckAll)
        // setCheckedList(fileIndexList)
        let arr = await files.filter(file => { if (role == 'admin') { return true } else if (file.file.split('~')[3] == userid) { return true } else { return false } }).map((file, index) => {
            if (file.file.substr(-5) == "1.mp4" || file.file.substr(-9) == "1~cmb.mp4") {
                return null;
            } else {
                return index
            }
        })
        setCheckedList(arr)
        console.log(checkedList);
        if (isCheckAll) { setCheckedList([]) }

    }

    return (
        <React.Fragment>
            <div>
                <Container className='fw-container'>
                    <Row className="no-gutters">
                        <Col lg={12} className="nopadblock">
                            <div className="p-4 d-flex align-items-center min-vh-100">
                                <div className="w-100">
                                    <Col lg={10} className="bg-white maincontainer mx-auto shadow rounded-3 nopadblock2">
                                        <Layout className="bg-white rounded-3">
                                            <Header className="p-0 h-auto">
                                                <div className="site-page-header-ghost-wrapper">
                                                    <PageHeader
                                                        style={{ background: '#001529' }}
                                                        className="page-header-dark"
                                                        ghost={false}
                                                        title="Eduscope UMS"
                                                        subTitle="File Management"
                                                        extra={[
                                                            <ButtonAnt key="3" disabled={isCopyStart} className='cus-btn1' type="primary" onClick={() => { history.push('/menu') }}
                                                            >
                                                                Main Menu
                                                            </ButtonAnt>,
                                                        ]}
                                                    >
                                                    </PageHeader>
                                                </div>
                                            </Header>
                                            <Content className="my-5" style={{ padding: '0 50px' }}>
                                                <Row className="h-100">
                                                    <Col lg={7} style={{ height: "inherit" }}>
                                                        <Row>
                                                            <Col lg={10} className='d-flex'>
                                                                <ButtonAnt key='1' onClick={copyFiles} className='my-auto' disabled={isCopyStart || storageData.name == 'No USB Device Found'} type="primary">Copy to USB</ButtonAnt>
                                                                <ButtonAnt key='2' className={role == 'admin' ? 'my-auto mx-2' : 'd-none'} onClick={deleteFiles} disabled={isCopyStart || isDeleteStart || checkedList.length === 0} type="primary" danger>Delete</ButtonAnt>
                                                                <Alert className='my-2 mx-3' message="Do Not Refresh or Go Back While Copying in Progress" type="warning" />
                                                            </Col>
                                                            <Col lg={2}>
                                                                <Checkbox onChange={checkAll} checked={isCheckAll} disabled={isCopyStart} className='my-2'>Check All</Checkbox>
                                                            </Col>
                                                        </Row>
                                                        <div className="card-box scroll-bar-cus">
                                                            <Row>
                                                                {/* <div className="cs-recordpiv"></div> */}
                                                                {/* <video className={"recordpiv"} ref={vidRefPresentation}></video> */}
                                                                {files.sort((a, b) => {
                                                                    let nameArrA = a.file.split('~');
                                                                    let nameArrB = b.file.split('~');
                                                                    let RecordDateA = `${nameArrA[4]}-${nameArrA[5]}-${nameArrA[6]} ${nameArrA[7]}:${nameArrA[8]} ${nameArrA[10].substring(0, 2)}`;
                                                                    let RecordDateB = `${nameArrB[4]}-${nameArrB[5]}-${nameArrB[6]} ${nameArrB[7]}:${nameArrB[8]} ${nameArrB[10].substring(0, 2)}`;
                                                                    console.log(RecordDateA);

                                                                    return new Date(RecordDateB) - new Date(RecordDateA);
                                                                }).filter(file => { if (role == 'admin') { return true } else if (file.file.split('~')[3] == userid) { return true } else { return false } }).map((file, index) => {
                                                                    // console.log(file);
                                                                    let samefile = false;
                                                                    let samefileblock = false;
                                                                    let iconPos = false;
                                                                    // console.log("file", file);

                                                                    let priv_filename = "";
                                                                    let next_filename = "";
                                                                    let reduceval = 6;
                                                                    console.log('dddd', file.file.substring(file.file.length - 7));

                                                                    if (file.file.substring(file.file.length - 7) === 'cmb.mp4') {
                                                                        reduceval = 10;
                                                                    }
                                                                    let curr_filename = file.file.substring(0, file.file.length - reduceval)
                                                                    console.log(curr_filename);

                                                                    if (index != files.length - 1) { next_filename = files[index + 1].file.substring(0, files[index + 1].file.length - reduceval) }
                                                                    if (index != 0) { priv_filename = files[index - 1].file.substring(0, files[index - 1].file.length - reduceval) }

                                                                    if (curr_filename == next_filename || curr_filename == priv_filename) {
                                                                        // console.log("----fnme", );
                                                                        // console.log(file.file.substr(-5));
                                                                        if (file.file.substr(-5) == "1.mp4" || file.file.substr(-9) == "1~cmb.mp4") {
                                                                            iconPos = true
                                                                        }
                                                                        if (file.file.substr(-5) == "1.mp4" || file.file.substr(-9) == "1~cmb.mp4") {
                                                                            samefileblock = true

                                                                        }

                                                                        samefile = true;
                                                                    }
                                                                    let ModuleName, TopicName, RecordDate, FileFormat;

                                                                    let nameArr = file.file.split('~');

                                                                    ModuleName = nameArr[0];
                                                                    TopicName = nameArr[1];
                                                                    RecordDate = `${nameArr[4]}-${nameArr[5]}-${nameArr[6]} ${nameArr[7]}:${nameArr[8]} ${nameArr[10].substring(0, 2)}`;
                                                                    FileFormat = nameArr[-1];

                                                                    return (
                                                                        <Row>
                                                                            <Col lg={11}>
                                                                                <div className={samefile ? samefileblock ? "mb-0 bg-samefile file-man-box" : "bg-samefile file-man-box" : "file-man-box"}>
                                                                                    <div className="file-img-box"><img src={mp4icon} alt="icon" /></div>
                                                                                    <div className="file-man-title">
                                                                                        <h5 className="mb-0 text-overflow">Module:<p className="mx-1 mb-0" style={{ fontWeight: "400" }}>{ModuleName}</p></h5>
                                                                                        <h5 className="mb-0 text-overflow">Topic:<p className="mx-1 mb-0" style={{ fontWeight: "400" }}>{TopicName}</p></h5>
                                                                                        <p className="mb-0">

                                                                                            <small>
                                                                                                <Badge
                                                                                                    count={<SaveOutlined />}
                                                                                                    status='success'
                                                                                                    text={formatFileSize(file.fileSizeInBytes, 2)}
                                                                                                /></small>
                                                                                            <small className="mx-2 d-inline-block">
                                                                                                <Badge
                                                                                                    className="mx-1 mb-1"
                                                                                                    count={<ClockCircleOutlined />}
                                                                                                />{RecordDate}
                                                                                            </small>
                                                                                            <small className="mx-2 d-inline-block">
                                                                                                <Badge
                                                                                                    className="mx-1 mb-1"
                                                                                                    count={file.status == 'waiting' ? <HourglassOutlined /> : file.status == 'done' ? <CheckCircleTwoTone /> : <ExclamationCircleOutlined />}
                                                                                                />{file.status == 'waiting' ? 'Waiting Upload' : file.status == 'done' ? 'Uploaded' : 'Failed Upload'}
                                                                                            </small>
                                                                                        </p>
                                                                                    </div>
                                                                                    <div className="file-button-set">
                                                                                        {/* <button disabled={isLoad.includes(index)} title={isLoad.includes(index) ? "Copy in Progress" : "Copy Videos"} onClick={() => { copyFiles(file.file, index) }} style={iconPos ? { position: "absolute", right: "50px", bottom: "40px" } : { position: "relative" }} className={!samefileblock ? "bg-none file-button" : "d-none"}><i className={isLoad.includes(index) ? "fas fa-circle-notch fa-spin" : "fa fa-copy"}></i></button> */}
                                                                                        {/* <button disabled={isLoad.includes(index)} title={isLoad.includes(index) ? "Upload in Progress" : "Upload Videos"} onClick={() => { uploadFile(file.file, index) }} style={iconPos ? { position: "absolute", right: "50px", bottom: "40px" } : { position: "relative" }} className={!samefileblock ? "bg-none file-button" : "d-none"}><i className={isLoad.includes(index) ? "fas fa-circle-notch fa-spin" : "fa fa-upload"}></i></button> */}
                                                                                        <button key={index} title="Play Video" onClick={() => { setPlayFile(file.file) }} className="bg-none file-button"><i className="fa fa-play"></i></button>
                                                                                        <button key={index + 'f'} title="Download Video" onClick={() => window.location.href = `http://${process.env.REACT_APP_SERVER_IP}:3000/record/${file.file}`} className="bg-none file-button"><i className="fa fa-download"></i></button>
                                                                                    </div>
                                                                                </div>
                                                                            </Col>
                                                                            <Col lg={1}>
                                                                                {!iconPos ?
                                                                                    <Checkbox disabled={chkdisabled || isCopyStart} name='vidcheckbox' id={index} value={index} checked={checkedList.includes(index)} onChange={e => onChangeChk(e)} style={iconPos ? { position: "relative", bottom: "20px" } : { position: "relative" }} className={!samefileblock ? "bg-none" : "d-none"}></Checkbox> : <></>
                                                                                }
                                                                            </Col>
                                                                        </Row>
                                                                    )
                                                                })}
                                                                {/* {files.map((file) => (
                                                                <Row>
                                                                    <div className="file-man-box">
                                                                        <div className="file-img-box"><img src={mp4icon} alt="icon" /></div>
                                                                        <div className="file-man-title">
                                                                            <h5 className="mb-0 text-overflow">efsggeg</h5>
                                                                            <p className="mb-0"><small>{formatFileSize(123456789, 2)}</small></p>
                                                                        </div>
                                                                        <div className="file-button-set">
                                                                            <button title="Upload Video" onClick={() => { uploadFile("file.file") }} className="bg-none file-button"><i className="fa fa-upload"></i></button>
                                                                            <button title="Play Video" onClick={() => { setPlayFile("file") }} className="bg-none file-button"><i className="fa fa-play"></i></button>
                                                                        </div>

                                                                    </div>
                                                                </Row>
                                                                ))} */}
                                                            </Row>
                                                        </div>
                                                    </Col>
                                                    {/* <Col lg={2}> */}
                                                    {/* <div className="d-grid h-100">
                                                            <ButtonAnt className="my-auto cus-btn1">
                                                                Live
                                                        </ButtonAnt>
                                                            <ButtonAnt className="my-auto cus-btn1">
                                                                Switch
                                                        </ButtonAnt>
                                                        </div> */}
                                                    {/* </Col> */}
                                                    <Col lg={5} className="pt-4 jusitify-content-center align-items-center">

                                                        <div style={{ position: 'relative', paddingBottom: '56.25%', height: '0' }}>
                                                            <video style={{ borderRadius: "6px", position: 'absolute', top: "0", left: '0' }} src={`http://${process.env.REACT_APP_SERVER_IP}:3000/record/${playFile}`} controlsList="nodownload" autoPlay width="100%" controls></video>
                                                        </div>
                                                        <Row className="text-center">
                                                            {/* <p className="my-3"><strong>Next Sheduled Recording:<Countdown value={deadline} onFinish={console.log("finish")} /></strong></p> */}
                                                            <p className={isCopyStart ? "d-none" : "my-3"}><strong>Selected File Size: {formatFileSize(checkedSize, 2)} {sizeAfterCopy >= 100 ? '(Isuffcient Storage)' : ''}</strong></p>
                                                            <p className={!isCopyStart ? "d-none" : "my-3"}><strong>Copy Progress: {formatFileSize((storageData.size * 1024 - storageData.avail * 1024) - initialUsage * 1024)}</strong></p>
                                                            <Progress className={!isCopyStart ? "d-none" : "my-3"} status={isCopyStart ? 'active' : 'normal'} percent={copyPcnt} width={80} />

                                                            {storageData.name == 'No USB Device Found' ? <Alert className='my-2' message="No USB Device Found" type="warning" /> : <p className="my-3"><strong>{storageData.name}</strong></p>}
                                                            <Progress percent={100 - Math.round((storageData.avail / storageData.size) * 100, 2)} success={{ percent: storageData.size ? (100 - Math.round((storageData.avail / storageData.size) * 100, 2)) + Math.round(((checkedSize / 1024) / storageData.size) * 100, 2) : 0, strokeColor: sizeAfterCopy >= 100 ? 'rgba(255, 77, 77, 0.75)' : 'rgba(80, 213, 27, 0.55)' }} width={80} />
                                                            <Text code style={{ color: "#121212" }}>{Math.round(storageData.avail / Math.pow(1024, 2), 2)}GB/{Math.round(storageData.size / Math.pow(1024, 2), 2)}GB Available</Text>
                                                        </Row>
                                                    </Col>
                                                </Row>
                                                <Row>

                                                </Row>
                                            </Content>
                                        </Layout>
                                    </Col>
                                </div>
                            </div>
                        </Col>
                    </Row>
                </Container>
            </div>
        </React.Fragment >
    );
};

export default withRouter(Fm);

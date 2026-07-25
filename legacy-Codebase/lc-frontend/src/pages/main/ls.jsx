import React, { useState, useRef, useEffect } from "react";
import {
    Row,
    Col,
    Container,
    Label,
    FormGroup,
    Input,
} from "reactstrap";
import { Link, useHistory } from "react-router-dom";
import { withRouter } from 'react-router-dom'
import { Button as ButtonAnt, Form, Input as InputAnt, message, Divider, Select, PageHeader, Layout, Alert, Switch, Slider, Modal } from 'antd';
import logo from "../../assets/images/logo.png"
import placeholder from "../../assets/images/placeholder.gif"
import LsCtrl from "../../controllers/ls_ctrl";
import CaptureSetupCtrl from "../../controllers/CaptureSetup_ctrl";
import { createBrowserHistory } from "history";
import SettingsCtrl from "../../controllers/Settings_ctrl";
import openSocket from 'socket.io-client';


const Ls = () => {
    const socket = useRef();
    const { Header, Content } = Layout;
    const { Option } = Select;

    const { confirm } = Modal;

    const [applyVal, setApplyVal] = useState(false);
    const [privPipe, setPrivPipe] = useState(true);

    // const history = useHistory();
    const [rtspOptions, setRtspOptions] = useState({});
    const [rtspOn, setRtspOn] = useState(false);
    const [rtspOn2, setRtspOn2] = useState(false);
    const [isLoad, setIsLoad] = useState(false);
    const [deviceMissing, setDeviceMissing] = useState(false);
    const [CamDevices, setCamDevices] = useState([]);
    const [BEDevices, setBEDevices] = useState([]);
    const firstUpdate = useRef(true);

    const key = 'loading'

    // Refresh on exit
    const history = createBrowserHistory({ forceRefresh: true });

    const [pipval, setPipval] = useState("");
    const [pipSval, setPipSval] = useState("");
    const [pipPval, setPipPval] = useState("");
    const [sidePval, setSidePval] = useState("");
    const [layoutVal, setLayoutVal] = useState("");


    const [localstream, setLocalstream] = useState([]);


    const [imgs1, setImgs1] = useState('');
    const [imgs2, setImgs2] = useState('');

    // RTMP val
    const [fbVal, setFbVal] = useState(false);
    const [ytVal, setYtVal] = useState(false);
    const [twtVal, setTwtVal] = useState(false);
    const [lkdVal, setLkdVal] = useState(false);

    const onSwitchChange = (val, event) => {
        console.log(event);

        if (event == 'facebook') {
            setFbVal(prevCheck => !prevCheck);
            val ? setLsOption({ ...lsOptions, fb: '1' }) : setLsOption({ ...lsOptions, fb: '0' });
        }

        if (event == 'youtube') {

            setYtVal(prevCheck => !prevCheck);
            val ? setLsOption({ ...lsOptions, yt: '1' }) : setLsOption({ ...lsOptions, yt: '0' });
        }

        if (event == 'twitch') {
            setTwtVal(prevCheck => !prevCheck);
            val ? setLsOption({ ...lsOptions, twt: '1' }) : setLsOption({ ...lsOptions, twt: '0' });
        }

        if (event == 'linkedin') {
            setLkdVal(prevCheck => !prevCheck);
            val ? setLsOption({ ...lsOptions, lkd: '1' }) : setLsOption({ ...lsOptions, lkd: '0' });
        }
    }

    // Position refs
    const tl = useRef(null);
    const tr = useRef(null);
    const bl = useRef(null);
    const br = useRef(null);

    const st = useRef(null);
    const sm = useRef(null);
    const sb = useRef(null);

    const onLayoutChnage = (val) => {
        setLayoutVal(val);
    }

    const onPipChange = (val) => {
        setPipval(val);

    }
    const onPipSChange = (val) => {
        setPipSval(val);
    }
    const onPipPChange = (val) => {
        setPipPval(val);
        console.log(val);

        switch (val) {
            case "Top-Left":
                tl.current.style.background = "#1890ff"
                tr.current.style.background = "#a5a5a5"
                bl.current.style.background = "#a5a5a5"
                br.current.style.background = "#a5a5a5"
                break;
            case "Top-Right":
                tl.current.style.background = "#a5a5a5"
                tr.current.style.background = "#1890ff"
                bl.current.style.background = "#a5a5a5"
                br.current.style.background = "#a5a5a5"
                break;
            case "Bottom-Left":
                tl.current.style.background = "#a5a5a5"
                tr.current.style.background = "#a5a5a5"
                bl.current.style.background = "#1890ff"
                br.current.style.background = "#a5a5a5"
                break;
            case "Bottom-Right":
                tl.current.style.background = "#a5a5a5"
                tr.current.style.background = "#a5a5a5"
                bl.current.style.background = "#a5a5a5"
                br.current.style.background = "#1890ff"
                break;
            default:
                break;
        }
    }
    const onSidePChange = (val) => {
        setSidePval(val);
        console.log(val);

        switch (val) {
            case "Top":
                st.current.style.background = "#1890ff"
                sm.current.style.background = "#a5a5a5"
                sb.current.style.background = "#a5a5a5"
                break;
            case "Middle":
                st.current.style.background = "#a5a5a5"
                sm.current.style.background = "#1890ff"
                sb.current.style.background = "#a5a5a5"
                break;
            case "Bottom":
                st.current.style.background = "#a5a5a5"
                sm.current.style.background = "#a5a5a5"
                sb.current.style.background = "#1890ff"
                break;
            default:
                break;
        }
    }

    const handleonChange = (event) => {

        setLsOption({ ...lsOptions, [event.target.name]: event.target.value });
        console.log(lsOptions);
    }

    const switchpresentation = (presenter, value) => {
        message.loading({ content: 'Switching Video Sources...', key, duration: 0 })
        setIsLoad(true)
        var source;
        if (value == 'hdmisource') {
            if (presenter == 'hdmisource') {
                presenter = "p1";
            } else if (presenter == 'sdisource') {
                presenter = "p2";
            } else if (presenter == "rtsp") {
                presenter = 'rtsp'
            } else if (presenter == "rtsp2") {
                presenter = 'rtsp2'
            } else {
                presenter = "excam"
            }
            source = ["p1", presenter];
        }
        else if (value == 'sdisource') {
            if (presenter == 'hdmisource') {
                presenter = "p1";
            } else if (presenter == 'sdisource') {
                presenter = "p2";
            } else if (presenter == "rtsp") {
                presenter = 'rtsp'
            } else if (presenter == "rtsp2") {
                presenter = 'rtsp2'
            } else {
                presenter = "excam"
            }
            source = ["p2", presenter];
        } else if (value == 'rtsp') {
            if (presenter == 'hdmisource') {
                presenter = "p1";
            } else if (presenter == 'sdisource') {
                presenter = "p2";
            } else if (presenter == "rtsp") {
                presenter = 'rtsp'
            } else if (presenter == "rtsp2") {
                presenter = 'rtsp2'
            } else {
                presenter = "excam"
            }
            source = ["rtsp", presenter];
        } else if (value == 'rtsp2') {
            if (presenter == 'hdmisource') {
                presenter = "p1";
            } else if (presenter == 'sdisource') {
                presenter = "p2";
            } else if (presenter == "rtsp") {
                presenter = 'rtsp'
            } else if (presenter == "rtsp2") {
                presenter = 'rtsp2'
            } else {
                presenter = "excam"
            }
            source = ["rtsp2", presenter];
        } else {
            if (presenter == 'hdmisource') {
                presenter = "p1";
            } else if (presenter == 'sdisource') {
                presenter = "p2";
            } else if (presenter == "rtsp") {
                presenter = 'rtsp'
            } else if (presenter == "rtsp2") {
                presenter = 'rtsp2'
            } else {
                presenter = "excam"
            }
            source = ["excam", presenter]
        }
        console.log('source----', source);

        CaptureSetupCtrl.CsChangeSnaps(source, { rtspOptions }).then((result) => {
            console.log(result);
            if (deviceMissing && (lsOptions.presenter_source != 'Select a Device')) { setDeviceMissing(false) }
            message.success({ content: 'Video Source Loaded!', key, duration: 1 })
            setIsLoad(false)
        }).catch((err) => {
            console.log(err);
            message.error({ content: 'Oops! Something went wrong! Please Try Again.', key, duration: 1 })
            setIsLoad(false)
        })


    }

    const switchpresenter = (presentation, value) => {
        message.loading({ content: 'Switching Video Sources...', key, duration: 0 })
        setIsLoad(true)
        var source;
        if (value == 'hdmisource') {
            if (presentation == 'hdmisource') {
                presentation = "p1";
            } else if (presentation == 'sdisource') {
                presentation = "p2";
            } else if (presentation == 'rtsp') {
                presentation = "rtsp";
            } else if (presentation == "rtsp2") {
                presentation = 'rtsp2'
            }
            source = [presentation, "p1"];
        }
        else if (value == 'sdisource') {
            if (presentation == 'hdmisource') {
                presentation = "p1";
            } else if (presentation == 'sdisource') {
                presentation = "p2";
            } else if (presentation == 'rtsp') {
                presentation = "rtsp";
            } else if (presentation == "rtsp2") {
                presentation = 'rtsp2'
            }
            source = [presentation, "p2"];
        } else if (value == 'rtsp') {
            if (presentation == 'hdmisource') {
                presentation = "p1";
            } else if (presentation == 'sdisource') {
                presentation = "p2";
            } else if (presentation == 'rtsp') {
                presentation = "rtsp";
            } else if (presentation == "rtsp2") {
                presentation = 'rtsp2'
            }
            source = [presentation, "rtsp"];
        } else if (value == 'rtsp2') {
            if (presentation == 'hdmisource') {
                presentation = "p1";
            } else if (presentation == 'sdisource') {
                presentation = "p2";
            } else if (presentation == 'rtsp') {
                presentation = "rtsp";
            } else if (presentation == "rtsp2") {
                presentation = 'rtsp2'
            }
            source = [presentation, "rtsp2"];
        } else {
            if (presentation == 'hdmisource') {
                presentation = "p1";
            } else if (presentation == 'sdisource') {
                presentation = "p2";
            } else if (presentation == 'rtsp') {
                presentation = "rtsp";
            } else if (presentation == "rtsp2") {
                presentation = 'rtsp2'
            }
            source = [presentation, "excam"]
        }
        console.log('source----', source);

        CaptureSetupCtrl.CsChangeSnaps(source, { rtspOptions }).then((result) => {
            console.log(result);
            if (deviceMissing && (lsOptions.presentation_source != 'Select a Device')) { setDeviceMissing(false) }
            message.success({ content: 'Video Source Loaded!', key, duration: 1 })
            setIsLoad(false)
        }).catch((err) => {
            console.log(err);
            message.error({ content: 'Oops! Something went wrong! Please Try Again.', key, duration: 1 })
            setIsLoad(false)
        })
    }

    // Connected devices list
    const [videoDevices, setVideoDevice] = useState([]);
    const [audioInDevices, setAudioInDevice] = useState([]);
    const [audioOutDevices, setAudioOutDevice] = useState([]);

    // Data stored on DB
    const [lsOptions, setLsOption] = useState({
        presentation_source: '',
        presenter_source: '',
        layout: '',
        rec_method: '',
        pip_pos: '',
        s_pip_pos: '',
        pip_size: '',
        fb: '',
        yt: '',
        twt: '',
        lkd: '',
        fb_rtmp: '',
        yt_rtmp: '',
        twt_rtmp: '',
        lkd_rtmp: '',
        userid: ''
    });

    // Video Ref
    const vidRefPresentation = useRef(null);
    const vidRefPresenter = useRef(null);
    const vidRefRecord = useRef(null);


    // Get camera feed

    useEffect(() => {
        const newsocket = openSocket(`http://${process.env.REACT_APP_SERVER_IP}:3000`, { transports: ['websocket'] });
        socket.current = newsocket;

        loadSettings();
        return () => newsocket.disconnect();

    }, [])

    const getRtspLink = async () => {
        let data
        let data2
        await SettingsCtrl.DissGet(1).then((res) => {
            data = res.filter(val => val.title == 'rtsplink').reduce((acc, cur) => ({ ...acc, [cur.title]: cur.s_value }), {})
            // setRtspOptions({ ...rtspOptions, ...data })
            data2 = res.filter(val => val.title == 'rtsplink2').reduce((acc, cur) => ({ ...acc, [cur.title]: cur.s_value }), {})
            setRtspOptions({ ...rtspOptions, ...data2, ...data })
        })
        return { ...data, ...data2 };
    }

    useEffect(async () => {
        console.log('new devices----', BEDevices);
        if (firstUpdate.current) {
            firstUpdate.current = false;
            return;
        }
        if ((BEDevices.filter(x => x == "Eduscope UMS ").length) == 1) {
            if (lsOptions.presentation_source == 'hdmisource' || lsOptions.presentation_source == 'sdisource') {

            } else if (lsOptions.presentation_source == 'rtsp') {
                if (!rtspOn) {
                    setLsOption({ ...lsOptions, presentation_source: 'Select a Device' })
                    socket.removeAllListeners();
                    setDeviceMissing(true)
                    setImgs1(placeholder)
                    setImgs2(placeholder)
                    setPrivPipe(false)
                }
            } else if (lsOptions.presentation_source == 'rtsp2') {
                if (!rtspOn2) {
                    setLsOption({ ...lsOptions, presentation_source: 'Select a Device' })
                    socket.removeAllListeners();
                    setDeviceMissing(true)
                    setImgs1(placeholder)
                    setImgs2(placeholder)
                    setPrivPipe(false)
                }
            } else {
                if (BEDevices.length != 2) {
                    setLsOption({ ...lsOptions, presenter_source: 'Select a Device', presentation_source: 'Select a Device' });
                    socket.removeAllListeners();
                    setDeviceMissing(true)
                    setImgs1(placeholder)
                    setImgs2(placeholder)
                    setPrivPipe(false)
                }
            }

            if (lsOptions.presenter_source == 'hdmisource' || lsOptions.presenter_source == 'sdisource') {

            } else if (lsOptions.presenter_source == 'rtsp') {
                if (!rtspOn) {
                    setLsOption({ ...lsOptions, presenter_source: 'Select a Device' })
                    socket.removeAllListeners();
                    setDeviceMissing(true)
                    setImgs1(placeholder)
                    setImgs2(placeholder)
                    setPrivPipe(false)
                }
            } else if (lsOptions.presenter_source == 'rtsp2') {
                if (!rtspOn2) {
                    setLsOption({ ...lsOptions, presenter_source: 'Select a Device' })
                    socket.removeAllListeners();
                    setDeviceMissing(true)
                    setImgs1(placeholder)
                    setImgs2(placeholder)
                    setPrivPipe(false)
                }
            } else {
                if (BEDevices.length != 2) {
                    setLsOption({ ...lsOptions, presentation_source: 'Select a Device', presenter_source: 'Select a Device' })
                    setDeviceMissing(true)
                    socket.removeAllListeners();
                    setImgs1(placeholder)
                    setImgs2(placeholder)
                    setPrivPipe(false)
                }
            }
        } else {
            alert('Restart the device')
        }
    }, [CamDevices])


    const getDeviceList = async () => {
        // let devicelist = await navigator.mediaDevices.enumerateDevices();
        // setVideoDevice(devicelist.filter(device => device.kind === 'videoinput'));
        // setAudioInDevice(devicelist.filter(device => device.kind === 'audioinput'));
        // setAudioOutDevice(devicelist.filter(device => device.kind === 'audiooutput'));
        // console.log("-------------", devicelist.filter(device => device.kind === 'videoinput').length);

        // return (devicelist.filter(device => device.kind === 'videoinput').length > 2)
        let availDev = [];

        await CaptureSetupCtrl.getDevices('video').then((res) => {
            console.log("called");
            message.loading({ content: 'Loading Video Sources...', key, duration: 0 })
            console.log(res);
            let resDevices = res.data.data;
            if (res.data) {
                message.success({ content: 'Files Loaded', key, duration: 1 })
            } else {
                message.error({ content: 'Oops! Something went wrong! Please Try Again.', key, duration: 2 })
            }
            setBEDevices(resDevices)

            if (resDevices.length == 2) {
                setCamDevices(['Presentation', 'USB Cam'])
                availDev = ['Presentation', 'USB Cam']
            } else {
                setCamDevices(['Presentation'])
                availDev = ['Presentation']
            }

            // resDevices.forEach(device => {
            //     if (device == "Eduscope UMS " && resDevices.length == 2) {
            //         setCamDevices(['Presentation', 'USB Cam'])
            //     } else {
            //         setCamDevices(['Presentation'])
            //     }
            // });


        }).catch((err) => {
            console.log(err);
            message.error({ content: 'Oops! Something went wrong! Please Try Again.', key, duration: 2 })
        })
        return availDev
    }

    // useEffect(() => {
    //     getVideo(vidRefPresentation, lsOptions.presentation_source);
    // }, [lsOptions.presentation_source]);

    // useEffect(() => {
    //     getVideo(vidRefPresenter, lsOptions.presenter_source);
    // }, [lsOptions.presenter_source]);

    // const getVideo = (location, id) => {
    //     console.log('-------', id);

    //     navigator.getUserMedia = (navigator.getUserMedia || navigator.webkitGetUserMedia || navigator.mozGetUserMedia || navigator.msGetUserMedia);

    //     if (navigator.getUserMedia && id) {
    //         navigator.mediaDevices.getUserMedia(
    //             // constraints
    //             {
    //                 video: {
    //                     width: 256,
    //                     height: 144,
    //                     frameRate: 10,
    //                     deviceId: { exact: id }
    //                 }
    //             }).then(stream => {
    //                 setLocalstream([...localstream, stream])
    //                 let video = location.current;
    //                 video.srcObject = stream;
    //                 video.play();
    //             })
    //             .catch(err => {
    //                 console.error("error:", err);
    //             });
    //     } else {
    //         console.log("getUserMedia not supported");
    //     }
    // }

    useEffect(() => {
        if (!deviceMissing) {
            let temporaryImage;

            socket.current.emit('startpriv', true);
            socket.current.on("presentation", function (info) {
                // console.log(info.buffer);

                if (info.image) {


                    // Destroy old image
                    URL.revokeObjectURL(temporaryImage);


                    // Create a new image from binary data
                    var imageDataBlob = convertDataURIToBlob(info.buffer);

                    // Create a new object URL object
                    temporaryImage = URL.createObjectURL(imageDataBlob);

                    // Set the new image
                    setImgs1(temporaryImage);

                }
            });

            socket.current.on("presenter", function (info) {
                console.log('called');

                if (info.image) {

                    // Destroy old image

                    URL.revokeObjectURL(temporaryImage);

                    // if (imgs2) { URL.revokeObjectURL(imgs1); }

                    // Create a new image from binary data
                    var imageDataBlob = convertDataURIToBlob(info.buffer);

                    // Create a new object URL object
                    temporaryImage = URL.createObjectURL(imageDataBlob);

                    // Set the new image
                    setImgs2(temporaryImage);

                }
            });
        }
    }, [deviceMissing])


    // Load data from db and apply to db

    const loadSettings = () => {
        message.loading({ content: 'Fetching Data...', key, duration: 0 })
        setIsLoad(true)
        SettingsCtrl.DissGet(1).then((res) => {
            // Get array and create object with needed values
            let data = res.filter(val => val.title == 'rtsp').reduce((acc, cur) => ({ ...acc, [cur.title]: cur.s_value }), {})
            let data2 = res.filter(val => val.title == 'rtsp2').reduce((acc, cur) => ({ ...acc, [cur.title]: cur.s_value }), {})
            console.log(data);
            if (data.rtsp == '1') {
                setRtspOn(true)
            }
            if (data2.rtsp2 == '1') {
                setRtspOn2(true)
            }
        });
        LsCtrl.LsGet(1).then((res) => {
            message.success({ content: 'Success!', key, duration: 1 })
            setIsLoad(false)
            // Get array and create object with needed values
            let data = res.reduce((acc, cur) => ({ ...acc, [cur.title]: cur.s_value }), {})
            console.log(res);
            setLayoutVal(data.layout);
            onPipChange(data.rec_method)
            if (data.rec_method == 'PIP') {
                onPipPChange(data.pip_pos);
                onPipSChange(data.pip_size);
            }
            if (data.rec_method == 'Side') {
                onSidePChange(data.s_pip_pos);
                onPipSChange(data.pip_size);
            }
            setLsOption({
                presentation_source: data.presentation_source,
                presenter_source: data.presenter_source,
                layout: data.layout,
                rec_method: data.rec_method,
                pip_pos: data.pip_pos,
                s_pip_pos: data.s_pip_pos,
                pip_size: data.pip_size,
                fb: data.fb,
                yt: data.yt,
                twt: data.twt,
                lkd: data.lkd,
                fb_rtmp: data.fb_rtmp,
                yt_rtmp: data.yt_rtmp,
                twt_rtmp: data.twt_rtmp,
                lkd_rtmp: data.lkd_rtmp,
                userid: res[0].userid
            })
            if (data.fb == '1') {
                setFbVal(true)
            }
            if (data.yt == '1') {
                setYtVal(true)
            }
            if (data.twt == '1') {
                setTwtVal(true)
            }
            if (data.lkd == '1') {
                setLkdVal(true)
            }
            getRtspLink().then((datart) => {
                getDeviceList().then((devices) => {
                    console.log(devices);

                    if ((devices.length == 2 && data.presenter_source == 'any device id') || (devices.length == 1 && data.presenter_source != 'any device id') || (devices.length == 2 && data.presenter_source != 'any device id')) {
                        CaptureSetupCtrl.CsSnaps([data.presentation_source, data.presenter_source], { datart }).then((result) => {
                            console.log(result);
                            let temporaryImage;

                            result ? setPrivPipe(false) : console.log("pipeline failed");
                            socket.current.emit('startpriv', true);
                            socket.current.on("presentation", function (info) {
                                // console.log(info.buffer);

                                if (info.image) {

                                    // Destroy old image
                                    URL.revokeObjectURL(temporaryImage);


                                    // Create a new image from binary data
                                    var imageDataBlob = convertDataURIToBlob(info.buffer);

                                    // Create a new object URL object
                                    temporaryImage = URL.createObjectURL(imageDataBlob);

                                    // Set the new image
                                    setImgs1(temporaryImage);

                                }
                            });

                            socket.current.on("presenter", function (info) {
                                console.log('called');

                                if (info.image) {


                                    // Destroy old image
                                    // console.log("------", temporaryImage);

                                    URL.revokeObjectURL(temporaryImage);

                                    // if (imgs2) { URL.revokeObjectURL(imgs1); }

                                    // Create a new image from binary data
                                    var imageDataBlob = convertDataURIToBlob(info.buffer);

                                    // Create a new object URL object
                                    temporaryImage = URL.createObjectURL(imageDataBlob);

                                    // Set the new image
                                    setImgs2(temporaryImage);

                                }
                            });

                            // socket.current.on("excam", function (info) {
                            //     // console.log('called');

                            //     if (info.image) {

                            //         setImgs3(`data:image/jpeg;base64,${info.buffer}`)

                            //         console.log(lmcOptions.rec_method);
                            //     }
                            // });
                        })
                    }
                })
            })
            // if (data.rec_method == '50-50') {

            //     setvideoRef50lv(imgs1);
            //     setvideoRef50rv(imgs2);

            //     // getVideo(videoRef50lv, data.presenter_source)
            //     // getVideo(videoRef50rv, data.presentation_source)
            // }
        }).catch((err) => {
            console.log(err);
            message.error({ content: 'Oops! Something went wrong! Please Try Again.', key, duration: 1 })
            setIsLoad(false);
        })
    }

    const convertDataURIToBlob = (dataURI) => {
        // Validate input data
        if (!dataURI) return;

        // Convert image (in base64) to binary data
        // var base64Index = dataURI.indexOf(BASE64_MARKER) + BASE64_MARKER.length;
        // var base64 = dataURI.substring(base64Index);
        var raw = window.atob(dataURI);
        var rawLength = raw.length;
        var array = new Uint8Array(new ArrayBuffer(rawLength));

        for (let i = 0; i < rawLength; i++) {
            array[i] = raw.charCodeAt(i);
        }

        // Create and return a new blob object using binary data
        return new Blob([array], { type: "image/jpeg" });
    }

    const apply = () => {
        message.loading({ content: 'Applying Settings...', key, duration: 0 })
        setIsLoad(true)
        LsCtrl.LsApply(lsOptions).then((res) => {
            if (res.success) {
                message.success({ content: 'Settings Applied', key, duration: 1 });
                setApplyVal(false)
                setIsLoad(false)
                loadSettings();
            } else {
                message.error({ content: 'Oops! Something went wrong! Please Try Again.', key, duration: 1 })
                setIsLoad(false)
            }
        }).catch((err) => {
            console.log(err);
            message.error({ content: 'Oops! Something went wrong! Please Try Again.', key, duration: 1 })
            setIsLoad(false)
        })
    }


    const handleDropDowns = (value, event) => {
        setApplyVal(true)
        setLsOption({ ...lsOptions, [event.name]: value });
        if (event.name == "presentation_source") {
            switchpresentation(lsOptions.presenter_source, value)
        }
        if (event.name == "presenter_source") {
            switchpresenter(lsOptions.presentation_source, value)
        }
        if (event.name == "rec_method") { onPipChange(value); }
        if (event.name == "pip_pos") { onPipPChange(value); }
        if (event.name == "s_pip_pos") { onSidePChange(value); }
        if (event.name == "pip_size") { onPipSChange(value); }
        if (event.name == "layout") { onLayoutChnage(value); }
        console.log(lsOptions)
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
                                                        subTitle="Live Streaming"
                                                        extra={[
                                                            <ButtonAnt className='cus-btn1' key="1" disabled={isLoad} type="default" onClick={apply}>
                                                                Apply
                                                            </ButtonAnt>,
                                                            <ButtonAnt key="2" className="cus-btn1 reset-btn" type="dashed" disabled={isLoad} onClick={() => { console.log("Reset"); }}>
                                                                Reset
                                                            </ButtonAnt>,
                                                            <ButtonAnt className='cus-btn1' key="3" type="primary" disabled={isLoad} onClick={() => {
                                                                if (applyVal) {
                                                                    confirm({
                                                                        title: 'Do you wish to Apply Changes?',
                                                                        // icon: <ExclamationCircleOutlined />,
                                                                        // content: 'Unsaved changes detected.',
                                                                        okText: 'Yes',
                                                                        cancelText: 'No',
                                                                        onOk() {
                                                                            apply()
                                                                        },
                                                                        onCancel() {
                                                                            message.loading('Loading...')
                                                                            history.push('/menu')
                                                                        },
                                                                    });
                                                                } else {
                                                                    message.loading('Loading...')
                                                                    history.push('/menu')
                                                                }

                                                            }}
                                                            >
                                                                Main Menu
                                                            </ButtonAnt>,
                                                        ]}
                                                    >
                                                    </PageHeader>
                                                </div>
                                            </Header>
                                            <Content className="my-5" style={{ padding: '0 50px' }}>
                                                <Row>
                                                    <Col lg={3}>
                                                        <div className={lsOptions.layout == "Presenter" ? "d-none" : ""}>
                                                            <Divider orientation="left" style={{ borderColor: "#121212", fontWeight: "900" }}>Presentation Preview</Divider>
                                                            <img className={lsOptions.presentation_source == '' || privPipe ? "empty-vid" : "recordpiv"} src={imgs1}></img>

                                                            <div>
                                                                <Select disabled={isLoad} className="my-3" placeholder="Presentation Source" value={lsOptions.presentation_source} style={{ width: "100%" }} onSelect={(value, event) => handleDropDowns(value, event)}>
                                                                    {/* {videoDevices.filter((device) => {
                                                                        if (device.deviceId == 'hdmisource' || device.deviceId == 'sdisource') { return true } else { return false }
                                                                    }).map((device) => {
                                                                        let label;
                                                                        if (device.deviceId == "hdmisource") { label = "Presentation" }
                                                                        else if (device.deviceId == "sdisource") { label = "SDI Cam" }
                                                                        else {
                                                                            label = "USB Cam"
                                                                        }
                                                                        return (
                                                                            <Option name="presentation_source" key={device.deviceId} value={device.deviceId}>
                                                                                {label}
                                                                            </Option>
                                                                        )
                                                                    })} */}


                                                                    {/* ------Devices from backend */}

                                                                    {CamDevices.filter((device) => {
                                                                        if (device == 'Presentation' || device == 'SDI Cam') { return true } else { return false }
                                                                    }).map((device) => {
                                                                        let deviceid;
                                                                        if (device == "Presentation") { deviceid = "hdmisource" }
                                                                        else if (device == "SDI Cam") { deviceid = "sdisource" }
                                                                        else {
                                                                            deviceid = "any device id"
                                                                        }
                                                                        return (
                                                                            <Option name="presentation_source" key={deviceid} value={deviceid}>
                                                                                {device}
                                                                            </Option>
                                                                        )
                                                                    })}
                                                                    {rtspOn ? <Option name="presentation_source" key="rtsp" value="rtsp">
                                                                        Network Cam
                                                                            </Option> : ''}
                                                                    {rtspOn2 ? <Option name="presentation_source" key="rtsp2" value="rtsp2">
                                                                        Network Cam 2
                                                                            </Option> : ''}
                                                                    {/* ------END Devices from backend */}


                                                                    {/* <Option name="presentation_source" key='hdmisource' value='hdmisource'>
                                                                        Channel 1
                                                                    </Option>
                                                                    <Option name="presentation_source" key='sdisource' value='sdisource'>
                                                                        Channel 2
                                                                    </Option> */}
                                                                </Select>
                                                            </div>
                                                            {/* <h6 className="text-center ">Presentation Preview</h6> */}
                                                        </div>
                                                    </Col>
                                                    <Col lg={3}>
                                                        <div className={lsOptions.layout == "Presentation" ? "d-none" : ""}>

                                                            <Divider orientation="left" style={{ borderColor: "#121212", fontWeight: "900" }}>Presenter Preview</Divider>
                                                            <img className={lsOptions.presenter_source == '' || privPipe ? "empty-vid" : "recordpiv"} src={imgs2}></img>

                                                            <div>
                                                                <Select disabled={isLoad} className="my-3" placeholder="Camera Source" value={lsOptions.presenter_source} style={{ width: "100%" }} onSelect={(value, event) => handleDropDowns(value, event)}>
                                                                    {/* {videoDevices.map((device) => {
                                                                        let label;
                                                                        if (device.deviceId == "hdmisource") { label = "Presentation" }
                                                                        else if (device.deviceId == "sdisource") { label = "SDI Cam" }
                                                                        else {
                                                                            label = "USB Cam"
                                                                        }
                                                                        return (
                                                                            <Option name="presenter_source" key={device.deviceId} value={device.deviceId}>
                                                                                {label}
                                                                            </Option>
                                                                        )
                                                                    })} */}


                                                                    {/* ------Devices from backend */}

                                                                    {CamDevices.map((device) => {
                                                                        let deviceid;
                                                                        if (device == "Presentation") { deviceid = "hdmisource" }
                                                                        else if (device == "SDI Cam") { deviceid = "sdisource" }
                                                                        else {
                                                                            deviceid = "any device id"
                                                                        }
                                                                        return (
                                                                            <Option name="presenter_source" key={deviceid} value={deviceid}>
                                                                                {device}
                                                                            </Option>
                                                                        )
                                                                    })}
                                                                    {rtspOn ? <Option name="presenter_source" key="rtsp" value="rtsp">
                                                                        Network Cam
                                                                            </Option> : ''}
                                                                    {rtspOn2 ? <Option name="presenter_source" key="rtsp2" value="rtsp2">
                                                                        Network Cam 2
                                                                            </Option> : ''}
                                                                    {/* ------END Devices from backend */}


                                                                    {/* {videoDevices.filter((device) => { if (device.deviceId == 'hdmisource') { return false } else { return true } }).map((device) => (
                                                                    <Option name="presenter_source" key={device.deviceId} value={device.deviceId}>
                                                                        {device.label}
                                                                    </Option>
                                                                ))} */}
                                                                </Select>
                                                            </div>
                                                            {/* <h6 className="text-center ">Presenter Preview</h6> */}
                                                        </div>
                                                    </Col>
                                                    <Col lg={6}>
                                                        <Col lg={12}>
                                                            <Divider orientation="left" style={{ borderColor: "#121212", fontWeight: "900" }}>Select Layout</Divider>
                                                        </Col>
                                                        <div className="d-flex">
                                                            <Col lg={6}>
                                                                <div >
                                                                    <Col lg={12} sm={6}>
                                                                        <Select className="my-2" placeholder="Layout" value={lsOptions.layout} style={{ width: "100%" }} onSelect={(value, event) => handleDropDowns(value, event)}>
                                                                            <Option name='layout' value="Presenter">Presenter Only</Option>
                                                                            <Option name='layout' value="PresentationPresenter">Presentation + Presenter</Option>
                                                                            <Option name='layout' value="Presentation">Presentation Only</Option>
                                                                        </Select>
                                                                    </Col>
                                                                    <Col lg={12} sm={6} >
                                                                        <div className="d-grid">
                                                                            <div className={layoutVal == "PresentationPresenter" ? "d-inline-block mt-2" : "d-none"}>
                                                                                <Select className="my-2" placeholder="Record Method" value={lsOptions.rec_method} style={{ width: "100%" }} onSelect={(value, event) => handleDropDowns(value, event)}>
                                                                                    <Option name='rec_method' value="PIP">PIP</Option>
                                                                                    <Option name='rec_method' value="50-50">50-50</Option>
                                                                                    <Option name='rec_method' value="Side">Side By Side</Option>
                                                                                </Select>
                                                                            </div>
                                                                        </div>
                                                                        <Col lg={12}>
                                                                            <div className={pipval == "PIP" && layoutVal == "PresentationPresenter" ? "mt-2" : "d-none"}>
                                                                                <Select className="my-2" placeholder="PIP Position" value={lsOptions.pip_pos} style={{ width: "100%" }} onSelect={(value, event) => handleDropDowns(value, event)}>
                                                                                    <Option name='pip_pos' value="Top-Left">Top Left</Option>
                                                                                    <Option name='pip_pos' value="Top-Right">Top Right</Option>
                                                                                    <Option name='pip_pos' value="Bottom-Left">Bottom Left</Option>
                                                                                    <Option name='pip_pos' value="Bottom-Right">Bottom Right</Option>
                                                                                </Select>
                                                                            </div>
                                                                            <div className={pipval == "Side" && layoutVal == "PresentationPresenter" ? "mt-2" : "d-none"}>
                                                                                <Select className="my-2" placeholder="PIP Position" value={lsOptions.s_pip_pos} style={{ width: "100%" }} onSelect={(value, event) => handleDropDowns(value, event)}>
                                                                                    <Option name='s_pip_pos' value="Top">Top</Option>
                                                                                    <Option name='s_pip_pos' value="Middle">Middle</Option>
                                                                                    <Option name='s_pip_pos' value="Bottom">Bottom</Option>
                                                                                </Select>
                                                                            </div>
                                                                        </Col>
                                                                        <Col lg={12}>
                                                                            <div className={(pipval == "PIP" || pipval == "Side") && layoutVal == "PresentationPresenter" ? "mt-2" : "d-none"}>
                                                                                <Select className="my-2" placeholder="PIP Size" value={lsOptions.pip_size} style={{ width: "100%" }} onSelect={(value, event) => handleDropDowns(value, event)}>
                                                                                    <Option name='pip_size' value="144P">144P</Option>
                                                                                    <Option name='pip_size' value="240P">240P</Option>
                                                                                </Select>
                                                                            </div>
                                                                        </Col>
                                                                    </Col>
                                                                </div>
                                                            </Col>
                                                            <Col lg={6}>
                                                                <div className={layoutVal == "PresentationPresenter" ? "p-3" : "d-none"}>
                                                                    <div className="cs-recordpiv" style={{ position: "relative" }}>
                                                                        <div className={pipval == "PIP" ? "" : "d-none"}>
                                                                            <div style={{ top: 0, left: 0, width: `${pipSval == "144P" ? "20%" : "25%"}`, height: `${pipSval == "144P" ? "25%" : "30%"}` }} ref={tl} className="cs-sub-recordpiv"></div>
                                                                            <div style={{ top: 0, right: 0, width: `${pipSval == "144P" ? "20%" : "25%"}`, height: `${pipSval == "144P" ? "25%" : "30%"}` }} ref={tr} className="cs-sub-recordpiv"></div>
                                                                            <div style={{ bottom: 0, left: 0, width: `${pipSval == "144P" ? "20%" : "25%"}`, height: `${pipSval == "144P" ? "25%" : "30%"}` }} ref={bl} className="cs-sub-recordpiv"></div>
                                                                            <div style={{ bottom: 0, right: 0, width: `${pipSval == "144P" ? "20%" : "25%"}`, height: `${pipSval == "144P" ? "25%" : "30%"}` }} ref={br} className="cs-sub-recordpiv"></div>
                                                                        </div>
                                                                        <div className={pipval == "50-50" ? "" : "d-none"}>
                                                                            <div style={{ top: 0, left: 0, marginTop: "12%" }} className="cs-sub-50-recordpiv-priview"></div>
                                                                            <div style={{ top: 0, right: 0, marginTop: "12%" }} className="cs-sub-50-recordpiv-priview"></div>
                                                                        </div>
                                                                        <div className={pipval == "Side" ? "" : "d-none"}>
                                                                            <div style={{ top: 0, right: 0, width: `${pipSval == "144P" ? "22%" : "27%"}`, height: `${pipSval == "144P" ? "27%" : "32%"}` }} ref={st} className="cs-sub-recordpiv"></div>
                                                                            <div style={{ top: 0, right: 0, marginTop: "19%", width: `${pipSval == "144P" ? "22%" : "27%"}`, height: `${pipSval == "144P" ? "27%" : "32%"}` }} ref={sm} className="cs-sub-recordpiv"></div>
                                                                            <div style={{ bottom: 0, right: 0, width: `${pipSval == "144P" ? "22%" : "27%"}`, height: `${pipSval == "144P" ? "27%" : "32%"}` }} ref={sb} className="cs-sub-recordpiv"></div>
                                                                        </div>
                                                                    </div>
                                                                </div>
                                                            </Col>
                                                        </div>
                                                    </Col>
                                                </Row>
                                                <Row>
                                                    <Col lg={12}>
                                                        <Divider orientation="left" style={{ borderColor: "#121212", fontWeight: "900" }}>Streaming RTMP Settings</Divider>
                                                    </Col>
                                                    <Col lg={6}>
                                                        <Form.Item label="Facebook" name='facebook' layout='inline' className='mb-2'><Switch className="mx-3" checked={fbVal} name='facebook' onChange={(value) => onSwitchChange(value, 'facebook')} checkedChildren="On" unCheckedChildren="Off" /></Form.Item>
                                                        <Input value={lsOptions.fb_rtmp} name='fb_rtmp' onChange={handleonChange} disabled={!fbVal} placeholder="Facebook RTMP Value" />
                                                    </Col>
                                                    <Col lg={6}>
                                                        <Form.Item label="Youtube" name='youtube' layout='inline' className='mb-2'><Switch className="mx-3" checked={ytVal} name='youtube' onChange={(value) => onSwitchChange(value, 'youtube')} checkedChildren="On" unCheckedChildren="Off" /></Form.Item>
                                                        <Input value={lsOptions.yt_rtmp} name='yt_rtmp' onChange={handleonChange} disabled={!ytVal} placeholder="Youtube RTMP Value" />
                                                    </Col>
                                                    <Col lg={6}>
                                                        <Form.Item label="Twitch" name='twitch' layout='inline' className='mt-4 mb-2'><Switch className="mx-3" checked={twtVal} name='twitch' onChange={(value) => onSwitchChange(value, 'twitch')} checkedChildren="On" unCheckedChildren="Off" /></Form.Item>
                                                        <Input value={lsOptions.twt_rtmp} name='twt_rtmp' onChange={handleonChange} disabled={!twtVal} placeholder="Twitch RTMP Value" />
                                                    </Col>
                                                    <Col lg={6}>
                                                        <Form.Item label="Linkedin" name='linkedin' layout='inline' className='mt-4 mb-2'><Switch className="mx-3" checked={lkdVal} name='linkedin' onChange={(value) => onSwitchChange(value, 'linkedin')} checkedChildren="On" unCheckedChildren="Off" /></Form.Item>
                                                        <Input value={lsOptions.lkd_rtmp} name='lkd_rtmp' onChange={handleonChange} disabled={!lkdVal} placeholder="Linkedin RTMP Value" />
                                                    </Col>
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

export default withRouter(Ls);

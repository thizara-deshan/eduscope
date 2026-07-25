import React, { useState, useRef, useEffect } from "react";
import {
    Row,
    Col,
    Container,
    Label,
    FormGroup,
} from "reactstrap";
import { Link, useHistory } from "react-router-dom";
import jpeg from "jpeg-js"
import { withRouter } from 'react-router-dom'
import { Button as ButtonAnt, Input as InputAnt, Divider, Select, PageHeader, Layout, Alert, Switch, Slider, message, Modal } from 'antd';
import CaptureSetupCtrl from "../../controllers/CaptureSetup_ctrl";
import placeholder from "../../assets/images/placeholder.gif"
import logo from "../../assets/images/logo.png"
import emptyImg from "../../assets/images/empty.png"
import LsCtrl from "../../controllers/ls_ctrl";
import LmcCtrl from "../../controllers/lmc_ctrl";
import SettingsCtrl from "../../controllers/Settings_ctrl";
import { createBrowserHistory } from "history";
import openSocket from 'socket.io-client';

const CaptureSetup = () => {
    const socket = useRef();
    const { Header, Content } = Layout;
    const { Option } = Select;
    URL = window.webkitURL;
    const [privPipe, setPrivPipe] = useState(true);

    const { confirm } = Modal;

    // Refresh on exit
    const history = createBrowserHistory({ forceRefresh: true });

    // const history = useHistory();
    const [rtspOptions, setRtspOptions] = useState({});
    const [isLoad, setIsLoad] = useState(false);
    const [deviceMissing, setDeviceMissing] = useState(false);
    const [rtspOn, setRtspOn] = useState(false);
    const [rtspOn2, setRtspOn2] = useState(false);
    const [CamDevices, setCamDevices] = useState([]);
    const [BEDevices, setBEDevices] = useState([]);
    const firstUpdate = useRef(true);

    const key = 'loading'

    const [pipval, setPipval] = useState("");
    const [pipSval, setPipSval] = useState("");
    const [pipPval, setPipPval] = useState("");
    const [sidePval, setSidePval] = useState("");

    const [amval, setAmval] = useState(true);

    // Connected devices list
    const [videoDevices, setVideoDevice] = useState([]);
    const [audioInDevices, setAudioInDevice] = useState([]);
    const [audioOutDevices, setAudioOutDevice] = useState([]);
    const [localstream, setLocalstream] = useState([]);

    // Data stored on DB
    const [csOptions, setCsOption] = useState({
        presentation_source: '',
        presenter_source: '',
        audioin_source: '',
        audioout_source: '',
        audio_mix: '',
        audio1_gain: '',
        audio2_gain: '',
        rec_method: '',
        pip_pos: '',
        single_source: '',
        s_pip_pos: '',
        pip_size: '',
        userid: ''
    });

    // Position refs
    const tl = useRef(null);
    const tr = useRef(null);
    const bl = useRef(null);
    const br = useRef(null);

    const st = useRef(null);
    const sm = useRef(null);
    const sb = useRef(null);

    // Video Ref
    const vidRefPresentation = useRef(null);
    const vidRefPresenter = useRef(null);
    const [vidRefRecord, setvidRefRecord] = useState(emptyImg);


    const [tlv, settlv] = useState(emptyImg);
    const [trv, settrv] = useState(emptyImg);
    const [blv, setblv] = useState(emptyImg);
    const [brv, setbrv] = useState(emptyImg);

    const [stv, setstv] = useState(emptyImg);
    const [smv, setsmv] = useState(emptyImg);
    const [sbv, setsbv] = useState(emptyImg);

    const [videoRef50lv, setvideoRef50lv] = useState(emptyImg);
    const [videoRef50rv, setvideoRef50rv] = useState(emptyImg);

    const [imgs1, setImgs1] = useState('');
    const [imgs2, setImgs2] = useState('');


    const [applyVal, setApplyVal] = useState(false);


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


    // Get camera feed
    console.log(process.env.REACT_APP_SERVER_IP);

    useEffect(async () => {
        const newsocket = openSocket(`http://${process.env.REACT_APP_SERVER_IP}:3000`, { transports: ['websocket'] });
        socket.current = newsocket;
        await loadSettings();
        return () => newsocket.disconnect();
    }, [])

    const getRtspLink = async () => {
        let data;
        let data2;
        await SettingsCtrl.DissGet(1).then((res) => {
            data = res.filter(val => val.title == 'rtsplink').reduce((acc, cur) => ({ ...acc, [cur.title]: cur.s_value }), {})
            // setRtspOptions({ ...rtspOptions, ...data })
            data2 = res.filter(val => val.title == 'rtsplink2').reduce((acc, cur) => ({ ...acc, [cur.title]: cur.s_value }), {})
            setRtspOptions({ ...rtspOptions, ...data2, ...data })
        })
        return { ...data, ...data2 };
    }


    const switchpresentation = (presenter, value) => {
        socket.current.emit('startpriv', true);
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
            if (deviceMissing && (csOptions.presenter_source != 'Select a Device')) { setDeviceMissing(false) }
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
        console.log('ghdjjd----------', rtspOptions);

        CaptureSetupCtrl.CsChangeSnaps(source, { rtspOptions }).then((result) => {
            console.log(result);
            if (deviceMissing && (csOptions.presentation_source != 'Select a Device')) { setDeviceMissing(false) }
            message.success({ content: 'Video Source Loaded!', key, duration: 1 })
            setIsLoad(false)
        }).catch((err) => {
            console.log(err);
            message.error({ content: 'Oops! Something went wrong! Please Try Again.', key, duration: 1 })
            setIsLoad(false)
        })
    }

    useEffect(async () => {
        console.log('new devices----', BEDevices);
        if (firstUpdate.current) {
            firstUpdate.current = false;
            return;
        }
        if ((BEDevices.filter(x => x == "Eduscope UMS ").length) == 1) {
            if (csOptions.presentation_source == 'hdmisource' || csOptions.presentation_source == 'sdisource') {

            } else if (csOptions.presentation_source == 'rtsp') {
                if (!rtspOn) {
                    setCsOption({ ...csOptions, presentation_source: 'Select a Device' })
                    socket.removeAllListeners();
                    setDeviceMissing(true)
                    setImgs1(placeholder)
                    setImgs2(placeholder)
                    setPrivPipe(false)
                }
            } else if (csOptions.presentation_source == 'rtsp2') {
                if (!rtspOn2) {
                    setCsOption({ ...csOptions, presentation_source: 'Select a Device' })
                    socket.removeAllListeners();
                    setDeviceMissing(true)
                    setImgs1(placeholder)
                    setImgs2(placeholder)
                    setPrivPipe(false)
                }
            } else {
                if (BEDevices.length != 2) {
                    setCsOption({ ...csOptions, presenter_source: 'Select a Device', presentation_source: 'Select a Device' });
                    socket.removeAllListeners();
                    setDeviceMissing(true)
                    setImgs1(placeholder)
                    setImgs2(placeholder)
                    setPrivPipe(false)
                }
            }

            if (csOptions.presenter_source == 'hdmisource' || csOptions.presenter_source == 'sdisource') {

            } else if (csOptions.presenter_source == 'rtsp') {
                if (!rtspOn) {
                    setCsOption({ ...csOptions, presenter_source: 'Select a Device' })
                    socket.removeAllListeners();
                    setDeviceMissing(true)
                    setImgs1(placeholder)
                    setImgs2(placeholder)
                    setPrivPipe(false)
                }
            } else if (csOptions.presenter_source == 'rtsp2') {
                if (!rtspOn2) {
                    setCsOption({ ...csOptions, presenter_source: 'Select a Device' })
                    socket.removeAllListeners();
                    setDeviceMissing(true)
                    setImgs1(placeholder)
                    setImgs2(placeholder)
                    setPrivPipe(false)
                }
            } else {
                if (BEDevices.length != 2) {
                    setCsOption({ ...csOptions, presentation_source: 'Select a Device', presenter_source: 'Select a Device' })
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
            console.log("devices", resDevices);
            // setBEDevices(resDevices)
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
    //     //     getVideo(vidRefPresentation, csOptions.presentation_source);
    //     //     getVideo(vidRefRecord, csOptions.presentation_source);
    //     console.log("---1", imgs1);
    //     setvidRefRecord(imgs1);
    //     console.log("---1", vidRefRecord);
    // }, [csOptions.presentation_source]);

    useEffect(() => {
        //     getVideo(vidRefPresentation, csOptions.presentation_source);
        //     getVideo(vidRefRecord, csOptions.presentation_source);
        setvidRefRecord(imgs1);
        if (csOptions.rec_method == '50-50') {
            setvideoRef50lv(imgs1);
        }
    }, [imgs1]);

    useEffect(() => {
        if (csOptions.rec_method == '50-50') {
            setvideoRef50rv(imgs2);
        }
        else if (csOptions.rec_method == 'Side') {
            loadPriv(csOptions.s_pip_pos, imgs2)
        }
        else if (csOptions.rec_method == 'PIP') {
            loadPriv(csOptions.pip_pos, imgs2)
        }
    }, [imgs2]);



    // useEffect(() => {
    //     getVideo(vidRefPresenter, csOptions.presenter_source);
    // }, [csOptions.presenter_source]);

    const getVideo = (location, id) => {
        console.log('-------', id);

        navigator.getUserMedia = (navigator.getUserMedia || navigator.webkitGetUserMedia || navigator.mozGetUserMedia || navigator.msGetUserMedia);

        if (navigator.getUserMedia && id) {
            navigator.mediaDevices.getUserMedia(
                // constraints
                {
                    video: {
                        width: 640,
                        height: 360,
                        frameRate: 25,
                        deviceId: { exact: id }
                    }
                }).then(stream => {
                    setLocalstream([...localstream, stream])
                    let video = location.current;
                    video.srcObject = stream;
                    video.play();
                })
                .catch(err => {
                    console.error("error:", err);
                });
        } else {
            console.log("getUserMedia not supported");
        }
    }

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
        CaptureSetupCtrl.CsGet(1).then(async (res) => {
            message.success({ content: 'Success!', key, duration: 1 })
            setIsLoad(false)
            // Get array and create object with needed values
            let data = res.reduce((acc, cur) => ({ ...acc, [cur.title]: cur.s_value }), {})
            console.log(CamDevices);
            console.log("-----testting-----", CamDevices.filter(x => x === "Eduscope UMS ").length);



            setCsOption({
                presentation_source: data.presentation_source,
                presenter_source: data.presenter_source,
                audioin_source: data.audioin_source,
                audioout_source: data.audioout_source,
                audio_mix: data.audio_mix,
                audio1_gain: data.audio1_gain,
                audio2_gain: data.audio2_gain,
                rec_method: data.rec_method,
                pip_pos: data.pip_pos,
                single_source: data.single_source,
                s_pip_pos: data.s_pip_pos,
                pip_size: data.pip_size,
                userid: res[0].userid
            })

            if (data.audio_mix == '1') {
                setAmval(true)
            }
            onPipChange(data.rec_method)
            if (data.rec_method == 'PIP') {
                onPipPChange(data.pip_pos);
                onPipSChange(data.pip_size);
                // loadPriv(data.pip_pos, data.presenter_source)
            }
            if (data.rec_method == 'Side') {
                onSidePChange(data.s_pip_pos);
                onPipSChange(data.pip_size);
                // loadPriv(data.s_pip_pos, data.presenter_source)
            }
            getRtspLink().then((datart) => {
                getDeviceList().then((devices) => {
                    console.log(devices);
                    console.log(rtspOptions);

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

                            //         console.log(csOptions.rec_method);
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


    const loadPriv = (refval, source) => {
        var ref;
        if (refval == "Top-Left") { ref = settlv }
        if (refval == "Top-Right") { ref = settrv }
        if (refval == "Bottom-Left") { ref = setblv }
        if (refval == "Bottom-Right") { ref = setbrv }

        if (refval == "Top") { ref = setstv }
        if (refval == "Middle") { ref = setsmv }
        if (refval == "Bottom") { ref = setsbv }

        ref(source);
        // getVideo(ref, source);
    }


    const apply = () => {
        message.loading({ content: 'Applying Settings...', key, duration: 0 })
        setIsLoad(true)
        CaptureSetupCtrl.CsApply(csOptions).then((res) => {
            if (res.success) {
                message.success({ content: 'Settings Applied', key, duration: 1 });
                setApplyVal(false)
                setIsLoad(false)
                // loadSettings();
                // window.location.reload();
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

    // Handle Changes
    const sliderOnChange = (name, value) => {

        setCsOption({ ...csOptions, [name]: value });
        console.log(name, value);

    }

    const handleDropDowns = (value, event) => {
        setApplyVal(true)
        setCsOption({ ...csOptions, [event.name]: value });
        if (event.name == "presentation_source") {
            switchpresentation(csOptions.presenter_source, value)
        }
        if (event.name == "presenter_source") {
            switchpresenter(csOptions.presentation_source, value)
        }
        if (event.name == "rec_method") { onPipChange(value); }
        if (event.name == "pip_pos") { onPipPChange(value); }
        if (event.name == "s_pip_pos") { onSidePChange(value); }
        if (event.name == "pip_size") { onPipSChange(value); }
        console.log(csOptions)
    }

    const amOnchange = (val) => {
        setAmval(prevCheck => !prevCheck);
        val ? setCsOption({ ...csOptions, audio_mix: '1' }) : setCsOption({ ...csOptions, audio_mix: '0' });
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
                                                        subTitle="Capture Setup"
                                                        extra={[
                                                            <ButtonAnt className='cus-btn1' disabled={isLoad} key="1" type="default" onClick={apply}>
                                                                Apply
                                                            </ButtonAnt>,
                                                            <ButtonAnt key="2" className="reset-btn cus-btn1" disabled={isLoad} type="dashed" onClick={() => { console.log("Reset"); }}>
                                                                Reset
                                                            </ButtonAnt>,
                                                            <ButtonAnt key="3" disabled={isLoad} type="primary" className='cus-btn1' onClick={() => {
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
                                            <Content className="my-5 scroll-bar-cus" style={{ padding: '0 50px' }}>

                                                <Row>
                                                    <Col lg={3}>
                                                        <div className={csOptions.single_source == "Presenter" && csOptions.rec_method == "Single" ? "d-none" : ""}>

                                                            <Divider orientation="left" style={{ borderColor: "#121212", fontWeight: "900" }}>Presentation Preview</Divider>
                                                            <img className={csOptions.presentation_source == '' || privPipe ? "empty-vid" : "recordpiv"} src={imgs1}></img>
                                                            <div>
                                                                <Select disabled={isLoad} className="my-3" placeholder="Presentation Source" value={csOptions.presentation_source} style={{ width: "100%" }} onSelect={(value, event) => handleDropDowns(value, event)}>
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
                                                                        if (device == 'Presentation') { return true } else { return false }
                                                                    }).map((device) => {
                                                                        let deviceid;
                                                                        console.log("--", device);
                                                                        if (device == "Presentation") { deviceid = "hdmisource" }
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
                                                            {/* <video className={csOptions.presentation_source == '' ? "empty-vid" : "recordpiv"} ref={vidRefPresentation}></video> */}

                                                            {/* <h6 className="text-center ">Presentation Preview</h6> */}
                                                        </div>
                                                    </Col>
                                                    <Col lg={3}>
                                                        <div className={csOptions.single_source == "Presentation" && csOptions.rec_method == "Single" ? "d-none" : ""}>
                                                            <Divider orientation="left" style={{ borderColor: "#121212", fontWeight: "900", fontWeight: "900" }}>Presenter Preview</Divider>
                                                            <img className={csOptions.presenter_source == '' || privPipe ? "empty-vid" : "recordpiv"} src={imgs2}></img>
                                                            <div>
                                                                <Select disabled={isLoad} className="my-3" placeholder="Camera Source" value={csOptions.presenter_source} style={{ width: "100%" }} onSelect={(value, event) => handleDropDowns(value, event)}>
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
                                                                        else {
                                                                            deviceid = "any device id"
                                                                        }
                                                                        console.log("--------", device);

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
                                                            {/* <video className={csOptions.presenter_source == '' ? "empty-vid" : "recordpiv"} ref={vidRefPresenter}></video> */}
                                                            {/* <h6 className="text-center ">Presenter Preview</h6> */}
                                                        </div>
                                                    </Col>
                                                    <Col lg={6}>
                                                        {/* <video className="recordpiv" ref={vidRefPresenter}></video> */}
                                                        <div className="cs-recordpiv" style={{ position: "relative" }}>
                                                            <img className={csOptions.rec_method == "PIP" ? 'recordpiv' : csOptions.rec_method == "Side" ? 'recordpiv-ss' : 'd-none'} src={vidRefRecord} style={{ width: `${csOptions.rec_method == "PIP" ? "100%" : pipSval == "144P" ? "77%" : "72%"}`, position: "absolute", top: "0", margin: "0" }}></img>
                                                            <img className={csOptions.rec_method == "Single" ? 'recordpiv' : 'd-none'} src={csOptions.single_source == 'Presentation' ? imgs1 : imgs2} style={{ width: "100%", position: "absolute", top: "0", margin: "0" }}></img>
                                                            <div className={csOptions.rec_method == "PIP" ? "" : "d-none"}>
                                                                <img style={{ background: "none", top: 0, left: 0, width: `${pipSval == "144P" ? "20%" : "25%"}`, height: `${pipSval == "144P" ? "20%" : "25%"}` }} src={csOptions.pip_pos == 'Top-Left' ? tlv : emptyImg} className="cs-sub-recordpiv"></img>
                                                                <img style={{ background: "none", top: 0, right: 0, width: `${pipSval == "144P" ? "20%" : "25%"}`, height: `${pipSval == "144P" ? "20%" : "25%"}` }} src={csOptions.pip_pos == 'Top-Right' ? trv : emptyImg} className="cs-sub-recordpiv"></img>
                                                                <img style={{ background: "none", bottom: 0, left: 0, width: `${pipSval == "144P" ? "20%" : "25%"}`, height: `${pipSval == "144P" ? "20%" : "25%"}` }} src={csOptions.pip_pos == 'Bottom-Left' ? blv : emptyImg} className="cs-sub-recordpiv"></img>
                                                                <img style={{ background: "none", bottom: 0, right: 0, width: `${pipSval == "144P" ? "20%" : "25%"}`, height: `${pipSval == "144P" ? "20%" : "25%"}` }} src={csOptions.pip_pos == 'Bottom-Right' ? brv : emptyImg} className="cs-sub-recordpiv"></img>
                                                            </div>
                                                            <div className={csOptions.rec_method == "50-50" ? "" : "d-none"}>
                                                                <img src={videoRef50lv} style={{ background: "none", top: 0, left: 0, marginTop: "14%" }} className="cs-sub-50-recordpiv"></img>
                                                                <img src={videoRef50rv} style={{ background: "none", top: 0, right: 0, marginTop: "14%" }} className="cs-sub-50-recordpiv"></img>
                                                            </div>
                                                            <div className={csOptions.rec_method == "Separate" ? "" : "d-none"}>
                                                                <Alert style={{ position: "absolute", transform: "translate(-0%, -50%)", top: "50%" }} message="Video files will be recorded separately" type="info" showIcon />
                                                            </div>
                                                            <div className={csOptions.rec_method == "Side" ? "" : "d-none"}>
                                                                <img style={{ background: "none", top: 0, right: 0, width: `${pipSval == "144P" ? "22%" : "27%"}`, height: `${pipSval == "144P" ? "22%" : "27%"}` }} src={csOptions.s_pip_pos == 'Top' ? stv : emptyImg} className="cs-sub-recordpiv"></img>
                                                                <img style={{ background: "none", top: 0, right: 0, marginTop: "19%", width: `${pipSval == "144P" ? "22%" : "27%"}`, height: `${pipSval == "144P" ? "22%" : "27%"}` }} src={csOptions.s_pip_pos == 'Middle' ? smv : emptyImg} className="cs-sub-recordpiv"></img>
                                                                <img style={{ background: "none", bottom: 0, right: 0, width: `${pipSval == "144P" ? "22%" : "27%"}`, height: `${pipSval == "144P" ? "22%" : "27%"}` }} src={csOptions.s_pip_pos == 'Bottom' ? sbv : emptyImg} className="cs-sub-recordpiv"></img>
                                                            </div>
                                                        </div>
                                                    </Col>
                                                </Row>
                                                <Row>
                                                    {/* <Col lg={6}>
                                                        <Divider orientation="left" style={{ borderColor: "#121212", fontWeight: "900" }}>Audio Options</Divider>
                                                        <Select disabled={isLoad} className="my-2" placeholder="Audio Source 1" value={csOptions.audioin_source} style={{ width: "100%" }} onSelect={(value, event) => handleDropDowns(value, event)}>
                                                            {audioInDevices.map((device) => (
                                                                <Option name="audioin_source" key={device.deviceId} value={device.deviceId}>
                                                                    {device.label}
                                                                </Option>
                                                            ))}
                                                        </Select>
                                                        <Select disabled={isLoad} className="my-2" placeholder="Audio Source 2" value={csOptions.audioout_source} style={{ width: "100%" }} onSelect={(value, event) => handleDropDowns(value, event)}>
                                                            {audioInDevices.map((device) => (
                                                                <Option name="audioout_source" key={device.deviceId} value={device.deviceId}>
                                                                    {device.label}
                                                                </Option>
                                                            ))}
                                                        </Select>
                                                        <div className="d-grid">
                                                            <div className="d-inline my-2">
                                                                <Label>Audio Mix:</Label><Switch className="mx-3" checked={amval} onChange={amOnchange} checkedChildren="On" unCheckedChildren="Off" />
                                                            </div>
                                                            <div className="d-inline-block mt-2">
                                                                <Label>Gain Primary Audio:</Label><Slider min={1} max={100} step={0.1} tooltipVisible tooltipPlacement="right" value={csOptions.audio1_gain} onChange={(value) => { sliderOnChange('audio1_gain', value) }} />
                                                            </div>
                                                            <div className="d-inline-block">
                                                                <Label>Gain Secondary Audio:</Label><Slider min={1} max={100} step={0.1} tooltipVisible tooltipPlacement="right" value={csOptions.audio2_gain} onChange={(value) => { sliderOnChange('audio2_gain', value) }} />
                                                            </div>
                                                        </div>
                                                    </Col> */}
                                                    <Col lg={6}>
                                                        <Divider orientation="left" style={{ borderColor: "#121212", fontWeight: "900" }}>PIP Options</Divider>
                                                        <div className="d-flex">
                                                            <Col lg={6} sm={6}>
                                                                <div className="d-grid">
                                                                    <div className="px-1 d-inline-block mt-2">
                                                                        <Select disabled={isLoad} className="my-2" placeholder="Record Method" value={csOptions.rec_method} style={{ width: "100%" }} onSelect={(value, event) => handleDropDowns(value, event)}>
                                                                            <Option name='rec_method' value="Single">Single Files</Option>
                                                                            <Option name='rec_method' value="Separate">Separate Files</Option>
                                                                            <Option name='rec_method' value="PIP">PIP</Option>
                                                                            <Option name='rec_method' value="50-50">50-50</Option>
                                                                            <Option name='rec_method' value="Side">Side By Side</Option>
                                                                        </Select>
                                                                    </div>
                                                                </div>
                                                                <Col lg={12}>
                                                                    <div className={pipval == "PIP" ? "px-1 mt-2" : "d-none"}>
                                                                        <Select className="my-2" placeholder="PIP Position" value={csOptions.pip_pos} style={{ width: "100%" }} onSelect={(value, event) => handleDropDowns(value, event)}>
                                                                            <Option name='pip_pos' value="Top-Left">Top Left</Option>
                                                                            <Option name='pip_pos' value="Top-Right">Top Right</Option>
                                                                            <Option name='pip_pos' value="Bottom-Left">Bottom Left</Option>
                                                                            <Option name='pip_pos' value="Bottom-Right">Bottom Right</Option>
                                                                        </Select>
                                                                    </div>
                                                                    <div className={pipval == "Single" ? "px-1 mt-2" : "d-none"}>
                                                                        <Select className="my-2" placeholder="Single File Source" value={csOptions.single_source} style={{ width: "100%" }} onSelect={(value, event) => handleDropDowns(value, event)}>
                                                                            <Option name='single_source' value="Presenter">Presenter Only</Option>
                                                                            <Option name='single_source' value="Presentation">Presentation Only</Option>
                                                                        </Select>
                                                                    </div>
                                                                    <div className={pipval == "Side" ? "px-1 mt-2" : "d-none"}>
                                                                        <Select className="my-2" placeholder="PIP Position" value={csOptions.s_pip_pos} style={{ width: "100%" }} onSelect={(value, event) => handleDropDowns(value, event)}>
                                                                            <Option name='s_pip_pos' value="Top">Top</Option>
                                                                            <Option name='s_pip_pos' value="Middle">Middle</Option>
                                                                            <Option name='s_pip_pos' value="Bottom">Bottom</Option>
                                                                        </Select>
                                                                    </div>
                                                                </Col>
                                                                <Col lg={12}>
                                                                    <div className={pipval == "PIP" || pipval == "Side" ? "px-1 mt-2" : "d-none"}>
                                                                        <Select className="my-2" placeholder="PIP Size" value={csOptions.pip_size} style={{ width: "100%" }} onSelect={(value, event) => handleDropDowns(value, event)}>
                                                                            <Option name='pip_size' value="144P">144P</Option>
                                                                            <Option name='pip_size' value="240P">240P</Option>
                                                                        </Select>
                                                                    </div>
                                                                </Col>
                                                            </Col>
                                                            <Col lg={6} sm={6} >
                                                                <div className="p-3">
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
                                                                        <div className={pipval == "Separate" ? "" : "d-none"}>
                                                                            <Alert style={{ position: "absolute", transform: "translate(-0%, -50%)", top: "50%" }} message="Video files will be recorded separately" type="info" showIcon />
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
                                            </Content>
                                        </Layout>
                                    </Col>
                                </div>
                            </div>
                        </Col>
                        <img className="copyright-logo" src={logo} style={{
                            width: "10%", position: "absolute", bottom: "0.5%", left: "18px"
                        }} />
                    </Row>
                </Container>
            </div>
        </React.Fragment >
    );
};

export default withRouter(CaptureSetup);

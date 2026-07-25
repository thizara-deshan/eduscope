import React, { useState, useEffect, useRef } from "react";
import {
  Row,
  Col,
  Container,
} from "reactstrap";
import { GrResume } from "react-icons/gr";
import { Link, useHistory, useLocation } from "react-router-dom";
import { withRouter } from 'react-router-dom'
import RecordStatus from "../../controllers/recstatus";
import StreamStatus from "../../controllers/streamstatus";
import { Button as ButtonAnt, Input as InputAnt, Collapse, Alert, Divider, Select, PageHeader, Layout, Switch, Typography, Statistic, Progress, message, Modal } from 'antd';
import { PlayCircleOutlined, PauseCircleOutlined, BorderOutlined, PoweroffOutlined, LogoutOutlined, ExclamationCircleOutlined } from '@ant-design/icons';
import CaptureSetupCtrl from "../../controllers/CaptureSetup_ctrl";
import "react-simple-keyboard/build/css/index.css";
import SettingsCtrl from "../../controllers/Settings_ctrl";
import SliitData from "../../controllers/SliitData";
import LmcCtrl from "../../controllers/lmc_ctrl";
import logo from "../../assets/images/logo.png"
import LsCtrl from "../../controllers/ls_ctrl";
import useAuth from "../../useAuth";
import jwt from 'jwt-decode'

import PresetBox from '../../components/PresetBox'

import preset5050 from "../../assets/images/5050.png"
import presetsbs from "../../assets/images/sbs.png"
import presetsingle from "../../assets/images/si.png"
import presetsf from "../../assets/images/sf.png"
import presetcam1cam2 from "../../assets/images/cam1cam2.png"
import presetcam2 from "../../assets/images/cam2.png"


import openSocket from 'socket.io-client';

const Home = () => {
  const socket = useRef();
  const { logout, user } = useAuth();
  const userdata = localStorage.getItem('usertoken');
  let role = user.role || jwt(userdata).role;
  let username = user.username || jwt(userdata).username;
  const isAdmin = role == 'admin'
  const userid = user.user_id || jwt(userdata).user_id;

  const { Panel } = Collapse;

  const { Header, Content } = Layout;
  const { Text } = Typography;
  const { Countdown } = Statistic;
  const [rtspOptions, setRtspOptions] = useState({});
  const [options, setOptions] = useState({ module: null, lecture_hall: null, topic: null, maxdu: null, userid: userid });
  const [recstart, setRecstart] = useState(false);
  const [isSliit, setIsSliit] = useState(false);
  const [isEduStream, setIsEduStream] = useState(false);
  const [streamstart, setStreamstart] = useState(false);
  const [stream, setStream] = useState(false);
  const [recLoading, setRecloading] = useState(false);
  const [rectext, setRecttext] = useState(false);
  const [streamtext, setStreamttext] = useState(false);
  const [btnClicked, setBtnClicked] = useState(false);
  const [isPaused, setIsPaused] = useState(0);
  const { Option } = Select;
  const toggleRec = () => setRecstart(!recstart);
  const toggleStream = () => setStreamstart(!streamstart);
  const history = useHistory();
  const firstUpdate = useRef(true);
  const [presetValueC, setPresetValueC] = useState('');
  const [presetValueL, setPresetValueL] = useState('');
  const [presetValueS, setPresetValueS] = useState('');

  const [lsCollapse, setLsCollapse] = useState(undefined);

  const [isLoad, setIsLoad] = useState(false);
  const [applyState, setApplyState] = useState(0);

  const loadkey = 'loading'

  const [recOnProcess, setRecOnProcess] = useState(false);
  const [sameUser, setSameUser] = useState(false);

  const [storageData, setStorageData] = useState({
    size: 30531596,
    avail: 13497312,
    pecnt: '54%'
  });

  // Web socket
  // const imgs = useRef();
  const [imgs1, setImgs1] = useState('');
  const [imgs2, setImgs2] = useState('');

  // RTMP val
  const [rtmpVal, setRtmpVal] = useState([]);

  // Data stored on DB
  const [csOptions, setCsOption] = useState({});
  const [lmcOptions, setLmcOption] = useState({});
  const [lsOptions, setLsOption] = useState({});

  // sliit data
  const [sdModules, setSdModules] = useState([]);
  const [sdLecHalls, setSdLecHalls] = useState([]);


  useEffect(async () => {
    if (firstUpdate.current) {
      firstUpdate.current = false;
      return;
    }
    if (recstart) {

      socket.current.emit('startrec', true);
      if (recOnProcess) {
        await loadCapSettings;
        console.log('test2');
      }

      console.log('cs Option Record method:', csOptions.rec_method);

      if (csOptions.rec_method == "Separate") {
        socket.current.off("image1").on("image1", function (info) {
          console.log('called');

          if (info.image) {
            setImgs1(`data:image/jpeg;base64,${info.buffer}`)
          }
        });

        socket.current.off("image2").on("image2", function (info) {
          console.log('called');

          if (info.image) {
            setImgs2(`data:image/jpeg;base64,${info.buffer}`)
          }
        });
      } else {
        socket.current.off("image1").on("image1", function (info) {
          console.log('called');

          if (info.image) {
            setImgs1(`data:image/jpeg;base64,${info.buffer}`)
          }
        });
      }
    } else {
      console.log('stoppp------');
      socket.current.off("image1");
      setImgs1(null)
      socket.current.off("image2");
      setImgs2(null)
      socket.current.emit('startrec', false);
    }
  }, [recstart])


  // Set option values from UI
  const handleDropDowns = (value, event) => {
    setOptions({ ...options, [event.name]: value })
  }

  const handleChange = (event) => {
    let value = event.target.value;
    let name = event.target.name;
    setOptions({ ...options, [name]: value });
    // setInput(value)
    // keyboard.current.setInput(value);

  }

  const key = 'loading'


  const { confirm } = Modal;

  const poweroff = () => {
    console.log('poweroff');
    confirm({
      title: 'Do you want to Power Off the device?',
      icon: <ExclamationCircleOutlined />,
      onOk() {
        message.loading({ content: 'Shutting Down...', key, duration: 0 })
        SettingsCtrl.PowerOff().then((res) => {
          if (res.success) {
            message.success({ content: 'Device Shutdown Successfully!', key, duration: 1 })

          }
        }).catch((err) => {
          console.log(err);
          message.success({ content: 'Device Shutdown Successfully!', key, duration: 1 })

          // message.error({ content: 'Oops! Something went wrong! Please Try Again. Check Connection!', key, duration: 1 })
        })
      },
      onCancel() {
        console.log('Canceled');
      },
    });
  }

  const logoutfunc = () => {
    console.log('logout');
    confirm({
      title: 'Do you want to Logout?',
      icon: <ExclamationCircleOutlined />,
      onOk() {
        message.loading({ content: 'Logging Out...', key, duration: 0 })
        logout()
          .catch((err) => {
            console.log(err);
            message.error({ content: 'Oopz.. Something Went Wrong! Try Again.', key, duration: 1 })
          })
      },
      onCancel() {
        console.log('Canceled');
      },
    });
  }

  // Take encode settings from database when loading UI
  useEffect(async () => {
    const newsocket = openSocket(`http://${process.env.REACT_APP_SERVER_IP}:3000`, { transports: ['websocket'] });
    socket.current = newsocket;

    console.log('test before');
    await getSettings()
    console.log('test after');

    // check if record already running
    getRecStatus();

    // Get network settings
    loadNetCamSettings();

    // Get encorder settings
    await loadEncSettings();


    const key = 'warning';

    // Get Storage Data
    SettingsCtrl.getStorage().then((res) => {
      let data = res.data.split(' ').filter(i => i);
      setStorageData({
        size: parseInt(data[0]),
        avail: parseInt(data[1]),
        pecnt: data[2]
      })
      if (100 - Math.round((parseInt(data[1]) / parseInt(data[0])) * 100, 2) > 70) {
        message.warning({ content: 'Files will be automatically deleted when storage usage reaches 80%', duration: 0, key: key })
      }
    })

    return () => newsocket.disconnect();

  }, [])

  useEffect(() => {
    console.log(isSliit);

    if (isSliit || isEduStream) {
      // Get module list
      getModules()

      if (isSliit) {
        // Get module list
        getLecHalls()
      }

    }
  }, [isSliit, isEduStream])

  const getSettings = async () => {
    // Get capture setup settings
    await loadCapSettings();

    // Get Live Meeting Connect Settings
    loadLmcSettings();


    // Get live stream paras and settings
    LsCtrl.LsGet(1).then((res) => {
      let data = res.reduce((acc, cur) => ({ ...acc, [cur.title]: cur.s_value }), {})
      console.log(res);

      if (data.fb == '1') {
        setRtmpVal(oldArray => [...oldArray, data.fb_rtmp])
      }
      if (data.yt == '1') {
        setRtmpVal(oldArray => [...oldArray, data.yt_rtmp])
      }
      if (data.twt == '1') {
        setRtmpVal(oldArray => [...oldArray, data.twt_rtmp])
      }
      if (data.lkd == '1') {
        setRtmpVal(oldArray => [...oldArray, data.lkd_rtmp])
      }

      setLsOption({ ...lsOptions, ...data })

    })
  }

  const getModules = () => {
    SliitData.SdModules().then((res) => {
      console.log(res);
      setSdModules(res.data)

    })
  }

  const getLecHalls = () => {
    SliitData.SdLecHalls().then((res) => {
      console.log(res);
      setSdLecHalls(res.data)

    })
  }

  const getRecStatus = () => {
    RecordStatus.checkStatus().then((res) => {
      console.log(res);


      if (res.data.status || (!res.data.status && res.data.pauseval)) {
        setRecOnProcess(true);
        setRecstart(true)
        if (!res.data.status && res.data.pauseval) {
          setRecttext(false)
          setRecstart(false)
        } else {
          setRecttext(true)
          setRecstart(true)
        }
        if (res.data.pauseval) {
          setIsPaused(res.data.pauseval)
        }
        if (res.data.userid == userid) {
          setSameUser(true)
        }
        console.log(res.data);
        options.module = res.data.module;
        options.lecture_hall = res.data.lecture_hall;
        options.topic = res.data.topic;
        options.maxdu = res.data.duration;
        message.warning('Another Recording in Progress!')
      }
    })
  }

  const recbtnpressfunc = (callback) => {
    console.log('-------------------');

    socket.current.off('getbtnstatus').on('getbtnstatus', (data) => {
      console.log('recevied data-------', data);
      let cntdwn;
      if (!data.status) {

        // clearInterval(statustimer)
        if (!btnClicked) {
          confirm({
            title: 'Do you want to Stop Recording?',
            icon: <ExclamationCircleOutlined />,
            content: (<>
              <Countdown title="Recording will automatically stop after 10 Seconds" value={Date.now() + 10 * 1000} />
            </>),
            onOk() {
              recfunc()
              clearTimeout(cntdwn)
              socket.current.emit('reqbtnstatus', false);
            },
            onCancel() {
              console.log('Canceled');
              clearTimeout(cntdwn)
              RecordStatus.upRecStatus({ id: 1, status: 1 })
              socket.current.emit('reqbtnstatus', true);
              recbtnpressfunc()
            },
          });
          cntdwn = setTimeout(() => {
            console.log('time out-----');
            socket.current.emit('reqbtnstatus', false);
            Modal.destroyAll()
            recfunc()
          }, 11000);
        }
      }
    })
  }

  const loadNetCamSettings = () => {
    SettingsCtrl.DissGet(1).then((res) => {
      let data = res.filter(val => val.title == 'rtsplink').reduce((acc, cur) => ({ ...acc, [cur.title]: cur.s_value }), {})
      // setRtspOptions({ ...rtspOptions, ...data })
      let data2 = res.filter(val => val.title == 'rtsplink2').reduce((acc, cur) => ({ ...acc, [cur.title]: cur.s_value }), {})
      setRtspOptions({ ...rtspOptions, ...data2, ...data })
    })
  }

  const loadEncSettings = () => {
    SettingsCtrl.EsGet(1).then((res) => {
      let data = res.reduce((acc, cur) => ({ ...acc, [cur.title]: cur.s_value }), {});

      // assigning userid to options
      data.userid = userid;
      console.log('islsiit', data.domain.split('.')[1] == 'sliit');

      setIsSliit(data.domain.split('.')[1] == 'sliit')
      setIsEduStream(data.domain.split('.')[1] == 'eduscopestream')
      setOptions({ ...options, ...data })

    })
  }

  const loadCapSettings = () => {
    CaptureSetupCtrl.CsGet(1).then((res) => {
      // Get array and create object with needed values
      let data = res.reduce((acc, cur) => ({ ...acc, [cur.title]: cur.s_value }), {})
      console.log(res);
      setCsOption({ ...csOptions, ...data })
    }).then(() => {
      console.log('test1');
      return true;
    })
  }

  const loadLmcSettings = () => {
    LmcCtrl.LmcGet(1).then((res) => {
      // Get array and create object with needed values
      let data = res.reduce((acc, cur) => ({ ...acc, [cur.title]: cur.s_value }), {})
      console.log(res);
      setLmcOption({ ...lmcOptions, ...data })
    })
  }

  // check connectivity
  const chkConnection = () => {
    fetch('//google.com', {
      mode: 'no-cors',
    })
      .then(() => {
        console.log('trueeeee');

        return true
      }).catch(() => {
        console.log('falseeee');

        return false
      })
  }

  // Stream function
  const streamfunc = () => {
    console.log("gg2");
    console.log(streamstart);

    if (!streamstart) {
      console.log("start");
      console.log(options);
      console.log(rtmpVal);

      StreamStatus.startStream(rtmpVal).then((result) => {
        toggleStream()
        setStreamttext(true);
        console.log("----", result);
      })
        .catch(err => {
          console.log(err);
          // toggleStream()
          setStreamttext(false);
        })

    } else {
      console.log("stop");

      StreamStatus.stopStream().then((result) => {
        toggleStream()
        setStreamttext(false);
        console.log(result);

      })
        .catch(err => {
          console.log(err);
          // toggleStream()
          setStreamttext(true);
        })
    }
  }

  // Record function
  const recfunc = async (btnvalue) => {
    console.log("gg");
    console.log(recstart);

    if (options.module && options.topic && options.maxdu || (recstart && (isAdmin || sameUser))) {
      setRecloading(true)

      if (!recstart && btnvalue) {
        console.log("start");
        console.log(options);
        message.loading({ content: 'Record Starting...', key, duration: 0 })

        if (stream) {

          // await chkConnection()
          console.log("---bjdbh---", connected);
          let connected = true
          if (connected) {
            console.log('=================----jjj');

            StreamStatus.startStream(rtmpVal).then((result) => {
              toggleStream()
              setStreamttext(true);
              console.log("stream start----", result);

              // Start record
              setTimeout(() => {
                RecordStatus.startRec(options, { csOptions, lmcOptions, lsOptions, rtspOptions, pauseval: isPaused }).then((result) => {
                  console.log(result);
                  message.success({ content: 'Record Started', key, duration: 1 })
                  setRecloading(false)
                  toggleRec()
                  setRecttext(true);
                  console.log("----", result);

                })
                  .catch(err => {
                    console.log(err);
                    setRecloading(false)
                    // toggleRec()
                    setRecttext(false);
                  })
              }, 5000);
            })
              .catch(err => {
                console.log(err);
                setRecloading(false)
                // toggleStream()
                setStreamttext(false);
              })
          }
        } else {
          console.log("isPaused State: ", isPaused);
          // console.log("pausevar Variable: ", pausevar);
          console.log("recstart State: ", recstart);
          RecordStatus.startRec(options, { csOptions, lmcOptions, lsOptions, rtspOptions, pauseval: isPaused }).then((result) => {
            toggleRec()
            message.success({ content: 'Record Started', key, duration: 1 })
            setRecloading(false)
            setRecttext(true);
            console.log("----", result);
          })
            .catch(err => {
              console.log(err);
              // toggleRec()
              setRecloading(false)
              setRecttext(false);
            })
        }
      } else {
        let pausevar = isPaused;
        if (btnvalue) {
          await setIsPaused(prevCount => prevCount + 1);
          pausevar += 1;
        } else {
          console.log('btn stop false');
          setIsPaused(0);
          setRecloading(false);
          if (isPaused && !recstart) {
            setRecOnProcess(false)
            RecordStatus.upPauseStatus({ id: 0 })
            if (pausevar === 0) { RecordStatus.upgroupID() }
            return;
          }
        }
        console.log("stop");
        console.log("isPaused State: ", isPaused);
        console.log("pausevar Variable: ", pausevar);
        console.log("recstart State: ", recstart);
        message.loading({ content: pausevar ? 'Record Pausing...' : 'Record Stopping...', key, duration: 0 })
        RecordStatus.stopRec(options, { csOptions, pauseval: isPaused }).then((result) => {
          if (recstart && !btnvalue) {
            console.log('lllll');
            RecordStatus.upPauseStatus({ id: 0 })
          } else if (isPaused == 0) {
            console.log('ssss');
            RecordStatus.upPauseStatus({ id: 1 })
          }
          console.log("isPaused State after stop: ", isPaused);
          toggleRec()
          setRecttext(false);
          console.log(result);
          message.success({ content: pausevar ? 'Record Paused' : 'Record Stopped', key, duration: 1 })
          setRecloading(false)
          setRecOnProcess(false)
          if (stream) {

            StreamStatus.stopStream().then((result) => {
              console.log('------stream-------');

              toggleStream()
              setStreamttext(false);
              console.log(result);
            })
              .catch(err => {
                console.log(err);
                // toggleStream()
                setStreamttext(true);
              })
          }
        })
          .catch(err => {
            console.log(err);
            // toggleRec()
            setRecloading(false)
            setRecttext(true);
          })
      }
    } else {
      message.warning("Fill All Fields", 2)
    }

  }

  const checkErr = () => {
    RecordStatus.checkError().then((result) => {
      console.log(result.data.success);
      if (result.data.success) {
        toggleRec()
        setRecttext(<PlayCircleOutlined />);
      }
      console.log(result);

    })
      .catch(err => {
        console.log(err);
        // toggleRec()
        // setRecttext(<PauseCircleOutlined />);
      })

  }

  const streamOnchange = (val) => {
    setStream(prevCheck => !prevCheck);

  }

  const resetRadio = () => {
    setPresetValueC('')
    setPresetValueL('')
    setPresetValueS('')
    setApplyState(0)

  }
  const changePreset = (e, value) => {
    let val = e.target.value;
    if (val.substring(0, 1) == 'c') {
      setPresetValueC(e.target.value)
    } else if (val.substring(0, 1) == 'l') {
      setPresetValueL(e.target.value)
    } else if (val.substring(0, 1) == 's') {
      console.log(e.target.value);

      setPresetValueS(e.target.value)
    }
    setApplyState(value)
  }

  const collapseChange = (e) => {
    setLsCollapse(e[0])
  }

  useEffect(() => {
    console.log(presetValueS);

    if (!lsCollapse && presetValueS == '') {
      setPresetValueS('s_5050')
    }
  }, [lsCollapse])

  useEffect(() => {
    console.log(isPaused);

  }, [isPaused])

  const applyPreset = async () => {

    let presetData = {
      CS: {
        presentation_source: '',
        presenter_source: '',
        rec_method: '',
        s_pip_pos: '',
        pip_size: '',
        userid: 1
      },
      LMC: {
        presentation_source: '',
        presenter_source: '',
        rec_method: '',
        s_pip_pos: '',
        pip_size: '',
        userid: 1
      },
      LS: {
        presentation_source: '',
        presenter_source: '',
        rec_method: '',
        s_pip_pos: '',
        pip_size: '',
        userid: 1
      },
    }
    let layoutValC = ''
    let layoutValL = ''
    let layoutValS = ''

    console.log(presetValueS);

    if (presetValueC != '' && presetValueL != '' && presetValueS != '') {
      message.loading({ content: 'Applying Settings...', key, duration: 0 })
      setIsLoad(true)
      setApplyState(0)
      // Set values for Capture Setup
      if (presetValueC == 'c_5050') {
        presetData.CS.presentation_source = 'hdmisource';
        presetData.CS.presenter_source = 'rtsp';
        presetData.CS.rec_method = '50-50';
        layoutValC = 'PresentationPresenter'
      }
      else if (presetValueC == 'c_sbs') {
        presetData.CS.presentation_source = 'rtsp';
        presetData.CS.presenter_source = 'rtsp2';
        presetData.CS.rec_method = 'Side';
        presetData.CS.s_pip_pos = 'Top';
        presetData.CS.pip_size = '240P';
        layoutValC = 'PresentationPresenter'
      }
      else if (presetValueC == 'c_single') {
        presetData.CS.presentation_source = 'hdmisource';
        presetData.CS.presenter_source = 'rtsp';
        presetData.CS.rec_method = 'Single';
        presetData.CS.s_pip_pos = 'Top';
        presetData.CS.pip_size = '240P';
        layoutValC = 'Presenter'
      }
      else if (presetValueC == 'c_sf') {
        presetData.CS.presentation_source = 'hdmisource';
        presetData.CS.presenter_source = 'rtsp';
        presetData.CS.rec_method = 'Separate';
        presetData.CS.s_pip_pos = 'Top';
        presetData.CS.pip_size = '240P';
        layoutValC = 'PresentationPresenter'
      }

      // Set Values for Live Meeting Connect
      if (presetValueL == 'l_5050') {
        presetData.LMC.presentation_source = 'rtsp';
        presetData.LMC.presenter_source = 'rtsp2';
        presetData.LMC.rec_method = '50-50';
        layoutValL = 'PresentationPresenter'
      }
      else if (presetValueL == 'l_sbs') {
        presetData.LMC.presentation_source = 'rtsp';
        presetData.LMC.presenter_source = 'rtsp2';
        presetData.LMC.rec_method = 'Side';
        presetData.LMC.s_pip_pos = 'Top';
        presetData.LMC.pip_size = '240P';
        layoutValL = 'PresentationPresenter'
      }
      else if (presetValueL == 'l_singleC1') {
        presetData.LMC.presentation_source = 'hdmisource';
        presetData.LMC.presenter_source = 'rtsp';
        presetData.LMC.rec_method = 'Single';
        layoutValL = 'Presenter'
      }
      else if (presetValueL == 'l_singleC2') {
        presetData.LMC.presentation_source = 'hdmisource';
        presetData.LMC.presenter_source = 'rtsp2';
        presetData.LMC.rec_method = 'Single';
        layoutValL = 'Presenter'
      }


      // Set Values for Live Streaming
      if (presetValueS == 's_5050') {
        presetData.LS.presentation_source = 'rtsp';
        presetData.LS.presenter_source = 'rtsp2';
        presetData.LS.rec_method = '50-50';
        layoutValS = 'PresentationPresenter'
      }
      else if (presetValueS == 's_sbs') {
        presetData.LS.presentation_source = 'rtsp';
        presetData.LS.presenter_source = 'rtsp2';
        presetData.LS.rec_method = 'Side';
        presetData.LS.s_pip_pos = 'Top';
        presetData.LS.pip_size = '240P';
        layoutValS = 'PresentationPresenter'
      }
      else if (presetValueS == 's_singleC1') {
        presetData.LS.presentation_source = 'hdmisource';
        presetData.LS.presenter_source = 'rtsp';
        presetData.LS.rec_method = 'Single';
        layoutValS = 'Presenter'
      }
      else if (presetValueS == 's_singleC2') {
        presetData.LS.presentation_source = 'hdmisource';
        presetData.LS.presenter_source = 'rtsp2';
        presetData.LS.rec_method = 'Single';
        layoutValS = 'Presenter'
      }

      CaptureSetupCtrl.CsApply(presetData.CS).then((res) => {
        if (res.success) {
          LsCtrl.LsApply({ ...presetData.LS, layout: layoutValS }).then((res) => {
            if (res.success) {
              LmcCtrl.LmcApply({ ...presetData.LMC, layout: layoutValL }).then((res) => {
                if (res.success) {
                  message.success({ content: 'Settings Applied', key, duration: 1 });
                  setIsLoad(false)
                  getSettings()
                } else {
                  message.error({ content: 'Oops! Something went wrong! Please Try Again.', key, duration: 1 })
                  setIsLoad(false)
                }
              }).catch((err) => {
                console.log(err);
                message.error({ content: 'Oops! Something went wrong! Please Try Again.', key, duration: 1 })
                setIsLoad(false)
              })
            } else {
              message.error({ content: 'Oops! Something went wrong! Please Try Again.', key, duration: 1 })
              setIsLoad(false)
            }
          }).catch((err) => {
            console.log(err);
            message.error({ content: 'Oops! Something went wrong! Please Try Again.', key, duration: 1 })
            setIsLoad(false)
          })
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
    } else {
      message.warning('Select a Preset First!')
    }

  }

  return (
    <React.Fragment>
      <div>
        <Container className='fw-container'>
          <Row className="no-gutters">
            <Col lg={12} className="nopadblock">
              <div className="p-4 d-flex align-items-center min-vh-100">
                <div className="w-100">
                  <Col lg={10} className="bg-white maincontainer mx-auto shadow-lg rounded-3 nopadblock2">
                    <Layout className="bg-white rounded-3">
                      <Header className="p-0 h-auto">
                        <div className="site-page-header-ghost-wrapper">
                          <PageHeader
                            style={{ background: '#001529' }}
                            className="page-header-dark"
                            ghost={false}
                            title="Eduscope UMS"
                            subTitle="Home"
                            extra={[

                              <ButtonAnt key='0' onClick={logoutfunc} type='text' style={{ color: "#ffffff" }}>
                                {username} (Logout)
                              </ButtonAnt>,
                              <ButtonAnt disabled={recstart || recOnProcess || isPaused} className="cus-btn1" key="1" type="primary" onClick={() => { history.push('/menu') }}>
                                Main Menu
                        </ButtonAnt>,
                            ]}
                          >
                          </PageHeader>
                        </div>
                      </Header>
                      <Content className="my-5" style={{ padding: '0 50px' }}>
                        <Row>
                          <Col lg={5} className='border-sec1'>
                            {(isSliit || isEduStream) && sdModules.length != 0 ? <Select showSearch disabled={recstart || recOnProcess} value={options.module} className="my-3" placeholder="Module" style={{ width: "100%" }} onSelect={(value, event) => handleDropDowns(value, event)}>
                              {sdModules.slice(3).map((module, index) => (
                                <Option name="module" key={index} value={module.module}>
                                  {module.module}
                                </Option>
                              ))}
                              {/* <Option name="module" value="itmodule1">IT Module 1</Option>
                              <Option name="module" value="itmodule2">IT Module 2</Option>
                              <Option name="module" value="itmodule3">IT Module 3</Option>
                              <Option name="module" value="itmodule4">IT Module 4</Option> */}
                            </Select> : <InputAnt disabled={recstart || recOnProcess || isPaused} id='topicinput' value={options.module} className="my-3" style={{ width: '100%' }} name='module' onChange={handleChange} placeholder="Module" />
                            }
                            {isSliit && sdLecHalls.length != 0 ? <Select showSearch disabled={recstart || recOnProcess} value={options.lecture_hall} className="my-3" placeholder="Lecture Hall" style={{ width: "100%" }} onSelect={(value, event) => handleDropDowns(value, event)}>
                              {sdLecHalls.map((lecture_hall, index) => (
                                <Option name="lecture_hall" key={index} value={lecture_hall.lecture_hall}>
                                  {lecture_hall.lecture_hall}
                                </Option>
                              ))}
                              {/* <Option name="module" value="itmodule1">IT Module 1</Option>
                              <Option name="module" value="itmodule2">IT Module 2</Option>
                              <Option name="module" value="itmodule3">IT Module 3</Option>
                              <Option name="module" value="itmodule4">IT Module 4</Option> */}
                            </Select> : <InputAnt disabled={recstart || recOnProcess || isPaused} id='topicinput' value={options.lecture_hall} className="my-3" style={{ width: '100%' }} name='lecture_hall' onChange={handleChange} placeholder="Lecture Hall" />
                            }

                            <InputAnt disabled={recstart || recOnProcess || isPaused} id='topicinput' value={options.topic} className="my-3" style={{ width: '100%' }} name='topic' onChange={handleChange} placeholder="Type in Topic" />

                            <Select disabled={recstart || recOnProcess || isPaused} className="my-3" value={options.maxdu} placeholder="Maximum Duration" style={{ width: "100%" }} onSelect={(value, event) => handleDropDowns(value, event)}>
                              <Option name="maxdu" value="1H">1H</Option>
                              <Option name="maxdu" value="2H">2H</Option>
                              <Option name="maxdu" value="3H">3H</Option>
                              <Option name="maxdu" value="4H">4H</Option>
                            </Select>

                            <div className="d-flex mt-4" >
                              <div className={!imgs1 ? "empty-vid" : ""}>
                                <img src={imgs1} className="" style={{ borderRadius: "7px", padding: "2%", top: 0, left: 0, marginTop: "12%" }} width="100%" />
                                <h6 className="text-center ">{csOptions.rec_method == "Separate" ? "Presentation Preview" : "Preview"}</h6>
                              </div>
                              <div className={csOptions.rec_method != "Separate" ? "d-none" : !imgs2 ? "empty-vid" : ""}>
                                <img src={imgs2} className="" style={{ borderRadius: "7px", padding: "2%", top: 0, left: 0, marginTop: "12%" }} width="100%" />
                                <h6 className="text-center ">Presenter Preview</h6>
                              </div>

                            </div>
                          </Col>
                          <Col lg={2} style={{ height: '400px' }} className="d-flex flex-column justify-content-center align-items-center border-sec2" >
                            <div className="text-center">
                              <ButtonAnt
                                type="primary"
                                shape="circle"
                                disabled={(recOnProcess && !isAdmin && !sameUser) || recLoading}
                                onClick={() => setBtnClicked(!btnClicked), () => recfunc(1)}
                                icon={rectext ? <PauseCircleOutlined /> : isPaused ? <GrResume className="resumeicon" /> : <PlayCircleOutlined />}
                                className="recbtn"
                                style={{ background: '#f22613' }}
                                size="large"
                              />
                              <h5 className="text-center mt-2">{recstart ? "Pause" : isPaused ? "Resume" : "Start"}</h5>
                            </div>
                            <div className="mt-4 text-center" style={{ display: rectext || isPaused > 0 ? 'block' : 'none' }}>
                              <ButtonAnt
                                type="primary"
                                shape="circle"
                                disabled={(recOnProcess && !isAdmin && !sameUser) || recLoading}
                                onClick={() => setBtnClicked(!btnClicked), () => recfunc(0)}
                                icon={<BorderOutlined />}
                                className="stpbtn"
                                style={{ background: '#f22613' }}
                                size="large"
                              />
                              <h5 className="text-center mt-2">Stop</h5>
                            </div>
                            <div className="mt-4">
                              <h6 className="text-center mt-2">Stream</h6>
                              <Switch disabled={recstart || recOnProcess || isPaused} className="mx-3" checked={stream} name='stream' onChange={streamOnchange} checkedChildren="On" unCheckedChildren="Off" />
                            </div>
                          </Col>
                          <Col lg={5} className="quick-selection text-center">
                            <div style={{ display: "flow-root" }}>
                              {/* <h4>Quick Selection</h4> */}

                            </div>
                            <Divider className='mt-1' orientation="left" style={{ borderColor: "#121212", fontWeight: "900", fontSize: "1.25em" }}>Capture Setup</Divider>
                            <Row className='mt-3'>
                              <Col lg={3}>
                                <PresetBox disabled={recstart || isPaused && presetValueC == 'c_sf'} value='c_5050' name='presetc' applyValue={1} presetValue={presetValueC} imgsrc={preset5050} text='50-50' changepreset={(e) => { changePreset(e, 1) }} />
                              </Col>
                              <Col lg={3}>
                                <PresetBox disabled={recstart || isPaused && presetValueC == 'c_sf'} value='c_sbs' name='presetc' applyValue={2} presetValue={presetValueC} imgsrc={presetsbs} text='Side by Side' changepreset={(e) => { changePreset(e, 2) }} />
                              </Col>
                              <Col lg={3}>
                                <PresetBox disabled={recstart || isPaused && presetValueC == 'c_sf'} value='c_single' name='presetc' applyValue={3} presetValue={presetValueC} imgsrc={presetsingle} text='Single Camera' changepreset={(e) => { changePreset(e, 3) }} />
                              </Col>
                              <Col lg={3}>
                                <PresetBox disabled={recstart || isPaused && presetValueC !== 'c_sf'} value='c_sf' name='presetc' applyValue={4} presetValue={presetValueC} imgsrc={presetsf} text='Separate Files' changepreset={(e) => { changePreset(e, 4) }} />
                              </Col>
                            </Row>
                            <Divider className='mt-4' orientation="left" style={{ borderColor: "#121212", fontWeight: "900", fontSize: "1.25em" }}>Live Meeting Connect</Divider>

                            <Row className='mt-3'>
                              <Col lg={3}>
                                <PresetBox disabled={recstart} value='l_5050' name='presetl' applyValue={5} presetValue={presetValueL} imgsrc={presetcam1cam2} text='50-50' changepreset={(e) => { changePreset(e, 5) }} />
                              </Col>
                              <Col lg={3}>
                                <PresetBox disabled={recstart} value='l_sbs' name='presetl' applyValue={6} presetValue={presetValueL} imgsrc={presetsbs} text='Side by Side' changepreset={(e) => { changePreset(e, 6) }} />
                              </Col>
                              <Col lg={3}>
                                <PresetBox disabled={recstart} value='l_singleC1' name='presetl' applyValue={7} presetValue={presetValueL} imgsrc={presetsingle} text='Single Camera 1' changepreset={(e) => { changePreset(e, 7) }} />
                              </Col>
                              <Col lg={3}>
                                <PresetBox disabled={recstart} value='l_singleC2' name='presetl' applyValue={8} presetValue={presetValueL} imgsrc={presetcam2} text='Single Camera 2' changepreset={(e) => { changePreset(e, 8) }} />
                              </Col>
                            </Row>
                            {/* <Divider className='mt-4' orientation="left" style={{ borderColor: "#121212", fontWeight: "900", fontSize: "1.25em" }}>Live Streaming</Divider> */}
                            <Collapse bordered={false} onChange={(e) => { collapseChange(e) }}>
                              <Panel header="Live Streaming" key="1">
                                <Row className='mt-3'>
                                  <Col lg={3}>
                                    <PresetBox disabled={recstart} value='s_5050' name='presets' applyValue={9} presetValue={presetValueS} imgsrc={presetcam1cam2} text='50-50' changepreset={(e) => { changePreset(e, 9) }} />
                                  </Col>
                                  <Col lg={3}>
                                    <PresetBox disabled={recstart} value='s_sbs' name='presets' applyValue={10} presetValue={presetValueS} imgsrc={presetsbs} text='Side by Side' changepreset={(e) => { changePreset(e, 10) }} />
                                  </Col>
                                  <Col lg={3}>
                                    <PresetBox disabled={recstart} value='s_singleC1' name='presets' applyValue={11} presetValue={presetValueS} imgsrc={presetsingle} text='Single Camera 1' changepreset={(e) => { changePreset(e, 11) }} />
                                  </Col>
                                  <Col lg={3}>
                                    <PresetBox disabled={recstart} value='s_singleC2' name='presets' applyValue={12} presetValue={presetValueS} imgsrc={presetcam2} text='Single Camera 2' changepreset={(e) => { changePreset(e, 12) }} />
                                  </Col>
                                </Row>

                              </Panel>
                            </Collapse>
                            <ButtonAnt disabled={recstart || recOnProcess} className='float-right cus-btn2' type="primary" onClick={() => { applyPreset() }}>
                              Apply
                            </ButtonAnt>
                            <ButtonAnt disabled={recstart || recOnProcess} className={applyState != 0 ? 'float-right cus-btn2 mx-3' : 'd-none'} type="default" onClick={resetRadio}>Reset</ButtonAnt>
                            <ButtonAnt type='text' disabled={true} style={{ color: "red" }} className={applyState != 0 ? 'float-right cus-btn2 mx-3' : 'd-none'}>Click Apply to Confirm</ButtonAnt>
                            {/* <ButtonAnt disabled={recstart || recOnProcess} className="my-3 w-100 cus-btn1" onClick={() => { history.push('/capturesetup') }}>
                              Personalized Capture Preferences
                            </ButtonAnt >
                            <ButtonAnt disabled={recstart || recOnProcess} className="my-3 w-100 cus-btn1" onClick={() => { history.push('/lmc') }}>
                              Live Meeting Connect
                            </ButtonAnt>
                            <ButtonAnt disabled={recstart || recOnProcess} className="my-3 w-100 cus-btn1" onClick={() => { history.push('/ls') }}>
                              Live Streaming Parameters
                            </ButtonAnt> */}
                          </Col>
                        </Row>
                        <Row className='my-3'>
                          <Col lg={5}>


                          </Col>
                          <Col lg={2} className="d-grid justify-content-center align-items-center">

                          </Col>
                          <Col lg={5} className="text-center">
                            {/* <p className="my-3"><strong>Next Sheduled Recording:<Countdown value={deadline} onFinish={console.log("finish")} /></strong></p> */}
                            <p className="my-3"><strong>Storage Usage:</strong></p>
                            <Progress percent={100 - Math.round((storageData.avail / storageData.size) * 100, 2)} status={100 - Math.round((storageData.avail / storageData.size) * 100, 2) > 70 ? 'exception' : 'normal'} width={80} strokeColor={100 - Math.round((storageData.avail / storageData.size) * 100, 2) > 70 ? '#D14719' : '#1890ff'} />
                            <Text code style={{ color: "#121212" }}>{Math.round(storageData.avail / Math.pow(1024, 2), 2)}GB/{Math.round(storageData.size / Math.pow(1024, 2), 2)}GB Available</Text>
                            <Alert className={100 - Math.round((storageData.avail / storageData.size) * 100, 2) > 70 ? 'my-2 mx-3' : 'd-none'} message="Files will be automatically deleted when storage usage reaches 80%" type="warning" />
                          </Col>

                        </Row>
                        {/* <Row>
                          <Modal
                            visible={visible}
                            width="80%"
                            footer={[
                              <ButtonAnt key="close" type="primary" onClick={() => { setVisible(false); inputRef.current.focus(); }}>
                                Close
                            </ButtonAnt>
                            ]}
                            closable={false}
                            mask={false}
                            onOk={() => { setVisible(false) }}
                            maskClosable={true}
                            style={{ top: "55%" }}
                            keyboard={true}
                          // focusTriggerAfterClose={true}
                          >
                            <Keyboard
                              keyboardRef={r => (keyboard.current = r)}
                              layoutName={layout}
                              onChange={onChange}
                              onKeyPress={onKeyPress}
                            />
                          </Modal>

                        </Row> */}
                      </Content>
                    </Layout>

                    {/* <Row className="nopadblock">
                      <Col lg={8}>
                        <h2 className="mx-auto text-center">Eduscope UMS</h2>
                      </Col>
                      <Col lg={4}>
                        <ButtonAnt type="primary" className="text-center">
                          Main Menu
                        </ButtonAnt>
                      </Col>
                    </Row> */}

                  </Col>
                </div>
              </div>
            </Col>
            {/* <ButtonAnt
              type="primary"
              shape="circle"
              onClick={poweroff}
              disabled={recstart || recOnProcess}
              icon={<PoweroffOutlined />}
              className="powerbtn"
              style={{ background: '#1C488C' }}
              size="large"
            /> */}
            {/* <ButtonAnt
              type="primary"
              shape="circle"
              onClick={logoutfunc}
              disabled={recstart || recOnProcess}
              icon={<LogoutOutlined />}
              className="logoutbtn"
              style={{ background: '#3367F5' }}
              size="large"
              title="Logout"
            /> */}
            <img className="copyright-logo" src={logo} style={{
              width: "10%", position: "absolute", bottom: "0.5%", left: "18px"
            }} />
          </Row>
        </Container>
      </div>
    </React.Fragment >
  );
};

export default withRouter(Home);

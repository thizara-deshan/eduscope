import React from "react";
import { Redirect } from "react-router-dom";

import Login from "../pages/main/login";
import AdminLogin from "../pages/main/loginAdmin";
import Home from "../pages/main/home";
import Menu from "../pages/main/menu";
import CaptureSetup from "../pages/main/captureSetup";
import ConfSettings from "../pages/settings";
import Lmc from "../pages/main/lmc";
import Ls from "../pages/main/ls";
import Fm from "../pages/main/fm";

const routes = [
  { path: "/login", exact: true, component: Login, isAuth: false, role: [] },
  { path: "/admin-login", exact: true, component: AdminLogin, isAuth: false, role: [] },
  { path: "/home", exact: true, component: Home, isAuth: true, role: ['user', 'admin', 'dev-admin'] },
  { path: "/menu", exact: true, component: Menu, isAuth: true, role: ['user', 'admin', 'dev-admin'] },
  { path: "/capturesetup", exact: true, component: CaptureSetup, isAuth: true, role: ['user', 'admin', 'dev-admin'] },
  { path: "/lmc", exact: true, component: Lmc, isAuth: true, role: ['user', 'admin', 'dev-admin'] },
  { path: "/ls", exact: true, component: Ls, isAuth: true, role: ['user', 'admin', 'dev-admin'] },
  { path: "/fm", exact: true, component: Fm, isAuth: true, role: ['user', 'admin', 'dev-admin'] },
  { path: "/confsettings/ess", exact: true, component: ConfSettings, isAuth: true, role: ['admin', 'dev-admin'] },
  { path: "/confsettings/dev", exact: true, component: ConfSettings, isAuth: true, role: ['dev-admin'] },
  {
    path: "/confsettings",
    component: () => <Redirect to="/confsettings/ess" />,
  },

  // this route should be at the end of all other routes
  {
    path: "/",
    exact: true,
    isAuth: true,
    role: ['user', 'admin', 'dev-admin'],
    component: () => <Redirect to="/login" />,
  },
];

export { routes };

import React from "react";
import { BrowserRouter, Switch } from "react-router-dom";
import { routes } from "./routes";
import { AppRoute } from "./routes/route";
import { AuthProvider } from "./useAuth";


import 'antd/dist/antd.css';
import "./theme.scss";
const App = () => {
  return (
    <BrowserRouter>
      <AuthProvider>
        <Switch>
          {/* <Route path="/" exact component={Admin_Signin} />
        <Route path="/dashboard" component={Layout} /> */}
          {routes.map((route, idx) => (
            <AppRoute
              path={route.path}
              component={route.component}
              key={idx}
              isAuthenticated={route.isAuth}
              role={route.role}
            />
          ))}
        </Switch>
      </AuthProvider>
    </BrowserRouter>
  );
};

export default App;
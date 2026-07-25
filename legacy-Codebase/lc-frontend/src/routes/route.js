import * as React from "react";
import {
  Route,
  RouteProps,
  Redirect
} from "react-router-dom";
import useAuth from "../useAuth";
import jwt from 'jwt-decode'

function AuthenticatedRoute({ ...props }) {
  const { user } = useAuth();
  let userrole
  let userdata
  if (user) {
    userdata = localStorage.getItem('usertoken');
    console.log(props.role);
    userrole = user.role || jwt(userdata).role || 'undefined';
    console.log(!props.role.includes(userrole));
  } else {
    userrole = 'notloggedin'
  }
  if (!user || !props.role.includes(userrole)) return <Redirect to="/login" />;

  return <Route {...props} />;
}



export const AppRoute = ({
  isAuthenticated,
  role,
  component: Component,
  ...rest
}) => {
  return (
    <Route
      {...rest}
      render={(props) => {
        if (!isAuthenticated) {
          return <Component {...props} />;
        }
        return (
          <AuthenticatedRoute role={role}>
            <Component {...props} />
          </AuthenticatedRoute>
        );
      }}
    />
  );
};

import React, {
    createContext,
    useContext,
    useEffect,
    useMemo,
    useState,
} from "react";
import { useHistory, useLocation } from "react-router-dom";
import Login from "./controllers/login";
import md5 from 'md5'
const AuthContext = createContext();

// Export the provider as we need to wrap the entire app with it
export function AuthProvider({
    children,
}) {
    const [user, setUser] = useState();
    const [error, setError] = useState();
    const [loading, setLoading] = useState(false);
    const [loadingInitial, setLoadingInitial] = useState(true);
    const history = useHistory();
    const location = useLocation();

    // If we change page, reset the error state.
    useEffect(() => {
        if (error) setError(null);
    }, [location.pathname]);

    // Check if there is a currently active session
    // when the provider is mounted for the first time.
    //
    // If there is an error, it means there is no session.
    //
    // Finally, just signal the component that the initial load
    // is over.
    useEffect(() => {
        const isuser = Login.getCurrentUser()
        setUser(isuser);
        setLoadingInitial(false);
        console.log("useAuth", isuser);

    }, []);

    // Flags the component loading state and posts the login
    // data to the server.
    //
    // An error means that the email/password combination is
    // not valid.
    //
    // Finally, just signal the component that loading the
    // loading state is over.
    function loginUser(role, email, password) {
        setLoading(true);
        const login = role.userSignIn(email, password)
            .then((userdata) => {
                console.log(userdata);
                if (!isNaN(userdata)) {
                    return userdata

                }
                else {
                    setUser(userdata);
                    console.log(user);
                    return userdata;
                    // history.push("/home");
                }

            })
            .catch((error) => setError(error))
            .finally(() => setLoading(false));

        return login;
    }



    // Call the logout endpoint and then remove the user
    // from the state.
    function logout(role) {
        Login.userLogout().then(() => { setUser(undefined); });

    }

    // Make the provider update only when it should.
    // We only want to force re-renders if the user,
    // loading or error states change.
    //
    // Whenever the `value` passed into a provider changes,
    // the whole tree under the provider re-renders, and
    // that can be very costly! Even in this case, where
    // you only get re-renders when logging in and out
    // we want to keep things very performant.
    const memoedValue = useMemo(
        () => ({
            user,
            loading,
            error,
            loginUser,
            logout,
        }),
        [user, loading, error]
    );

    // We only want to render the underlying app after we
    // assert for the presence of a current user.
    return (
        <AuthContext.Provider value={memoedValue}>
            {!loadingInitial && children}
        </AuthContext.Provider>
    );
}

// Let's only export the `useAuth` hook instead of the context.
// We only want to use the hook directly and never the context component.
export default function useAuth() {
    return useContext(AuthContext);
}
import React from "react";
import { Link } from "react-router-dom";

const RootPage: React.FC = () => {
    return (
        <div style={{ textAlign: "center", marginTop: "50px" }}>
            <h1>Goals</h1>
            <nav>
                <Link to="/signin" style={{ marginRight: "15px", textDecoration: "none", fontSize: "18px" }}>
                    Sign In
                </Link>
                <Link to="/signup" style={{ textDecoration: "none", fontSize: "18px" }}>
                    Sign Up
                </Link>
            </nav>
        </div>
    );
};

export default RootPage;


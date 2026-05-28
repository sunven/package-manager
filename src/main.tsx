import React from "react";
import ReactDOM from "react-dom/client";
import { App } from "./App";
import "./styles.css";

const app = document.querySelector<HTMLDivElement>("#app");
if (!app) {
  throw new Error("App container missing");
}

ReactDOM.createRoot(app).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);

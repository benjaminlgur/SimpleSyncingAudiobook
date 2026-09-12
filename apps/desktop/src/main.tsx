import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import "./index.css";
import * as Sentry from "@sentry/react";
import { UpdateNotice } from "./components/UpdateNotice";

Sentry.init({
  dsn: import.meta.env.VITE_SENTRY_DSN,
  enabled: !!import.meta.env.VITE_SENTRY_DSN,
  sendDefaultPii: false,
  beforeSend(event) {
    // Auth tokens, file paths and audiobook titles must not leave the device.
    delete event.request;
    delete event.user;
    delete event.breadcrumbs;
    delete event.extra;
    for (const exception of event.exception?.values ?? [])
      exception.value = exception.type || "Application error";
    return event;
  },
});

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <UpdateNotice />
    <App />
  </React.StrictMode>,
);

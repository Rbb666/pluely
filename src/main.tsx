import React from "react";
import ReactDOM from "react-dom/client";
import Overlay from "./components/Overlay";
import { AppProvider, ThemeProvider } from "./contexts";
import "./global.css";
import { getCurrentWindow } from "@tauri-apps/api/window";
import AppRoutes from "./routes";
import moment from "moment";
import "moment/dist/locale/zh-cn";
import { initializeMigration } from "./lib/migration-bootstrap";
import { initializeUserDataImport } from "./lib/user-data-import";

moment.locale("zh-cn");

const currentWindow = getCurrentWindow();
const windowLabel = currentWindow.label;

// Render different components based on window label
if (windowLabel.startsWith("capture-overlay-")) {
  const monitorIndex = parseInt(windowLabel.split("-")[2], 10) || 0;
  // Render overlay without providers
  ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
    <React.StrictMode>
      <Overlay monitorIndex={monitorIndex} />
    </React.StrictMode>
  );
} else {
  const root = ReactDOM.createRoot(document.getElementById("root") as HTMLElement);
  initializeUserDataImport().then(() => initializeMigration()).then(() => {
    root.render(
      <React.StrictMode>
        <ThemeProvider>
          <AppProvider>
            <AppRoutes />
          </AppProvider>
        </ThemeProvider>
      </React.StrictMode>
    );
  }).catch(() => {
    // Do not initialize providers with partially restored data or log secrets.
    root.render(
      <div className="m-2 rounded-lg border bg-background p-3 text-sm text-foreground">
        用户数据恢复尚未完成，请关闭其他 Pluely 窗口后重试。
        <button className="ml-3 underline" onClick={() => window.location.reload()}>重试</button>
      </div>
    );
  });
}

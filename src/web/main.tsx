import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router";
import { App } from "./App";
import "./styles.css";
import { applyTheme, cachedTheme } from "./theme";

const root = document.getElementById("root");
if (!root) throw new Error("No se encuentra el elemento #root");

// El último tema usado en este dispositivo, antes del primer pintado; los ajustes lo corrigen si hace falta.
applyTheme(cachedTheme());

createRoot(root).render(
  <StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </StrictMode>,
);

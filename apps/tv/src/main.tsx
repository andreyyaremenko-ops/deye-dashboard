import { render } from "preact";
import { App } from "./app.tsx";
import "./style.css";
import "./fonts.css";

render(<App />, document.getElementById("app")!);

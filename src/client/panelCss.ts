import base from "./styles/base.css?inline"
import overview from "./styles/overview.css?inline"
import events from "./styles/events.css?inline"
import files from "./styles/files.css?inline"
import commands from "./styles/commands.css?inline"
import browser from "./styles/browser.css?inline"
import attachments from "./styles/attachments.css?inline"
import trend from "./styles/trend.css?inline"
import fleet from "./styles/fleet.css?inline"

/** The bundle carries the stylesheet as a string; the panel renders it in place. */
export const PANEL_CSS = [base, overview, events, files, commands, browser, attachments, trend, fleet].join("\n")

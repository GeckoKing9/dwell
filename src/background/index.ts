// Service worker entry: registration only. Every listener is added synchronously at the top level,
// because Chrome dispatches the event that woke the worker only to listeners present after this
// script's first run. The logic lives in listeners.ts.
import { createBackground } from './listeners.ts';

const background = createBackground();

chrome.runtime.onStartup.addListener(background.onStartup);
chrome.runtime.onInstalled.addListener(background.onInstalled);
chrome.runtime.onMessage.addListener(background.onMessage);
chrome.tabs.onActivated.addListener(background.onTabActivated);
chrome.tabs.onUpdated.addListener(background.onTabUpdated);
chrome.tabs.onRemoved.addListener(background.onTabRemoved);
chrome.windows.onFocusChanged.addListener(background.onFocusChanged);
chrome.windows.onRemoved.addListener(background.onWindowRemoved);
chrome.idle.onStateChanged.addListener(background.onIdleChanged);
chrome.alarms.onAlarm.addListener(background.onAlarm);

void background.start();

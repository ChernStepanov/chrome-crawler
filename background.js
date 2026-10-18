// Клик по иконке расширения открывает боковую панель с агентом.
chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(console.error);

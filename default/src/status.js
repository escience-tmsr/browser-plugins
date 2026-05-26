function sendStatus(text, isError = false) {
  const dot = "•"; 
  self.setBadge(dot, isError);

  if (!isError) { console.log("[default-extension] " + text); } 
  else { console.error("[default-extension] " + text); }

  browser.runtime.sendMessage({ type: "status", text }).catch(() => {});
  const element = document.getElementById("status");
  if (element) { 
    element.textContent = text;
    if (isError) { element.style.color = "red"; }
    else { element.style.color = ""; }
  }
  return element;
}

function setBadge(text, isError) {
  try {
    browser.browserAction.setBadgeText({ text });
    if (isError) { browser.browserAction.setBadgeBackgroundColor({ color: "#FF0000" }); }
    else { browser.browserAction.setBadgeBackgroundColor({ color: "#008000" }); }
    return isError;
  } catch(_) {}
}

/* istanbul ignore next */
if (typeof self === "undefined") {
  module.exports = { sendStatus, setBadge }; 
} else {
  module.exports = { sendStatus, setBadge };  
  self.sendStatus = sendStatus;
  self.setBadge = setBadge;
}
